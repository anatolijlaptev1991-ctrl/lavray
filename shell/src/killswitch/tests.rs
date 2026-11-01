// SPDX-License-Identifier: GPL-3.0-only

//! Тесты kill switch системного прокси: подставной управляющий и подставной
//! бэкенд ОС. Настоящий системный прокси, реестр и WinINET не затрагиваются.

use super::*;
use crate::sysproxy::{Backend, ProxySnapshot, SysProxy};
use std::cell::{Cell, RefCell};

/// Управляющий прокси: считает снятия.
struct FakeProxy {
    ours: bool,
    fail: bool,
    released: Cell<u32>,
}

impl FakeProxy {
    fn new(ours: bool) -> Self {
        Self {
            ours,
            fail: false,
            released: Cell::new(0),
        }
    }
}

impl ProxyControl for FakeProxy {
    fn is_ours(&self) -> bool {
        self.ours
    }

    fn release(&self) -> Result<(), String> {
        self.released.set(self.released.get() + 1);
        if self.fail {
            Err("нет доступа".into())
        } else {
            Ok(())
        }
    }
}

#[test]
fn crash_keeps_proxy_when_kill_switch() {
    let proxy = FakeProxy::new(true);
    let outcome = handle_exit(&proxy, Exit::CoreCrashed, true);
    assert_eq!(outcome, Outcome::Kept);
    assert_eq!(proxy.released.get(), 0, "прокси остаётся на месте");
}

#[test]
fn crash_releases_when_off() {
    let proxy = FakeProxy::new(true);
    let outcome = handle_exit(&proxy, Exit::CoreCrashed, false);
    assert_eq!(outcome, Outcome::Released);
    assert_eq!(proxy.released.get(), 1);
}

#[test]
fn quit_always_releases() {
    for kill_switch in [false, true] {
        let proxy = FakeProxy::new(true);
        let outcome = handle_exit(&proxy, Exit::Quit, kill_switch);
        assert_eq!(outcome, Outcome::Released, "kill switch = {kill_switch}");
        assert_eq!(proxy.released.get(), 1, "kill switch = {kill_switch}");
    }
}

#[test]
fn disconnect_releases() {
    for kill_switch in [false, true] {
        let proxy = FakeProxy::new(true);
        let outcome = handle_exit(&proxy, Exit::Disconnect, kill_switch);
        assert_eq!(outcome, Outcome::Released, "kill switch = {kill_switch}");
        assert_eq!(proxy.released.get(), 1, "kill switch = {kill_switch}");
    }
}

/// Прокси выставили не мы (или его нет): держать нечего, вызов снятия безвреден.
#[test]
fn crash_with_kill_switch_but_foreign_proxy_just_releases() {
    let proxy = FakeProxy::new(false);
    assert_eq!(
        handle_exit(&proxy, Exit::CoreCrashed, true),
        Outcome::Released
    );
    assert_eq!(proxy.released.get(), 1);
}

#[test]
fn release_failure_is_reported() {
    let proxy = FakeProxy {
        fail: true,
        ..FakeProxy::new(true)
    };
    assert_eq!(
        handle_exit(&proxy, Exit::Quit, false),
        Outcome::Failed("нет доступа".into())
    );
}

#[test]
fn keeps_proxy_only_on_crash_with_kill_switch() {
    assert!(keeps_proxy(Exit::CoreCrashed, true));
    assert!(!keeps_proxy(Exit::CoreCrashed, false));
    assert!(!keeps_proxy(Exit::Disconnect, true));
    assert!(!keeps_proxy(Exit::Quit, true));
}

// ---- сквозной путь: настоящий SysProxy на подставном бэкенде ----

/// «ОС» в памяти: одна запись про прокси.
struct MemBackend {
    state: RefCell<serde_json::Value>,
}

impl MemBackend {
    fn new() -> Self {
        Self {
            state: RefCell::new(serde_json::json!({"enabled": false, "server": ""})),
        }
    }

    fn enabled(&self) -> bool {
        self.state.borrow()["enabled"] == true
    }
}

impl Backend for &MemBackend {
    fn capture(&self) -> Result<ProxySnapshot, String> {
        Ok(ProxySnapshot {
            version: 1,
            os: "test".into(),
            data: self.state.borrow().clone(),
        })
    }

    fn apply(&self, host: &str, port: u16, _: &ProxySnapshot) -> Result<Vec<String>, String> {
        *self.state.borrow_mut() =
            serde_json::json!({"enabled": true, "server": format!("{host}:{port}")});
        Ok(Vec::new())
    }

    fn restore(&self, snap: &ProxySnapshot) -> Result<Vec<String>, String> {
        *self.state.borrow_mut() = snap.data.clone();
        Ok(Vec::new())
    }
}

fn temp_dir() -> std::path::PathBuf {
    let mut random = [0u8; 6];
    getrandom::fill(&mut random).unwrap();
    let name: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let dir = std::env::temp_dir().join(format!("lavray-killswitch-{name}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn real_manager_keeps_then_releases_on_disconnect() {
    let dir = temp_dir();
    let os = MemBackend::new();
    let sp = SysProxy::with_backend(&dir, &os);
    sp.enable("127.0.0.1", 2080).unwrap();
    assert!(sp.is_ours() && os.enabled());

    // Ядро упало, kill switch включён: прокси на месте, снимок цел.
    assert_eq!(handle_exit(&sp, Exit::CoreCrashed, true), Outcome::Kept);
    assert!(os.enabled(), "прокси остался включённым");
    assert!(sp.is_ours(), "снимок сохранён для последующего снятия");

    // Пользователь нажал «Отключить»: прокси снимается, kill switch не мешает.
    assert_eq!(handle_exit(&sp, Exit::Disconnect, true), Outcome::Released);
    assert!(!os.enabled(), "прежние настройки возвращены");
    assert!(!sp.is_ours());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn real_manager_quit_releases_after_kept_crash() {
    let dir = temp_dir();
    let os = MemBackend::new();
    let sp = SysProxy::with_backend(&dir, &os);
    sp.enable("127.0.0.1", 2080).unwrap();
    assert_eq!(handle_exit(&sp, Exit::CoreCrashed, true), Outcome::Kept);

    assert_eq!(handle_exit(&sp, Exit::Quit, true), Outcome::Released);
    assert!(
        !os.enabled(),
        "выход вернул прокси, хотя kill switch включён"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn real_manager_crash_releases_when_off() {
    let dir = temp_dir();
    let os = MemBackend::new();
    let sp = SysProxy::with_backend(&dir, &os);
    sp.enable("127.0.0.1", 2080).unwrap();
    assert_eq!(
        handle_exit(&sp, Exit::CoreCrashed, false),
        Outcome::Released
    );
    assert!(!os.enabled());
    let _ = std::fs::remove_dir_all(&dir);
}
