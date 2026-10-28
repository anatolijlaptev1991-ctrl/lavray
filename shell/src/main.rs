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
use lavray_shell::sysproxy::SysProxy;
use lavray_shell::uiprotocol::IPC_PROTOCOL_VERSION;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

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

/// recover_system_proxy — откат незакрытого снимка после падения прошлой
/// сессии (FR-UI-259: «система не остаётся с прокси на мёртвый порт»).
#[tauri::command]
fn recover_system_proxy() -> Result<bool, String> {
    SysProxy::new(&data_dir()).recover_if_needed()
}

/// request_quit — попросить надзирателя остановить ядро перед выходом (D2).
#[tauri::command]
fn request_quit(shared: tauri::State<'_, Arc<Mutex<RuntimeState>>>) {
    if let Ok(mut s) = shared.lock() {
        s.shutdown = true;
    }
}

/// quit_app — полный выход из приложения по пункту меню «Выход».
/// Отличается от закрытия окна (которое прячет его в трей): сначала
/// помечаем остановку ядра, ждём graceful-лестницу надзирателя, затем
/// выходим из цикла событий.
///
/// Асинхронная: `sleep` в синхронной команде выполнялся на главном потоке
/// и подвешивал UI перед закрытием. Прокси снимается ДО выхода — иначе в
/// ОС остаётся прокси на мёртвый порт до следующего запуска.
#[tauri::command]
async fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(shared) = app.try_state::<Arc<Mutex<RuntimeState>>>() {
        if let Ok(mut s) = shared.lock() {
            s.shutdown = true;
        }
    }
    let _ = SysProxy::new(&data_dir()).release_on_quit();
    // Клиенту (UI) даём закрыться, а ядро гасит надзиратель своей
    // graceful-лестницей (§5) уже после выхода цикла событий: держать
    // главный поток сном нельзя — окно «зависает» на секунду.
    app.exit(0);
    Ok(())
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

fn spawn_core() -> Option<((String, String), RealCoreProcess)> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    let core_name = if cfg!(windows) {
        "lavray-core.exe"
    } else {
        "lavray-core"
    };
    // D6/D7 (аудит round 2): ядро ищется ТОЛЬКО в установленных ресурсах.
    // Раньше первым шёл каталог рядом с exe — в portable-режиме это позволяло
    // подменить lavray-core.exe без каких-либо проверок. .is_file() вместо
    // .exists() (каталог с таким именем больше не считается бинарником).
    let core_bin = [
        dir.join("binaries").join(core_name),
        dir.join("resources").join("binaries").join(core_name),
        dir.join("resources").join(core_name),
    ]
    .into_iter()
    .find(|p| p.is_file())?;
    // D5: данные — в пользовательском каталоге на всех ОС. APPDATA есть
    // только на Windows; на macOS/Linux каталог рядом с .app//opt был бы
    // read-only, а create_dir_all тихо возвращал None.
    let data_dir = data_dir();
    std::fs::create_dir_all(&data_dir).ok()?;

    let token = generate_auth_token().ok()?;
    // listen_socket — TCP-addrs строка "127.0.0.1:0" (§3.1: порт выделяет ОС).
    let cfg = CoreSpawnConfig {
        binary: core_bin,
        data_dir,
        listen_socket: std::path::PathBuf::from("127.0.0.1:0"),
        auth_token: SecretToken::from_base64url(token.expose()).ok()?,
        extra_args: vec![],
    };
    let mut proc = RealCoreProcess::new();
    if let Err(e) = proc.spawn(&cfg) {
        eprintln!("LAVRay: не удалось запустить ядро: {e}");
        return None;
    }
    match proc.wait_ready(std::time::Duration::from_secs(10)) {
        Ok(endpoint) => Some(((endpoint.transport_url, token.expose().to_string()), proc)),
        Err(e) => {
            eprintln!("LAVRay: ядро не сообщило готовность: {e}");
            None
        }
    }
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
    }

    fn core_down(&self, reason: &str) {
        if let Ok(mut s) = self.shared.lock() {
            s.core_alive = false;
            s.last_error = reason.to_string();
        }
        self.emit_endpoint(&EndpointEvent::down());
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
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
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
                run_supervisor(&hub, &host, || {
                    spawn_core().map(|((url, token), process)| (url, token, process))
                });
            });
            // Трей (DS §10): показать окно / выйти; закрытие окна — в трей.
            let show = MenuItem::with_id(app, "show", "Открыть LAVRay", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        // D2: перед выходом останавливаем ядро (graceful-стоп),
                        // иначе оно убивалось вместе с процессом мимо лестницы §5.
                        if let Some(state) = app.try_state::<Arc<Mutex<RuntimeState>>>() {
                            if let Ok(mut s) = state.lock() {
                                s.shutdown = true;
                            }
                        }
                        // Прокси снимаем до выхода: иначе в ОС остаётся
                        // прокси на мёртвый порт (как и в quit_app).
                        let _ = SysProxy::new(&data_dir()).release_on_quit();
                        // Надзиратель гасит ядро через graceful-лестницу §5.
                        std::thread::sleep(std::time::Duration::from_millis(1200));
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // D1 (аудит round 2): клик по X прячет окно в трей, а не убивает
            // приложение — иначе трей оставался без окна, а ядро гасилось
            // без graceful-teardown.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            protocol_version,
            core_state,
            core_endpoint,
            shell_error,
            request_quit,
            quit_app,
            window_minimize,
            window_toggle_maximize,
            window_is_maximized,
            window_hide,
            window_start_drag,
            set_system_proxy,
            recover_system_proxy
        ])
        .run(tauri::generate_context!())
        .expect("LAVRay shell: failed to run tauri application");
}
