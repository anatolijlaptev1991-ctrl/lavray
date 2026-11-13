// SPDX-License-Identifier: GPL-3.0-only

//! Список команд оболочки для `invoke` (T-82) — единственное место регистрации.
//!
//! Команда, объявленная `#[tauri::command]`, но не попавшая сюда, в окне
//! отвечает «command not found». `tests/main_wiring.rs` сверяет этот список с
//! объявлениями во всех файлах `src/`. Команды из `main.rs` — `super::…`,
//! команды библиотеки — полным путём `lavray_shell::…`.

/// Обработчик `invoke` главного окна.
pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        super::protocol_version,
        super::is_elevated,
        super::core_state,
        super::core_endpoint,
        super::shell_error,
        super::request_quit,
        super::quit_app,
        super::tray_update,
        super::core_log_tail,
        super::restart_core,
        super::window_minimize,
        super::window_toggle_maximize,
        super::window_is_maximized,
        super::window_hide,
        super::window_start_drag,
        super::set_system_proxy,
        super::relaunch_elevated,
        super::launch_info,
        super::ui_state_load,
        super::ui_state_set,
        super::window_show,
        super::autostart_state,
        super::set_autostart,
        super::agent_access_set,
        super::agent_core_path,
        lavray_shell::os_integration::notify_show,
        lavray_shell::killswitch::proxy_kept,
        lavray_shell::hotkey::hotkey_set,
        lavray_shell::files::file_save,
        lavray_shell::files::pick::file_pick_folder,
        lavray_shell::capture::qr_capture_screen,
        lavray_shell::update::wiring::update_apply,
        lavray_shell::update::wiring::update_rollback,
        lavray_shell::update::wiring::update_health_ok,
        lavray_shell::update::wiring::update_previous_info,
        lavray_shell::update::pick::update_pick_installer,
        lavray_shell::shellcaps::shell_capabilities,
        lavray_shell::tunaccess::commands::tun_access_state,
        lavray_shell::tunaccess::commands::tun_access_grant,
    ]
}
