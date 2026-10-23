//! Точка входа LAVRay shell (Tauri 2).
//!
//! Спек §10: single instance, deep-link, трей, окна, онбординг — итерации
//! после скаффолда. Сейчас: окно с placeholder-фронтендом
//! (`desktop-placeholder/`) и две diagnostic-команды IPC. Вся логика — в
//! библиотечной части (`lavray_shell`), тестируемой без GUI.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lavray_shell::coreproc::CoreState;
use lavray_shell::uiprotocol::IPC_PROTOCOL_VERSION;

/// Версия протокола UI ↔ shell (`uiprotocol.rs`).
#[tauri::command]
fn protocol_version() -> u32 {
    IPC_PROTOCOL_VERSION
}

/// Текущее состояние ядра. Заглушка: до врезки `CoreSupervisor` в рантайм
/// всегда Idle (реальный FSM жив в `coreproc` и покрыт тестами).
#[tauri::command]
fn core_state() -> CoreState {
    CoreState::Idle
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![protocol_version, core_state])
        .run(tauri::generate_context!())
        .expect("LAVRay shell: failed to run tauri application");
}
