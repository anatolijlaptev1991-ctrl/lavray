// SPDX-License-Identifier: GPL-3.0-only

//! Тесты kill switch системного прокси: подставной управляющий и подставной
//! бэкенд ОС. Настоящий системный прокси, реестр и WinINET не затрагиваются.

use super::*;
use crate::sysproxy::{set_with, Backend, ProxySnapshot, SysProxy};
use std::cell::{Cell, RefCell};

/// Управляющий прокси: считает снятия.
struct FakeProxy {
    fail: bool,
    released: Cell<u32>,
}

impl FakeProxy {
    fn new() -> Self {
        Self {
            fail: false,
            released: Cell::new(0),
        }
    }
}

impl ProxyControl for FakeProxy {
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
    let proxy = FakeProxy::new();
    let outcome = handle_exit(&proxy, Exit::CoreCrashed, true, true);
    assert_eq!(outcome, Outcome::Kept);
    assert_eq!(proxy.released.get(), 0, "прокси остаётся на месте");
}

#[test]
fn crash_releases_when_off() {
    let proxy = FakeProxy::new();
    let outcome = handle_exit(&proxy, Exit::CoreCrashed, false, true);
    assert_eq!(outcome, Outcome::Released);
    assert_eq!(proxy.released.get(), 1);
}

#[test]
fn quit_always_releases() {
    for kill_switch in [false, true] {
        let proxy = FakeProxy::new();
        let outcome = handle_exit(&proxy, Exit::Quit, kill_switch, true);
        assert_eq!(outcome, Outcome::Released, "kill switch = {kill_switch}");
        assert_eq!(proxy.released.get(), 1, "kill switch = {kill_switch}");
    }
}

/// Прокси не наш (или уже снят): держать нечего, вызов снятия безвреден.
#[test]
fn crash_with_kill_switch_but_proxy_not_active_just_releases() {
    let proxy = FakeProxy::new();
    assert_eq!(
        handle_exit(&proxy, Exit::CoreCrashed, true, false),
        Outcome::Released
    );
    assert_eq!(proxy.released.get(), 1);
}

#[test]
fn release_failure_is_reported() {
    let proxy = FakeProxy {
        fail: true,
        ..FakeProxy::new()
    };
    assert_eq!(
        handle_exit(&proxy, Exit::Quit, false, true),
        Outcome::Failed("нет доступа".into())
    );
}

#[test]
fn keeps_proxy_only_on_crash_with_kill_switch() {
    assert!(keeps_proxy(Exit::CoreCrashed, true));
    assert!(!keeps_proxy(Exit::CoreCrashed, false));
    assert!(!keeps_proxy(Exit::Quit, true));
}

#[test]
fn successful_set_system_proxy_ends_the_kept_state() {
    let flags = ProxyFlags::default();
    flags.set_active(true);
    flags.set_kept(true);
    flags.on_proxy_set(false);
    assert!(!flags.is_active() && !flags.is_kept(), "прокси снят");
    flags.set_kept(true);
    flags.on_proxy_set(true);
    assert!(
        flags.is_active() && !flags.is_kept(),
        "включён заново на живое ядро"
    );
}

#[test]
fn flags_start_clear_and_hold_what_was_set() {
    let flags = ProxyFlags::default();
    assert!(!flags.is_active() && !flags.is_kept());
    flags.set_active(true);
    flags.set_kept(true);
    assert!(flags.is_active() && flags.is_kept());
    flags.set_kept(false);
    assert!(flags.is_active() && !flags.is_kept());
}

// ---- порядок действий при смерти ядра ----

/// Записывает вызовы по порядку; события фиксируют, стоял ли флаг к их отправке.
struct FakeSink {
    outcome: Outcome,
    calls: RefCell<Vec<String>>,
    flags: ProxyFlags,
}

impl FakeSink {
    fn new(outcome: Outcome) -> Self {
        Self {
            outcome,
            calls: RefCell::new(Vec::new()),
            flags: ProxyFlags::default(),
        }
    }

    fn log(&self, what: &str) {
        self.calls.borrow_mut().push(what.to_string());
    }
}

impl CrashSink for FakeSink {
    fn decide(&self) -> Outcome {
        self.log("decide");
        self.outcome.clone()
    }

    fn record(&self, outcome: &Outcome) {
        self.log("record");
        self.flags.set_kept(*outcome == Outcome::Kept);
    }

    fn emit_kept(&self) {
        self.log(&format!("emit_kept(flag={})", self.flags.is_kept()));
    }

    fn emit_down(&self) {
        self.log(&format!("emit_down(flag={})", self.flags.is_kept()));
    }
}

/// Главное: «адрес пропал» не должен уйти раньше, чем стоит флаг «оставлен», иначе
/// окно успеет снять прокси само (следование за ядром).
#[test]
fn kept_flag_is_set_before_any_event() {
    let sink = FakeSink::new(Outcome::Kept);
    assert_eq!(handle_core_crash(&sink), Outcome::Kept);
    assert_eq!(
        *sink.calls.borrow(),
        [
            "decide",
            "record",
            "emit_kept(flag=true)",
            "emit_down(flag=true)"
        ],
    );
}

#[test]
fn released_crash_sends_only_the_down_event_and_no_flag() {
    let sink = FakeSink::new(Outcome::Released);
    handle_core_crash(&sink);
    assert_eq!(
        *sink.calls.borrow(),
        ["decide", "record", "emit_down(flag=false)"]
    );
}

#[test]
fn failed_release_does_not_pretend_the_proxy_was_kept() {
    let sink = FakeSink::new(Outcome::Failed("нет доступа".into()));
    handle_core_crash(&sink);
    assert!(!sink.flags.is_kept());
    assert_eq!(
        sink.calls.borrow().last().map(String::as_str),
        Some("emit_down(flag=false)")
    );
}

// ---- сквозной путь: настоящий SysProxy на подставном бэкенде ----

/// «ОС» в памяти: одна запись про прокси. `warn_on_restore` — возврат прежних
/// настроек удался с предупреждением (RAS/WPAD): снимок остаётся для повтора.
struct MemBackend {
    state: RefCell<serde_json::Value>,
    warn_on_restore: Cell<bool>,
}

impl MemBackend {
    fn new() -> Self {
        Self {
            state: RefCell::new(serde_json::json!({"enabled": false, "server": ""})),
            warn_on_restore: Cell::new(false),
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
        Ok(if self.warn_on_restore.get() {
            vec!["RAS: подключение не вернулось".to_string()]
        } else {
            Vec::new()
        })
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
fn real_manager_keeps_then_set_system_proxy_false_releases() {
    let dir = temp_dir();
    let os = MemBackend::new();
    let sp = SysProxy::with_backend(&dir, &os);
    sp.enable("127.0.0.1", 2080).unwrap();

    // Ядро упало, kill switch включён: прокси на месте, снимок цел.
    assert_eq!(
        handle_exit(&sp, Exit::CoreCrashed, true, true),
        Outcome::Kept
    );
    assert!(os.enabled(), "прокси остался включённым");

    // Пользователь нажал «Отключить» — это set_system_proxy(false): kill switch не мешает.
    set_with(&sp, false, 0).unwrap();
    assert!(!os.enabled(), "прежние настройки возвращены");
    assert!(sp.pending_snapshot().is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

/// `set_system_proxy(false)` — настоящий путь «Отключить»: ни kill switch, ни
/// состояние «оставлен» ему не мешают.
#[test]
fn disconnect_releases() {
    for kept in [false, true] {
        let dir = temp_dir();
        let os = MemBackend::new();
        let sp = SysProxy::with_backend(&dir, &os);
        sp.enable("127.0.0.1", 2080).unwrap();
        let flags = ProxyFlags::default();
        flags.set_active(true);
        flags.set_kept(kept);
        set_with(&sp, false, 0).unwrap();
        assert!(!os.enabled(), "kept = {kept}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn real_manager_quit_releases_after_kept_crash() {
    let dir = temp_dir();
    let os = MemBackend::new();
    let sp = SysProxy::with_backend(&dir, &os);
    sp.enable("127.0.0.1", 2080).unwrap();
    assert_eq!(
        handle_exit(&sp, Exit::CoreCrashed, true, true),
        Outcome::Kept
    );

    assert_eq!(handle_exit(&sp, Exit::Quit, true, true), Outcome::Released);
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
        handle_exit(&sp, Exit::CoreCrashed, false, true),
        Outcome::Released
    );
    assert!(!os.enabled());
    let _ = std::fs::remove_dir_all(&dir);
}

/// Снимок после предупреждений RAS/WPAD остаётся у уже СНЯТОГО прокси. Раньше
/// «наш прокси» определялся по снимку, и падение ядра давало ложное «прокси оставлен».
#[test]
fn leftover_snapshot_after_warnings_is_not_a_kept_proxy() {
    let dir = temp_dir();
    let os = MemBackend::new();
    let sp = SysProxy::with_backend(&dir, &os);
    let flags = ProxyFlags::default();
    sp.enable("127.0.0.1", 2080).unwrap();
    flags.set_active(true);

    os.warn_on_restore.set(true);
    let warnings = set_with(&sp, false, 0).unwrap().warnings;
    flags.set_active(false);
    assert!(!warnings.is_empty());
    assert!(
        sp.pending_snapshot().is_some(),
        "снимок остался для повтора"
    );

    // Ядро падает при включённом kill switch: прокси уже снят, оставлять нечего.
    let outcome = handle_exit(&sp, Exit::CoreCrashed, true, flags.is_active());
    assert_eq!(outcome, Outcome::Released);
    assert!(!flags.is_kept());
    let _ = std::fs::remove_dir_all(&dir);
}
