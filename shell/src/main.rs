//! Точка входа LAVRay shell (Tauri 2).
//!
//! Спек §10: single instance, deep-link, трей, окна, онбординг — итерации
//! после скаффолда. Сейчас: окно с placeholder-фронтендом
//! (`desktop-placeholder/`) и две diagnostic-команды IPC. Вся логика — в
//! библиотечной части (`lavray_shell`), тестируемой без GUI.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lavray_shell::coreproc::driver::{generate_auth_token, RealCoreProcess};
use lavray_shell::coreproc::{CoreProcess, CoreSpawnConfig, CoreState, SecretToken};
use lavray_shell::endpoint::{
    run_supervisor, EndpointEvent, EndpointHub, SupervisorHost, CORE_ENDPOINT_EVENT, ENDPOINT_WAIT,
};
use lavray_shell::integrity::{find_trusted_core, CORE_SHA256};
use lavray_shell::sysproxy::SysProxy;
use lavray_shell::tray::TrayUpdate;
use lavray_shell::uiprotocol::IPC_PROTOCOL_VERSION;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

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
    /// D3: ядро живо (обновляется потоком-надзирателем).
    core_alive: bool,
    /// Запрос на остановку ядра при выходе (надзиратель завершает его сам:
    /// RealCoreProcess содержит сырые handle и не Send).
    shutdown: bool,
    /// Надзиратель закончил: ядро остановлено (выход ждёт этого флага).
    core_stopped: bool,
}

/// Отмечает в `RuntimeState`, что надзиратель закончил (в том числе по панике).
struct CoreStopped(Arc<Mutex<RuntimeState>>);

impl Drop for CoreStopped {
    fn drop(&mut self) {
        let mut s = self.0.lock().unwrap_or_else(|e| e.into_inner());
        s.core_alive = false;
        s.core_stopped = true;
    }
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

#[tauri::command]
fn core_state(shared: tauri::State<'_, Arc<Mutex<RuntimeState>>>) -> CoreState {
    let s = shared.lock().unwrap_or_else(|e| e.into_inner());
    if s.core_url.is_empty() {
        if s.last_error.is_empty() {
            CoreState::Idle
        } else {
            CoreState::SpawnErr
        }
    } else if s.core_alive {
        CoreState::Ready
    } else {
        CoreState::Crashed
    }
}

/// set_system_proxy — включить/выключить системный прокси (F5, FR-UI-221/222).
/// Включение сохраняет снимок прежних настроек; выключение — восстанавливает.
/// Прокси указывает на mixed-инбаунд ядра (127.0.0.1:<port>).
#[tauri::command]
fn set_system_proxy(
    shared: tauri::State<'_, Arc<Mutex<RuntimeState>>>,
    enabled: bool,
    port: u16,
) -> Result<String, String> {
    let data = {
        let s = shared.lock().map_err(|_| "state poisoned".to_string())?;
        if s.core_url.is_empty() || (enabled && !s.core_alive) {
            return Err("ядро не запущено".to_string());
        }
        data_dir()
    };
    let sp = SysProxy::new(&data);
    if enabled {
        if port == 0 {
            return Err("порт mixed-инбаунда не задан".to_string());
        }
        let applied = sp.enable("127.0.0.1", port)?;
        Ok(format!("{}:{}", applied.host, applied.port))
    } else {
        sp.disable()?;
        Ok(String::new())
    }
}

/// request_quit — попросить надзирателя остановить ядро перед выходом (D2).
#[tauri::command]
fn request_quit(shared: tauri::State<'_, Arc<Mutex<RuntimeState>>>) {
    if let Ok(mut s) = shared.lock() {
        s.shutdown = true;
    }
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
        let state = app.try_state::<Arc<Mutex<RuntimeState>>>();
        if let Some(state) = &state {
            // надзиратель остановит ядро лестницей §5
            state.lock().unwrap_or_else(|e| e.into_inner()).shutdown = true;
        }
        tray_ui::hide(&app);
        // Прокси снимаем до выхода: иначе в ОС остаётся прокси на мёртвый порт.
        let _ = SysProxy::new(&data_dir()).release_on_quit();
        let stopped = || {
            state
                .as_ref()
                .is_none_or(|s| s.lock().unwrap_or_else(|e| e.into_inner()).core_stopped)
        };
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

/// Закрытие окна = скрыть в трей (спека §8.1), как системный крестик.
#[tauri::command]
fn window_hide(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
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

/// spawn_core — запуск lavray-core (рядом с shell-бинарником) по спеке §3:
/// токен в stdin, ждём LAVRAY_CORE_READY, адрес отдаём UI.
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

fn spawn_core() -> Result<((String, String), RealCoreProcess), String> {
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
    let core_bin = find_trusted_core(
        &[
            dir.join("binaries").join(core_name),
            dir.join("resources").join("binaries").join(core_name),
            dir.join("resources").join(core_name),
        ],
        CORE_SHA256,
    )?;
    // D5: данные — в пользовательском каталоге на всех ОС. APPDATA есть
    // только на Windows; на macOS/Linux каталог рядом с .app//opt был бы
    // read-only, а create_dir_all тихо возвращал None.
    let data_dir = data_dir();
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("каталог данных {}: {e}", data_dir.display()))?;

    let token = generate_auth_token().map_err(|e| format!("токен ядра: {e}"))?;
    // listen_socket — TCP-addrs строка "127.0.0.1:0" (§3.1: порт выделяет ОС).
    let cfg = CoreSpawnConfig {
        binary: core_bin,
        data_dir,
        listen_socket: std::path::PathBuf::from("127.0.0.1:0"),
        auth_token: SecretToken::from_base64url(token.expose()).map_err(|e| e.to_string())?,
        extra_args: vec![],
    };
    let mut proc = RealCoreProcess::new();
    proc.spawn(&cfg)
        .map_err(|e| format!("не удалось запустить ядро: {e}"))?;
    let endpoint = proc
        .wait_ready(std::time::Duration::from_secs(10))
        .map_err(|e| format!("ядро не сообщило готовность: {e}"))?;
    Ok(((endpoint.transport_url, token.expose().to_string()), proc))
}

/// Окружение надзирателя: состояние оболочки, событие UI, системный прокси.
struct ShellHost {
    app: tauri::AppHandle,
    shared: Arc<Mutex<RuntimeState>>,
}

impl ShellHost {
    fn emit_endpoint(&self, event: &EndpointEvent) {
        if let Err(e) = self.app.emit_to("main", CORE_ENDPOINT_EVENT, event.clone()) {
            eprintln!("LAVRay: не удалось отправить {CORE_ENDPOINT_EVENT}: {e}");
        }
    }
}

impl SupervisorHost for ShellHost {
    fn quitting(&self) -> bool {
        self.shared.lock().map(|s| s.shutdown).unwrap_or(true)
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

    fn pause(&self, duration: std::time::Duration) {
        std::thread::sleep(duration);
    }
}

fn main() {
    let runtime = Arc::new(Mutex::new(RuntimeState::default()));
    let rt_for_setup = Arc::clone(&runtime);
    let hub = Arc::new(EndpointHub::default());
    let hub_for_setup = Arc::clone(&hub);
    tauri::Builder::default()
        // Сингл-инстанс (shell-lifecycle §8.1): второй запуск фокусирует окно.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray_ui::show_main_window(app); // свёрнутое окно тоже разворачиваем
        }))
        .manage(Arc::clone(&runtime))
        .manage(hub)
        .setup(move |app| {
            // F5/FR-UI-259: если прошлая сессия упала с включённым прокси,
            // возвращаем системные настройки ДО запуска нового ядра.
            match SysProxy::new(&data_dir()).recover_if_needed() {
                Ok(true) => eprintln!("LAVRay: восстановлены системные настройки прокси"),
                Ok(false) => {}
                Err(e) => eprintln!("LAVRay: не удалось восстановить прокси: {e}"),
            }

            // D3 (аудит round 2): надзор. Процесс живёт в отдельном потоке
            // (сырые handle не Send) и перезапускается с backoff, если ядро
            // умерло не по команде. T-03: цикл — `endpoint::run_supervisor`
            // (тестируется без GUI); при каждом запуске и при смерти ядра UI
            // получает событие `core-endpoint`, при смерти снимается прокси.
            let host = ShellHost {
                app: app.handle().clone(),
                shared: Arc::clone(&rt_for_setup),
            };
            let hub = Arc::clone(&hub_for_setup);
            std::thread::spawn(move || {
                // T-45: отметка «надзиратель закончил» — `begin_quit` ждёт её до 16 с.
                let _stopped = CoreStopped(Arc::clone(&host.shared));
                run_supervisor(&hub, &host, || {
                    spawn_core().map(|((url, token), process)| (url, token, process))
                });
            });
            // Трей (DS §9, §10): меню по TrayMenuSpec, состояние и тексты
            // присылает UI (`tray_update`); закрытие окна — в трей.
            tray_ui::install(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // D1 (аудит round 2): клик по X прячет окно в трей, а не убивает
            // приложение — иначе трей оставался без окна, а ядро гасилось
            // без graceful-teardown.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            // Тема окна сменилась — значок трея под другую панель задач.
            tauri::WindowEvent::ThemeChanged(_) => tray_ui::refresh(window.app_handle()),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            protocol_version,
            core_state,
            core_endpoint,
            shell_error,
            request_quit,
            quit_app,
            tray_update,
            window_minimize,
            window_toggle_maximize,
            window_is_maximized,
            window_hide,
            window_start_drag,
            set_system_proxy
        ])
        .build(tauri::generate_context!())
        .expect("LAVRay shell: failed to build tauri application")
        .run(|_app, event| {
            on_run_event(&event, || {
                let _ = SysProxy::new(&data_dir()).release_on_quit();
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
