// SPDX-License-Identifier: GPL-3.0-only

//! Есть ли значок в трее: на Linux — владелец имени `org.kde.StatusNotifierWatcher`
//! на сеансовой шине D-Bus. Ответ спрашивается у `gdbus` (пакет `libglib2.0-bin`) или
//! `dbus-send` с таймаутом; разбор ответа — чистая функция.

use super::watch::Watch;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Значок создать не удалось: трея для приложения нет, что бы ни ответила шина.
static CREATE_FAILED: AtomicBool = AtomicBool::new(false);

/// Запомнить, что значок в трее не создался: окно больше не прячется.
pub fn mark_tray_failed() {
    CREATE_FAILED.store(true, Ordering::Relaxed);
}

/// Имя на шине D-Bus, которое занимает сервис значков в трее.
#[cfg(target_os = "linux")]
const TRAY_WATCHER: &str = "org.kde.StatusNotifierWatcher";

/// Разобрать ответ `NameHasOwner` от `gdbus` (`(true,)`) или `dbus-send`
/// (`boolean true`).
#[must_use]
pub fn parse_name_has_owner(stdout: &str) -> Option<bool> {
    let text = stdout.trim();
    if text.starts_with("(true") || text.ends_with("boolean true") {
        Some(true)
    } else if text.starts_with("(false") || text.ends_with("boolean false") {
        Some(false)
    } else {
        None
    }
}

/// Спросить сеансовую шину: `Some(true)` — у имени есть владелец.
#[cfg(target_os = "linux")]
fn ask_bus(program: &str, args: &[&str]) -> Option<bool> {
    let limit = std::time::Duration::from_secs(2);
    let out = crate::exec::run_timeout(std::process::Command::new(program).args(args), limit);
    out.ok()
        .filter(crate::exec::Output::success)
        .and_then(|out| parse_name_has_owner(&out.stdout))
}

#[cfg(target_os = "linux")]
fn query_tray() -> bool {
    let method = "org.freedesktop.DBus.NameHasOwner";
    let gdbus = [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.DBus",
        "--object-path",
        "/org/freedesktop/DBus",
        "--method",
        method,
        TRAY_WATCHER,
    ];
    let name = format!("string:{TRAY_WATCHER}");
    let dbus_send = [
        "--session",
        "--print-reply",
        "--dest=org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        method,
        name.as_str(),
    ];
    ask_bus("gdbus", &gdbus)
        .or_else(|| ask_bus("dbus-send", &dbus_send))
        .unwrap_or(false)
}

/// Фоновый опрос процесса.
static WATCH: Watch = Watch::new();

/// Один опрос шины; «да» запоминается навсегда, «нет» — нет.
#[cfg(target_os = "linux")]
fn poll_now() -> bool {
    let seen = query_tray();
    if seen {
        WATCH.mark_seen();
    }
    seen
}

#[cfg(not(target_os = "linux"))]
fn poll_now() -> bool {
    true
}

/// Запустить фоновый опрос (Linux): до `POLL_TRIES` раз с шагом `POLL_STEP`,
/// пока трей не появится. Запуск не ждёт ответа. Вызывается при старте оболочки.
pub fn start_tray_watch() {
    #[cfg(target_os = "linux")]
    {
        WATCH.mark_started();
        let spawned = std::thread::Builder::new()
            .name("lavray-tray-watch".into())
            .spawn(|| {
                for attempt in 0..super::watch::POLL_TRIES {
                    if attempt > 0 {
                        std::thread::sleep(super::watch::POLL_STEP);
                    }
                    if poll_now() {
                        return;
                    }
                }
                WATCH.finish();
            });
        if spawned.is_err() {
            WATCH.finish();
        }
    }
}

/// Есть ли значок в трее сейчас (свежий опрос, если «да» ещё не видели). Linux:
/// у сеансовой шины есть владелец `org.kde.StatusNotifierWatcher` (на GNOME без
/// расширения его нет). Windows и macOS: всегда есть.
#[must_use]
pub fn tray_available() -> bool {
    !CREATE_FAILED.load(Ordering::Relaxed) && (WATCH.seen() || poll_now())
}

/// Дождаться итога фонового опроса не дольше `limit`: `Some(true)` — трей есть,
/// `Some(false)` — не дождались, `None` — опрос ещё идёт.
#[must_use]
pub fn wait_tray(limit: Duration) -> Option<bool> {
    if CREATE_FAILED.load(Ordering::Relaxed) {
        return Some(false);
    }
    if cfg!(target_os = "linux") {
        WATCH.wait(limit)
    } else {
        Some(true)
    }
}

/// Ответ для `shell_capabilities`: без запуска процессов, ждёт фон не дольше
/// `limit`; итога нет — оптимистично «есть» (настройки интерфейс перечитает).
#[must_use]
pub fn tray_for_caps(limit: Duration) -> bool {
    wait_tray(limit).unwrap_or(true)
}
