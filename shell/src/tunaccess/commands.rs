// SPDX-License-Identifier: GPL-3.0-only

//! Команды Tauri доступа к TUN: `tun_access_state` и `tun_access_grant`. Без
//! аргументов от интерфейса: путь ядра оболочка определяет сама, тем же
//! способом, что при запуске ядра (`integrity`).

use super::{decide, manual_command, needs_core_restart, Access, Facts};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

/// Ответ `tun_access_state`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunAccessState {
    /// `ready`, `grantable`, `manual`, `unavailable` или `elevate` (Windows).
    pub state: &'static str,
    /// Причина `manual`/`unavailable`: `core_not_found`, `not_secure`,
    /// `no_pkexec`, `no_setcap`; для `unavailable`: `appimage`, `nosuid`,
    /// `read_only`; иначе пусто.
    pub reason: String,
    /// Готовая команда для терминала (`grantable`, `manual`), иначе пусто.
    pub command: String,
    /// Права у файла ядра есть, а работающее ядро их не получило: перезапустить ядро.
    pub needs_core_restart: bool,
}

fn answer(state: &'static str, reason: &str, command: String, restart: bool) -> TunAccessState {
    TunAccessState {
        state,
        reason: reason.to_string(),
        command,
        needs_core_restart: restart,
    }
}

/// Ответ по собранным фактам (Linux).
#[must_use]
pub fn render(facts: &Facts) -> TunAccessState {
    let command = facts
        .core
        .as_ref()
        .map(|c| manual_command(&c.path))
        .unwrap_or_default();
    let restart = needs_core_restart(facts);
    match decide(facts) {
        Access::Ready => answer("ready", "", String::new(), restart),
        Access::Grantable => answer("grantable", "", command, restart),
        Access::Manual(reason) => answer("manual", reason, command, restart),
        Access::Unavailable(reason) => answer("unavailable", reason, String::new(), restart),
    }
}

/// Ответ вне Linux (Windows, macOS): старый поток — права у самого процесса.
#[must_use]
pub fn elevation_state(elevated: bool) -> TunAccessState {
    let state = if elevated { "ready" } else { "elevate" };
    answer(state, "", String::new(), false)
}

#[cfg(target_os = "linux")]
fn current_state() -> TunAccessState {
    render(&super::probe::gather(false))
}

#[cfg(not(target_os = "linux"))]
fn current_state() -> TunAccessState {
    elevation_state(crate::elevation::is_elevated())
}

/// Сколько ждать `pkexec`: человек вводит пароль в окне PolicyKit.
#[cfg(target_os = "linux")]
const GRANT_TIMEOUT: std::time::Duration = std::time::Duration::from_mins(5);

/// Выдача прав уже идёт: второй вызов получает `busy`.
static GRANTING: AtomicBool = AtomicBool::new(false);

struct BusyGuard<'a>(&'a AtomicBool);

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Выполнить `run`, пока `flag` не занят; занят — `Err("busy")`. Флаг
/// освобождается при любом выходе, в том числе по панике.
pub fn guarded<T>(flag: &AtomicBool, run: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    if flag.swap(true, Ordering::SeqCst) {
        return Err("busy".into());
    }
    let _guard = BusyGuard(flag);
    run()
}

#[cfg(target_os = "linux")]
fn grant_now() -> Result<(), String> {
    let facts = super::probe::gather(true);
    super::grant_with(&facts, |program, args| {
        crate::exec::run_timeout(
            std::process::Command::new(program).args(args),
            GRANT_TIMEOUT,
        )
    })
}

#[cfg(not(target_os = "linux"))]
fn grant_now() -> Result<(), String> {
    Err("not_grantable".into())
}

/// `tun_access_state` — можно ли поднять TUN и что для этого сделать.
#[tauri::command]
pub async fn tun_access_state() -> Result<TunAccessState, String> {
    tauri::async_runtime::spawn_blocking(current_state)
        .await
        .map_err(|e| e.to_string())
}

/// `tun_access_grant` — выдать ядру права на TUN через `pkexec setcap`. Ошибки:
/// `cancelled`, `not_grantable`, `busy` (уже идёт), `failed: <текст>`.
#[tauri::command]
pub async fn tun_access_grant() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| guarded(&GRANTING, grant_now))
        .await
        .map_err(|e| e.to_string())
        .and_then(|result| result)
}
