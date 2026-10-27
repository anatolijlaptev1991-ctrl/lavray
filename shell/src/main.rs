//! Точка входа LAVRay shell (Tauri 2).
//!
//! Спек §10: single instance, deep-link, трей, окна, онбординг — итерации
//! после скаффолда. Сейчас: окно с placeholder-фронтендом
//! (`desktop-placeholder/`) и две diagnostic-команды IPC. Вся логика — в
//! библиотечной части (`lavray_shell`), тестируемой без GUI.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lavray_shell::coreproc::driver::{generate_auth_token, RealCoreProcess};
use lavray_shell::coreproc::{CoreProcess, CoreSpawnConfig, CoreState, SecretToken};
use lavray_shell::uiprotocol::IPC_PROTOCOL_VERSION;
use std::sync::{Arc, Mutex};

/// Версия протокола UI ↔ shell (`uiprotocol.rs`).
#[tauri::command]
fn protocol_version() -> u32 {
    IPC_PROTOCOL_VERSION
}

/// Общее состояние ядра процесса (адрес/токен для UI-фронтенда).
#[derive(Default)]
struct RuntimeState {
    core_url: String,
    core_token: String,
}

/// Адрес ConnectRPC-ядра для UI (вызывается фронтендом при старте).
#[tauri::command]
fn core_endpoint(state: tauri::State<'_, Arc<Mutex<RuntimeState>>>) -> (String, String) {
    let s = state.lock().unwrap_or_else(|e| e.into_inner());
    (s.core_url.clone(), s.core_token.clone())
}

#[tauri::command]
fn core_state(shared: tauri::State<'_, Arc<Mutex<RuntimeState>>>) -> CoreState {
    let s = shared.lock().unwrap_or_else(|e| e.into_inner());
    if s.core_url.is_empty() {
        CoreState::Idle
    } else {
        CoreState::Ready
    }
}

/// spawn_core — запуск lavray-core (рядом с shell-бинарником) по спеке §3:
/// токен в stdin, ждём LAVRAY_CORE_READY, адрес отдаём UI.
fn spawn_core() -> Option<(String, String)> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    let core_name = if cfg!(windows) {
        "lavray-core.exe"
    } else {
        "lavray-core"
    };
    // Tauri сохраняет resources, зеркаля относительный путь: установка кладёт
    // ядро в <exe_dir>/binaries/. Порядок: рядом, binaries/, resources/.
    let core_bin = [
        dir.join(core_name),
        dir.join("binaries").join(core_name),
        dir.join("resources").join(core_name),
    ]
    .into_iter()
    .find(|p| p.exists())?;
    // Данные — в пользовательском каталоге: perMachine-установка в Program
    // Files не даёт писать не-админу (LNB-класс: «данные рядом с exe» ломается).
    let data_dir = std::env::var_os("APPDATA")
        .map(std::path::PathBuf::from)
        .map(|p| p.join("LAVRay"))
        .unwrap_or_else(|| dir.join("data"));
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
    if proc.spawn(&cfg).is_err() {
        return None;
    }
    match proc.wait_ready(std::time::Duration::from_secs(10)) {
        Ok(endpoint) => {
            // Процесс должен жить всё время работы приложения: утечка
            // намеренная (Box::leak), kill — по смерти родителя (PDEATHSIG/Job).
            std::mem::forget(proc);
            Some((endpoint.transport_url, token.expose().to_string()))
        }
        Err(_) => None,
    }
}

fn main() {
    let runtime = Arc::new(Mutex::new(RuntimeState::default()));
    let rt_for_setup = Arc::clone(&runtime);
    tauri::Builder::default()
        .manage(Arc::clone(&runtime))
        .setup(move |app| {
            if let Some((url, tok)) = spawn_core() {
                if let Ok(mut s) = rt_for_setup.lock() {
                    s.core_url = url;
                    s.core_token = tok;
                }
            }
            // Окно создаётся из tauri.conf.json автоматически.
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            protocol_version,
            core_state,
            core_endpoint
        ])
        .run(tauri::generate_context!())
        .expect("LAVRay shell: failed to run tauri application");
}
