// SPDX-License-Identifier: GPL-3.0-only

//! Старт окна и трея: сбой значка не обрывает запуск, а без трея окно
//! сворачивается, а не прячется.

use crate::tray_ui::{install, show_main_window};
use lavray_shell::window_policy::StartMode;
use tauri::{AppHandle, Manager};

/// Создать трей; сбой — в журнал, а не обрыв запуска: значок не создался (нет
/// сервиса трея, ошибка библиотеки) — окно остаётся на виду ([`StartMode::Show`]),
/// и «закрытие в трей» его больше не прячет.
pub fn install_logged(app: &tauri::App, start: StartMode) -> StartMode {
    match install(app) {
        Ok(()) => start,
        Err(e) => {
            eprintln!("LAVRay: значок в трее не создан: {e}");
            lavray_shell::shellcaps::mark_tray_failed();
            StartMode::Show
        }
    }
}

/// Привести главное окно в стартовое состояние. Окно создаётся скрытым
/// (`visible: false`): так `--tray` не мигает им на старте.
pub fn apply_start(app: &AppHandle, start: StartMode) {
    match start {
        StartMode::Hidden => {}
        StartMode::Show => show_main_window(app),
        StartMode::Minimized => minimize_unless_tray_appears(app.clone()),
    }
}

/// Трея на старте нет, но расширение GNOME могло просто не успеть занять имя на
/// шине: окно остаётся скрытым, пока фоновый опрос ждёт трей (до ~5 с). Появился —
/// окно так и остаётся в трее; нет — показывается и сворачивается (с паузой:
/// `minimize()` сразу после `show` на Wayland может не сработать).
fn minimize_unless_tray_appears(app: AppHandle) {
    std::thread::spawn(move || {
        if lavray_shell::shellcaps::wait_tray(std::time::Duration::from_secs(6)) == Some(true) {
            return;
        }
        let shown = app.clone();
        let _ = app.run_on_main_thread(move || show_main_window(&shown));
        std::thread::sleep(std::time::Duration::from_millis(400));
        let target = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(window) = target.get_webview_window("main") {
                let _ = window.minimize();
                lavray_shell::window_visibility::report_as(&target, false);
            }
        });
    });
}
