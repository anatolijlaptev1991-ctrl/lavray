// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::update::heartbeat::grace_ms;
use crate::update::testkit::Log;
use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;

const T0: u64 = 1_700_000_000_000;

fn health(version: &str, ok_at: u64) -> Health {
    Health {
        version: version.to_string(),
        ok_at,
    }
}

#[test]
fn heartbeat_timeout_triggers_rollback() {
    let started = T0;
    let wrong = health("0.4.0", started + 1);
    // 59,9 с — ждём, ровно 60 с — откат
    assert_eq!(
        decide(started + 59_900, started, None, "0.5.1"),
        Decision::Wait
    );
    assert_eq!(
        decide(started + 60_000, started, None, "0.5.1"),
        Decision::Rollback
    );
    assert_eq!(grace_ms(), 60_000, "константа та же, что в updater.rs");
    // отметка чужой версии не спасает
    assert_eq!(
        decide(started + 60_000, started, Some(&wrong), "0.5.1"),
        Decision::Rollback
    );
}

#[test]
fn heartbeat_ok_no_rollback_in_decide() {
    let ok = health("0.5.1", T0 + 3_000);
    for elapsed in [0, 10_000, 59_999, 60_000, 600_000] {
        assert_eq!(
            decide(T0 + elapsed, T0, Some(&ok), "0.5.1"),
            Decision::Healthy,
            "через {elapsed} мс"
        );
    }
}

struct FakeClock {
    now: Cell<u64>,
}

impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.now.get()
    }

    fn sleep(&self, duration: Duration) {
        let ms = u64::try_from(duration.as_millis()).unwrap();
        self.now.set(self.now.get() + ms);
    }
}

/// Отметка появляется в заданный момент.
struct FakeHealth {
    clock: Rc<FakeClock>,
    appears_at: Option<u64>,
    version: String,
}

impl HealthSource for FakeHealth {
    fn read(&self) -> Option<Health> {
        let at = self.appears_at?;
        (self.clock.now_ms() >= at).then(|| health(&self.version, at))
    }
}

struct FakeWaiter {
    log: Log,
    result: WaitResult,
}

impl InstallerWaiter for FakeWaiter {
    fn wait_exit(&self, pid: u32, _: Duration) -> WaitResult {
        self.log.push(&format!("wait:{pid}"));
        self.result
    }
}

struct FakeLauncher {
    log: Log,
    launched: RefCell<Vec<PathBuf>>,
    fail: bool,
}

impl Launcher for FakeLauncher {
    fn launch_non_elevated(&self, exe: &Path) -> Result<(), String> {
        self.log.push("launch");
        self.launched.borrow_mut().push(exe.to_path_buf());
        if self.fail {
            Err("explorer не ответил".into())
        } else {
            Ok(())
        }
    }
}

struct FakeRollback {
    log: Log,
    result: RollbackResult,
}

impl RollbackStep for FakeRollback {
    fn run(&self) -> RollbackResult {
        self.log.push("rollback");
        self.result.clone()
    }
}

struct Rig {
    log: Log,
    clock: Rc<FakeClock>,
    health: FakeHealth,
    waiter: FakeWaiter,
    launcher: FakeLauncher,
    rollback: FakeRollback,
    args: WatchdogArgs,
}

impl Rig {
    fn new() -> Self {
        let log = Log::default();
        let clock = Rc::new(FakeClock { now: Cell::new(T0) });
        Self {
            health: FakeHealth {
                clock: Rc::clone(&clock),
                appears_at: None,
                version: "0.5.1".into(),
            },
            waiter: FakeWaiter {
                log: log.clone(),
                result: WaitResult::Exited(Some(0)),
            },
            launcher: FakeLauncher {
                log: log.clone(),
                launched: RefCell::default(),
                fail: false,
            },
            rollback: FakeRollback {
                log: log.clone(),
                result: RollbackResult::Started(555),
            },
            args: WatchdogArgs {
                installer_pid: 321,
                data_dir: PathBuf::from("data"),
                app_exe: PathBuf::from("LAVRay.exe"),
                version: "0.5.1".into(),
            },
            log,
            clock,
        }
    }

    fn run(&self) -> Outcome {
        let deps = WatchdogDeps {
            waiter: &self.waiter,
            launcher: &self.launcher,
            clock: &*self.clock,
            health: &self.health,
            rollback: &self.rollback,
        };
        run(&self.args, &deps)
    }

    fn elapsed(&self) -> u64 {
        self.clock.now.get() - T0
    }
}

#[test]
fn heartbeat_ok_no_rollback() {
    let mut rig = Rig::new();
    rig.health.appears_at = Some(T0 + 12_000);
    assert_eq!(rig.run(), Outcome::Healthy);
    assert_eq!(rig.log.count("rollback"), 0);
    assert!(rig.elapsed() <= 12_000 + 1_000, "вышли сразу после отметки");
}

#[test]
fn a_run_without_heartbeat_rolls_back_after_exactly_the_grace_period() {
    let rig = Rig::new();
    assert_eq!(rig.run(), Outcome::RolledBack);
    assert_eq!(rig.log.count("rollback"), 1);
    assert_eq!(rig.elapsed(), 60_000, "ждали ровно HEARTBEAT_GRACE");
    // после отката прежняя версия запущена снова
    assert_eq!(
        rig.log.events(),
        ["wait:321", "launch", "rollback", "wait:555", "launch"]
    );
}

#[test]
fn a_heartbeat_of_the_old_version_does_not_stop_the_rollback() {
    let mut rig = Rig::new();
    rig.health.appears_at = Some(T0 + 5_000);
    rig.health.version = "0.4.0".into();
    assert_eq!(rig.run(), Outcome::RolledBack);
}

#[test]
fn watchdog_relaunches_non_elevated() {
    let mut rig = Rig::new();
    rig.health.appears_at = Some(T0 + 1_000);
    assert_eq!(rig.run(), Outcome::Healthy);
    // приложение запускается только через Launcher (без повышения), и только
    // после выхода установщика
    assert_eq!(rig.log.events(), ["wait:321", "launch"]);
    assert_eq!(
        rig.launcher.launched.borrow().as_slice(),
        [PathBuf::from("LAVRay.exe")]
    );
}

#[test]
fn rollback_unavailable_without_previous_is_reported_not_retried() {
    let mut rig = Rig::new();
    rig.rollback.result = RollbackResult::Unavailable;
    assert_eq!(rig.run(), Outcome::RollbackUnavailable);
    assert_eq!(rig.log.count("launch"), 1, "новое приложение не трогаем");
}

#[test]
fn a_cancelled_or_failed_rollback_is_reported() {
    let mut rig = Rig::new();
    rig.rollback.result = RollbackResult::UacCancelled;
    assert_eq!(rig.run(), Outcome::RollbackCancelled);
    rig.rollback.result = RollbackResult::Failed("sha256_mismatch".into());
    assert_eq!(rig.run(), Outcome::RollbackFailed("sha256_mismatch".into()));
}

#[test]
fn a_failed_installer_relaunches_the_old_app_without_judging_its_health() {
    let mut rig = Rig::new();
    rig.waiter.result = WaitResult::Exited(Some(2));
    assert_eq!(rig.run(), Outcome::InstallerFailed(2));
    assert_eq!(rig.log.events(), ["wait:321", "launch"]);
    assert_eq!(rig.elapsed(), 0, "heartbeat не опрашивался");
}

#[test]
fn an_installer_that_never_exits_is_reported() {
    let mut rig = Rig::new();
    rig.waiter.result = WaitResult::TimedOut;
    assert_eq!(rig.run(), Outcome::InstallerTimeout);
    assert_eq!(rig.log.count("launch"), 0);
}

#[test]
fn an_unknown_exit_code_is_treated_as_success() {
    let mut rig = Rig::new();
    rig.waiter.result = WaitResult::Exited(None);
    rig.health.appears_at = Some(T0);
    assert_eq!(rig.run(), Outcome::Healthy);
}

#[test]
fn a_launch_failure_is_reported_before_any_polling() {
    let mut rig = Rig::new();
    rig.launcher.fail = true;
    assert_eq!(
        rig.run(),
        Outcome::LaunchFailed("explorer не ответил".into())
    );
    assert_eq!(rig.elapsed(), 0);
}

#[test]
fn outcome_names_are_stable() {
    assert_eq!(Outcome::Healthy.name(), "healthy");
    assert_eq!(Outcome::RolledBack.name(), "rolled_back");
    assert_eq!(Outcome::InstallerFailed(1).name(), "installer_failed");
}
