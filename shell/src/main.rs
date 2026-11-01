// SPDX-License-Identifier: GPL-3.0-only

//! Точка входа LAVRay shell (Tauri 2).
//!
//! Спек §10: single instance, deep-link, трей, окна, онбординг — итерации
//! после скаффолда. Сейчас: окно с placeholder-фронтендом
//! (`desktop-placeholder/`) и две diagnostic-команды IPC. Вся логика — в
//! библиотечной части (`lavray_shell`), тестируемой без GUI.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lavray_shell::agent::{AgentAccess, AgentMode};
use lavray_shell::autostart::{self, AutostartState};
use lavray_shell::coreproc::driver::generate_auth_token;
use lavray_shell::coreproc::runner::{spawn_supervisor, Failure, SupervisorHandle};
use lavray_shell::coreproc::{CoreSpawnConfig, CoreState};
use lavray_shell::elevation::{
    is_elevated as process_is_elevated, relaunch_elevated as relaunch, RelaunchOutcome,
    RelaunchRequest, Runas,
};
use lavray_shell::endpoint::{
    EndpointEvent, EndpointHub, HostObserver, SupervisorHost, CORE_ENDPOINT_EVENT, ENDPOINT_WAIT,
};
use lavray_shell::integrity::{find_trusted_core, CORE_SHA256};
use lavray_shell::launch::{wait_for_exit, LaunchArgs, WAIT_PID_TIMEOUT};
use lavray_shell::{msgbox, os_integration};
use lavray_shell::prefs::ShellPrefs;
use lavray_shell::profile;
use lavray_shell::single_instance::{self, Verdict};
use lavray_shell::sysproxy::{set_blocking, validate_port, SetOutcome, SysProxy};
use lavray_shell::token;
use lavray_shell::tray::TrayUpdate;
use lavray_shell::ui_state;
use lavray_shell::uiprotocol::IPC_PROTOCOL_VERSION;
use lavray_shell::window_geometry;
use lavray_shell::window_policy::{self, CloseAction};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

mod commands;
mod tray_ui;

/// Версия протокола UI ↔ shell (`uiprotocol.rs`).
#[tauri::command]
fn protocol_version() -> u32 {
    IPC_PROTOCOL_VERSION
}

/// Общее состояние ядра процесса (адрес/токен для UI-фронтенда).
#[derive(Default)]
struct RuntimeState {
    /// Адрес последнего запущенного ядра (токен и ожидание готовности — в
    /// `EndpointHub`).
    core_url: String,
    /// Последняя известная причина отказа (показывается UI/логом).
    last_error: String,
    /// Ядро живо (Ready/Connected): обновляет наблюдатель надзирателя.
    core_alive: bool,
    /// Состояние FSM ядра §2.2: Spawning, Ready, Crashed, RateLimited, …
    core_state: CoreState,
    /// Хвост кольца логов ядра на момент последнего сбоя (диагностика).
    core_log: Vec<String>,
}

/// is_elevated — запущено ли приложение с правами администратора/root (T-46):
/// UI проверяет это до подключения в режиме TUN.
#[tauri::command]
fn is_elevated() -> bool {
    process_is_elevated()
}

/// relaunch_elevated — «Перезапустить от администратора» из диалога TUN
/// (T-81): запускает второй экземпляр через UAC и, если запуск состоялся,
/// завершает этот обычным путём выхода (останов ядра, возврат системного
/// прокси — как `begin_quit`). Отказ в UAC — не ошибка: ответ `cancelled`, и
/// приложение остаётся как было. Новый экземпляр дожидается выхода этого
/// процесса (`--wait-pid`), прежде чем занять single-instance.
#[tauri::command]
async fn relaunch_elevated(app: tauri::AppHandle) -> Result<RelaunchOutcome, String> {
    let exe = std::env::current_exe().map_err(|e| format!("путь к LAVRay.exe: {e}"))?;
    let window_hidden = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .is_some_and(|visible| !visible);
    // `ShellExecuteExW` ждёт ответа на запрос UAC: в фоновом потоке.
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let elevated = process_is_elevated();
        relaunch(
            &Runas,
            &RelaunchRequest {
                exe: &exe,
                parent_pid: std::process::id(),
                window_hidden,
                elevated,
                // обычному пользователю UAC потребовал бы пароль чужой учётной записи
                can_elevate: token::can_self_elevate(token::elevation_kind(), elevated),
            },
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    if outcome == RelaunchOutcome::Started {
        begin_quit(&app);
    }
    Ok(outcome)
}

/// Что UI узнаёт о запуске: перезапущен ли экземпляр от администратора.
#[derive(serde::Serialize)]
struct LaunchInfo {
    elevated_relaunch: bool,
}

/// Состояние запуска: запущен ли экземпляр с `--elevated-relaunch`; ответ
/// `launch_info` с признаком выдаётся один раз (перезагрузка страницы не
/// повторяет подсказку «TUN включён»).
struct LaunchState {
    elevated_relaunch: bool,
    answered: AtomicBool,
}

/// launch_info — признак «приложение только что перезапущено от администратора»
/// (по флагу `--elevated-relaunch`, а не по файлам и `localStorage`).
#[tauri::command]
fn launch_info(state: tauri::State<'_, LaunchState>) -> LaunchInfo {
    let first = !state.answered.swap(true, Ordering::SeqCst);
    LaunchInfo {
        elevated_relaunch: state.elevated_relaunch && first,
    }
}

/// ui_state_load — общие настройки UI из `ui-state.json` в каталоге данных
/// (источник истины для обоих профилей WebView; `localStorage` — кэш).
#[tauri::command]
async fn ui_state_load() -> Result<ui_state::Loaded, String> {
    tauri::async_runtime::spawn_blocking(|| ui_state::load(&data_dir()))
        .await
        .map_err(|e| e.to_string())
}

/// ui_state_set — записать (`value`) или удалить (`null`) одну настройку из
/// явного списка ключей. Повышенный процесс создаёт файл с явным доступом для
/// текущего пользователя, чтобы обычный экземпляр мог его перезаписать.
#[tauri::command]
async fn ui_state_set(key: String, value: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let owner = if process_is_elevated() {
            token::user_sid()
        } else {
            None
        };
        ui_state::set(&data_dir(), &key, value, owner.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// window_show — показать и развернуть главное окно (трей и Ctrl+D просят
/// диалог TUN, пока окно скрыто).
#[tauri::command]
fn window_show(app: tauri::AppHandle) {
    tray_ui::show_main_window(&app);
}

/// autostart_state — автозапуск с системой, как его видит ОС (T-82): задача
/// планировщика или значение `Run`. Читается при каждом показе строки
/// настроек (FR-UI-013); `supported: false` — строку нужно скрыть.
#[tauri::command]
async fn autostart_state() -> Result<AutostartState, String> {
    tauri::async_runtime::spawn_blocking(autostart::current_state)
        .await
        .map_err(|e| e.to_string())?
}

/// set_autostart — включить/выключить автозапуск (T-82). С правами
/// администратора — задача планировщика, без прав — `Run` в реестре; ответ —
/// состояние, заново прочитанное из ОС. Вызовы `reg.exe`/`schtasks.exe`
/// идут в фоновом потоке: окно не замирает.
#[tauri::command]
async fn set_autostart(enabled: bool) -> Result<AutostartState, String> {
    tauri::async_runtime::spawn_blocking(move || autostart::change(enabled))
        .await
        .map_err(|e| e.to_string())?
}

/// agent_access_set — режим доступа ИИ-агентов (настройка ядра `agent.mode`):
/// окно сообщает его при каждой загрузке и при каждом изменении. Оболочка
/// создаёт, перезаписывает или удаляет `agent-endpoint.json`; ядро режим
/// применяет само и сразу, перезапуск не нужен.
#[tauri::command]
fn agent_access_set(agent: tauri::State<'_, Arc<AgentAccess>>, mode: String) -> Result<(), String> {
    let mode =
        AgentMode::parse(&mode).ok_or_else(|| format!("неизвестный режим агентов: {mode}"))?;
    agent.set_mode(mode)
}

/// agent_core_path — полный путь к `lavray-core.exe` рядом с установленным
/// приложением, для настройки MCP-клиентов (Claude Desktop, Claude Code, Cursor).
#[tauri::command]
fn agent_core_path() -> Result<String, String> {
    Ok(locate_core()?.display().to_string())
}

/// Адрес ConnectRPC-ядра для UI (вызывается фронтендом при старте).
///
/// Ждёт готовности ядра до `ENDPOINT_WAIT`: раньше при холодном старте UI
/// спрашивал адрес раньше, чем ядро писало READY, получал `("", "")` и
/// навсегда оставался на `http://127.0.0.1:0` (A2-02). По истечении срока
/// возвращает `("", "")`: UI получит адрес событием `core-endpoint`.
#[tauri::command]
async fn core_endpoint(
    hub: tauri::State<'_, Arc<EndpointHub>>,
) -> Result<(String, String), String> {
    let hub = Arc::clone(&hub);
    let ready = tauri::async_runtime::spawn_blocking(move || hub.wait_ready(ENDPOINT_WAIT))
        .await
        .map_err(|e| e.to_string())?;
    Ok(ready.map(|ep| (ep.url, ep.token)).unwrap_or_default())
}

/// Состояние ядра §2.2 (Spawning, Ready, Crashed, RateLimited, …).
#[tauri::command]
fn core_state(shared: tauri::State<'_, Arc<Mutex<RuntimeState>>>) -> CoreState {
    shared.lock().unwrap_or_else(|e| e.into_inner()).core_state
}

/// core_log_tail — последние строки stdout/stderr ядра на момент сбоя (кольцо
/// §4): по ним видно, почему ядро не стартует или упало.
#[tauri::command]
fn core_log_tail(shared: tauri::State<'_, Arc<Mutex<RuntimeState>>>) -> Vec<String> {
    shared
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .core_log
        .clone()
}

/// restart_core — ручной «Перезапустить» из RateLimited (рестарты прекращены)
/// или после ошибки запуска.
#[tauri::command]
fn restart_core(supervisor: tauri::State<'_, Arc<SupervisorHandle>>) {
    supervisor.manual_restart();
}

/// set_system_proxy — включить/выключить системный прокси (F5, FR-UI-221/222).
/// Включение сохраняет снимок прежних настроек; выключение — восстанавливает.
/// Прокси указывает на mixed-инбаунд ядра (127.0.0.1:<port>).
///
/// Порт приходит от окна и проверяется в оболочке (A2-18): 1..=65535, ядро
/// должно быть живо. Хост не параметр — всегда loopback. При выключении порт
/// не нужен и не проверяется: неверное значение не должно оставить прокси
/// включённым. `reg.exe`/WinINET/RAS работают в пуле блокирующих потоков, а не
/// в потоке команд (T-82); предупреждения (RAS, WPAD) — в `warnings` ответа.
#[tauri::command]
async fn set_system_proxy(
    shared: tauri::State<'_, Arc<Mutex<RuntimeState>>>,
    enabled: bool,
    port: i64,
) -> Result<SetOutcome, String> {
    let port = if enabled { validate_port(port)? } else { 0 };
    let data = {
        let s = shared.lock().map_err(|_| "state poisoned".to_string())?;
        if s.core_url.is_empty() || (enabled && !s.core_alive) {
            return Err("ядро не запущено".to_string());
        }
        data_dir()
    };
    set_blocking(data, enabled, port).await
}

/// request_quit — попросить надзирателя остановить ядро перед выходом (D2).
#[tauri::command]
fn request_quit(supervisor: tauri::State<'_, Arc<SupervisorHandle>>) {
    supervisor.stop();
}

/// Сколько ждать остановки ядра при выходе: лестница §5 — до 15 с; окно и
/// значок к этому моменту уже спрятаны, а Job Object всё равно убьёт ядро.
const QUIT_CORE_WAIT: std::time::Duration = std::time::Duration::from_secs(16);

/// Полный выход (пункт «Выход» трея и меню окна) в фоновом потоке: обработчик
/// меню возвращается сразу. Раньше трей спал 1200 мс в главном потоке (A2-16).
fn begin_quit(app: &tauri::AppHandle) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let supervisor = app.try_state::<Arc<SupervisorHandle>>();
        if let Some(supervisor) = &supervisor {
            supervisor.stop(); // лестница §5
        }
        tray_ui::hide(&app);
        // Файл с агентским токеном убирается до выхода: ядра больше не будет.
        if let Some(agent) = app.try_state::<Arc<AgentAccess>>() {
            if let Err(e) = agent.shutdown() {
                eprintln!(
                    "LAVRay: не удалось удалить {}: {e}",
                    lavray_shell::agent::FILE_NAME
                );
            }
        }
        // Прокси снимаем до выхода: иначе в ОС остаётся прокси на мёртвый порт.
        let _ = SysProxy::new(&data_dir()).release_on_quit();
        let stopped = || supervisor.as_ref().is_none_or(|s| s.is_stopped());
        let deadline = std::time::Instant::now() + QUIT_CORE_WAIT;
        while !stopped() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        app.exit(0);
    });
}

/// quit_app — полный выход из приложения по пункту меню «Выход».
#[tauri::command]
async fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    begin_quit(&app);
    Ok(())
}

/// tray_update — UI сообщает состояние соединения и готовые строки меню на
/// языке интерфейса; оболочка перерисовывает меню, значок и подсказку трея.
#[tauri::command]
fn tray_update(app: tauri::AppHandle, update: TrayUpdate) -> Result<(), String> {
    tray_ui::apply(&app, Some(update))
}

/// Окно: свернуть / развернуть / скрыть в трей / перетащить.
/// Управление окном вынесено в команды оболочки: у безрамочного окна
/// JS-права `core:window:*` не всегда применяются к перетаскиванию, а
/// каждая команда здесь — один вызов tao без ACL-посредника.
#[tauri::command]
fn window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: tauri::WebviewWindow) -> Result<bool, String> {
    let max = window.is_maximized().map_err(|e| e.to_string())?;
    if max {
        window.unmaximize().map_err(|e| e.to_string())?;
    } else {
        window.maximize().map_err(|e| e.to_string())?;
    }
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_is_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

/// Крестик в шапке окна — то же, что системный крестик (T-82).
#[tauri::command]
fn window_hide(window: tauri::WebviewWindow) -> Result<(), String> {
    close_window(&window).map_err(|e| e.to_string())
}

/// Крестик: спрятать в трей (спека §8.1) или выйти полностью — по настройке.
fn close_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    match window_policy::on_close(&ShellPrefs::load(&data_dir())) {
        CloseAction::Hide => window.hide(),
        CloseAction::Quit => {
            begin_quit(window.app_handle());
            Ok(())
        }
    }
}

/// Начать перетаскивание окна за шапку (безрамочные окна требуют вызова).
#[tauri::command]
fn window_start_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

/// shell_error — причина отказа запуска ядра для UI (D15).
#[tauri::command]
fn shell_error(shared: tauri::State<'_, Arc<Mutex<RuntimeState>>>) -> String {
    shared
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .last_error
        .clone()
}

/// data_dir — пользовательский каталог данных на всех ОС (D5): Windows —
/// %APPDATA%\LAVRay, macOS — ~/Library/Application Support/LAVRay,
/// Linux — $XDG_DATA_HOME/lavray (по умолчанию ~/.local/share/lavray).
fn data_dir() -> std::path::PathBuf {
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return std::path::PathBuf::from(appdata).join("LAVRay");
        }
    } else if cfg!(target_os = "macos") {
        if let Some(home) = std::env::var_os("HOME") {
            return std::path::PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("LAVRay");
        }
    } else if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        return std::path::PathBuf::from(xdg).join("lavray");
    } else if let Some(home) = std::env::var_os("HOME") {
        return std::path::PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("lavray");
    }
    std::env::temp_dir().join("lavray")
}

/// Путь к доверенному `lavray-core` (T-44): только в установленных ресурсах и
/// только с вшитой при сборке суммой SHA-256.
fn locate_core() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("путь к LAVRay.exe: {e}"))?;
    let dir = exe
        .parent()
        .ok_or("у LAVRay.exe нет каталога")?
        .to_path_buf();
    let core_name = if cfg!(windows) {
        "lavray-core.exe"
    } else {
        "lavray-core"
    };
    // D6/D7 (аудит round 2): ядро ищется ТОЛЬКО в установленных ресурсах.
    // Раньше первым шёл каталог рядом с exe — в portable-режиме это позволяло
    // подменить lavray-core.exe без каких-либо проверок. .is_file() вместо
    // .exists() (каталог с таким именем больше не считается бинарником).
    // T-44: найденный файл сверяется с SHA-256, вшитым при сборке; подменённое
    // или устаревшее ядро не запускается (A2-07).
    find_trusted_core(
        &[
            dir.join("binaries").join(core_name),
            dir.join("resources").join("binaries").join(core_name),
            dir.join("resources").join(core_name),
        ],
        CORE_SHA256,
    )
}

/// Конфигурация запуска ядра (§3): бинарник рядом с приложением, каталог
/// данных (его же получает ядро флагом `--data`), новый токен (в stdin ядру) и
/// новый агентский токен MCP (второй строкой stdin; в файл он попадёт, только
/// пока доступ агентов включён). Надзиратель зовёт её перед каждым
/// (пере)запуском; `Err` — почему ядро не собрать.
fn core_spawn_config() -> Result<CoreSpawnConfig, String> {
    let core_bin = locate_core()?;
    // D5: данные — в пользовательском каталоге на всех ОС. APPDATA есть
    // только на Windows; на macOS/Linux каталог рядом с .app//opt был бы
    // read-only, а create_dir_all тихо возвращал None.
    let data_dir = data_dir();
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("каталог данных {}: {e}", data_dir.display()))?;
    Ok(CoreSpawnConfig {
        binary: core_bin,
        data_dir,
        // §3.1: порт выделяет ОС («127.0.0.1:0»).
        listen_socket: std::path::PathBuf::from("127.0.0.1:0"),
        auth_token: generate_auth_token().map_err(|e| format!("токен ядра: {e}"))?,
        agent_token: Some(generate_auth_token().map_err(|e| format!("агентский токен: {e}"))?),
        extra_args: vec![],
    })
}

/// Окружение надзирателя: состояние оболочки, событие UI, системный прокси.
struct ShellHost {
    app: tauri::AppHandle,
    shared: Arc<Mutex<RuntimeState>>,
    agent: Arc<AgentAccess>,
}

impl ShellHost {
    fn emit_endpoint(&self, event: &EndpointEvent) {
        if let Err(e) = self.app.emit_to("main", CORE_ENDPOINT_EVENT, event.clone()) {
            eprintln!("LAVRay: не удалось отправить {CORE_ENDPOINT_EVENT}: {e}");
        }
    }
}

impl SupervisorHost for ShellHost {
    fn state_changed(&self, state: CoreState) {
        let mut s = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        s.core_state = state;
        s.core_alive = matches!(state, CoreState::Ready | CoreState::Connected);
    }

    fn core_up(&self, endpoint: &EndpointEvent) {
        if let Ok(mut s) = self.shared.lock() {
            s.core_url.clone_from(&endpoint.url);
            s.core_alive = true;
            s.last_error.clear();
        }
        self.emit_endpoint(endpoint);
        // T-45: значок трея — «подключено/ожидание» по состоянию ядра.
        tray_ui::refresh(&self.app);
    }

    fn core_down(&self, reason: &str) {
        if let Ok(mut s) = self.shared.lock() {
            s.core_alive = false;
            s.last_error = reason.to_string();
        }
        self.emit_endpoint(&EndpointEvent::down());
        // T-45: ядро умерло — значок «ошибка» (или «не подключено»).
        tray_ui::refresh(&self.app);
        // T-03: системный прокси, который ставили мы, смотрит на порт
        // умершего ядра. Возвращаем снимок (shell-lifecycle §6); у нового
        // ядра режимы выключены, пользователь включит подключение сам.
        if let Err(e) = SysProxy::new(&data_dir()).release_on_quit() {
            eprintln!("LAVRay: не удалось снять системный прокси после падения ядра: {e}");
        }
    }

    fn spawn_failed(&self, reason: &str) {
        if let Ok(mut s) = self.shared.lock() {
            s.last_error = reason.to_string();
        }
        tray_ui::refresh(&self.app);
    }

    fn agent_core_up(&self, url: &str, agent_token: &str) {
        if let Err(e) = self.agent.core_up(url, agent_token) {
            eprintln!("LAVRay: доступ агентов (MCP): {e}");
        }
    }

    fn agent_core_down(&self) {
        if let Err(e) = self.agent.core_down() {
            eprintln!(
                "LAVRay: не удалось удалить {}: {e}",
                lavray_shell::agent::FILE_NAME
            );
        }
    }

    fn failure(&self, failure: &Failure) {
        // T-56: причина и хвост кольца логов ядра — для `shell_error` и
        // `core_log_tail` (релизная сборка stderr не выводит).
        let mut s = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        s.last_error.clone_from(&failure.message);
        s.core_log.clone_from(&failure.log_tail);
    }
}

/// Главное окно создаётся здесь, а не из `tauri.conf.json` (там `create: false`):
/// повышенному экземпляру нужен собственный каталог данных WebView, иначе общий
/// профиль с процессами другой целостности может не открыться.
fn create_main_window(app: &tauri::App, elevated: bool) -> Result<(), String> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or("в tauri.conf.json нет окна main")?;
    let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), config)
        .map_err(|e| e.to_string())?;
    if cfg!(windows) {
        let local = app.path().local_data_dir().map_err(|e| e.to_string())?;
        if let Some(dir) = profile::webview_data_dir(&local, &app.config().identifier, elevated) {
            builder = builder.data_directory(dir);
        }
    }
    // Размер и место ставит плагин; заголовок за краем экрана — окно в центр.
    builder
        .build()
        .map(|window| window_geometry::ensure_reachable(&window))
        .map_err(|e| e.to_string())
}

fn main() {
    lavray_shell::update::watchdog_entry::run_if_requested(); // T-75: --update-watchdog
    let launch = LaunchArgs::from_env();
    // T-81: перезапуск от администратора запускает этот экземпляр, пока прежний
    // ещё выходит. Ждём его до плагинов: single-instance иначе отдал бы
    // аргументы старому окну и закрыл новый экземпляр.
    // Не вышел за срок — не запускаемся: single-instance отдал бы аргументы
    // старому экземпляру, а два экземпляра на одних данных вредны.
    if let Some(pid) = launch.wait_pid {
        if !wait_for_exit(pid) {
            msgbox::show(&msgbox::previous_instance_alive(
                pid,
                WAIT_PID_TIMEOUT.as_secs(),
            ));
            std::process::exit(1);
        }
    }
    let context = tauri::generate_context!();
    // Мьютекс single-instance, созданный повышенным экземпляром, обычному не
    // открыть: плагин принял бы себя за первый (второе ядро, второй трей, откат
    // прокси первого). Проверяем до плагина.
    if single_instance::check(&single_instance::System, &context.config().identifier)
        == Verdict::ElevatedInstanceRunning
    {
        msgbox::show(msgbox::ALREADY_RUNNING_ELEVATED);
        std::process::exit(0);
    }
    // T-82: `--tray` (автозапуск) или «Запускать свёрнутым» — только значок.
    let prefs = ShellPrefs::load(&data_dir());
    let start_hidden = window_policy::start_hidden(launch.tray, launch.elevated_relaunch, &prefs);
    let elevated = process_is_elevated();
    let runtime = Arc::new(Mutex::new(RuntimeState::default()));
    let rt_for_setup = Arc::clone(&runtime);
    let hub = Arc::new(EndpointHub::default());
    let hub_for_setup = Arc::clone(&hub);
    os_integration::attach(tauri::Builder::default(), data_dir())
        // Сингл-инстанс (shell-lifecycle §8.1): второй запуск фокусирует окно.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray_ui::show_main_window(app); // свёрнутое окно тоже разворачиваем
        }))
        // Внешние ссылки (target=_blank) — в системный браузер, только http/https
        // (scope в capabilities/default.json).
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::clone(&runtime))
        .manage(hub)
        .manage(LaunchState {
            elevated_relaunch: launch.elevated_relaunch,
            answered: AtomicBool::new(false),
        })
        .setup(move |app| {
            // Окно первым: события ядра адресуются окну `main`. Не создалось —
            // сообщение с причиной вместо тихой паники.
            if let Err(reason) = create_main_window(app, elevated) {
                msgbox::show(&msgbox::window_failed(&reason));
                std::process::exit(1);
            }
            // F5/FR-UI-259: если прошлая сессия упала с включённым прокси,
            // возвращаем системные настройки ДО запуска нового ядра.
            match SysProxy::new(&data_dir()).recover_if_needed() {
                Ok(true) => eprintln!("LAVRay: восстановлены системные настройки прокси"),
                Ok(false) => {}
                Err(e) => eprintln!("LAVRay: не удалось восстановить прокси: {e}"),
            }

            // Файл с агентским токеном прошлого запуска (приложение закрыли
            // аварийно) недействителен: ядра с этим токеном уже нет.
            let agent = Arc::new(AgentAccess::new(data_dir(), token::user_sid()));
            if let Err(e) = agent.remove_stale() {
                eprintln!("LAVRay: не удалось удалить устаревший файл доступа агентов: {e}");
            }
            app.manage(Arc::clone(&agent));

            // Надзор за ядром (A2-11): цикл `coreproc::runner` ведёт CoreSupervisor
            // (backoff 1/2/4/8/15 с, RateLimited после 3 падений за 60 с) и
            // тестируется без GUI; здесь только среда. T-03: при каждом запуске
            // и при смерти ядра UI получает событие `core-endpoint`, при смерти
            // снимается системный прокси (`HostObserver` поверх `ShellHost`).
            let host = ShellHost {
                app: app.handle().clone(),
                shared: Arc::clone(&rt_for_setup),
                agent: Arc::clone(&agent),
            };
            let observer = HostObserver::new(Arc::clone(&hub_for_setup), host);
            app.manage(Arc::new(spawn_supervisor(core_spawn_config, observer)?));
            // Трей (DS §9, §10): меню по TrayMenuSpec, состояние и тексты
            // присылает UI (`tray_update`); закрытие окна — в трей.
            tray_ui::install(app)?;
            os_integration::on_setup(app.handle(), &prefs); // T-82: глобальное сочетание
                                                            // Окно в tauri.conf.json создаётся скрытым (`visible: false`): так
                                                            // `--tray` не мигает окном на старте.
            if !start_hidden {
                tray_ui::show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // D1 (аудит round 2): окно не закрывается само — иначе трей
            // оставался без окна, а ядро гасилось без graceful-teardown.
            // T-82: прятать в трей или выходить полностью, решает настройка.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if let Some(main) = window.app_handle().get_webview_window(window.label()) {
                    let _ = close_window(&main);
                }
            }
            // Тема окна сменилась — значок трея под другую панель задач.
            tauri::WindowEvent::ThemeChanged(_) => tray_ui::refresh(window.app_handle()),
            _ => {}
        })
        .invoke_handler(commands::handler())
        .build(context)
        .unwrap_or_else(|e| {
            msgbox::show(&msgbox::window_failed(&e.to_string()));
            std::process::exit(1);
        })
        .run(|app, event| {
            on_run_event(&event, || {
                let _ = SysProxy::new(&data_dir()).release_on_quit();
                // Выход сеанса Windows тоже сюда: файл с агентским токеном не
                // должен пережить приложение.
                if let Some(agent) = app.try_state::<Arc<AgentAccess>>() {
                    let _ = agent.shutdown();
                }
            });
        });
}

/// Реакция на события цикла tauri. `Exit` приходит при любом выходе, в том
/// числе при завершении сеанса Windows (WM_ENDSESSION: tao вызывает
/// `loop_destroyed()` и сразу `std::process::exit(0)`), — это последняя
/// возможность вернуть системный прокси, иначе после загрузки в WinINET
/// остаётся адрес без слушателя (A2-06, T-43). Повторный откат безвреден:
/// без снимка `release_on_quit` ничего не делает.
fn on_run_event(event: &tauri::RunEvent, release_proxy: impl FnOnce()) {
    if matches!(event, tauri::RunEvent::Exit) {
        release_proxy();
    }
}

#[cfg(test)]
mod tests {
    use super::on_run_event;
    use std::cell::Cell;

    #[test]
    fn proxy_is_released_on_exit_event_only() {
        let released = Cell::new(0);
        on_run_event(&tauri::RunEvent::Exit, || released.set(released.get() + 1));
        assert_eq!(
            released.get(),
            1,
            "Exit (в том числе WM_ENDSESSION) снимает прокси"
        );
        on_run_event(&tauri::RunEvent::Ready, || released.set(released.get() + 1));
        assert_eq!(released.get(), 1, "прочие события прокси не трогают");
    }
}
