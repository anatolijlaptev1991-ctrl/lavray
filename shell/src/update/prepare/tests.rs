// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::update::hash::{sha256_reader, to_hex};
use crate::update::install::{ElevateError, ElevatedHandle, Elevator};
use crate::update::ports::SignedFacts;
use crate::update::testkit::{staged_name, FakeSignature, Log, MemFs, MemOpener};
use std::cell::RefCell;
use std::io;
use std::path::{Path, PathBuf};
use std::rc::Rc;

const BYTES: &[u8] = b"new installer";

struct FakeCore {
    log: Log,
    stop: Result<(), String>,
}

impl CoreController for FakeCore {
    fn stop(&self) -> Result<(), String> {
        self.log.push("core.stop");
        self.stop.clone()
    }

    fn restart(&self) {
        self.log.push("core.restart");
    }
}

struct FakeProxy {
    log: Log,
    fail: bool,
}

impl ProxyReleaser for FakeProxy {
    fn release(&self) -> Result<(), String> {
        self.log.push("proxy.release");
        if self.fail {
            Err("реестр недоступен".into())
        } else {
            Ok(())
        }
    }
}

struct FakeElevator {
    log: Log,
    answer: Result<ElevatedHandle, ElevateError>,
    launched: RefCell<Vec<(PathBuf, Vec<String>)>>,
    gate: Rc<ApplyGate>,
    busy_inside: RefCell<Option<ApplyError>>,
}

impl Elevator for FakeElevator {
    fn run_elevated(&self, exe: &Path, args: &[&str]) -> Result<ElevatedHandle, ElevateError> {
        self.log.push("elevator.run");
        let args = args.iter().map(ToString::to_string).collect();
        self.launched.borrow_mut().push((exe.to_path_buf(), args));
        // пока идёт установка, вторая попытка должна упереться в замок
        *self.busy_inside.borrow_mut() = self.gate.try_enter().err();
        self.answer.clone()
    }
}

struct FakeArchive {
    log: Log,
    stage_fails: bool,
}

impl RollbackArchive for FakeArchive {
    fn stage(&self, _: &Path, _: &PreviousInfo) -> io::Result<()> {
        self.log.push("archive.stage");
        if self.stage_fails {
            return Err(io::Error::other("диск полон"));
        }
        Ok(())
    }

    fn commit_update(&self, _: &PreviousInfo) -> io::Result<()> {
        self.log.push("archive.commit_update");
        Ok(())
    }

    fn commit_rollback(&self) -> io::Result<()> {
        self.log.push("archive.commit_rollback");
        Ok(())
    }

    fn discard(&self) {
        self.log.push("archive.discard");
    }
}

struct FakeWatchdog {
    log: Log,
    copy_fails: bool,
    spawn_fails: bool,
    spawned: RefCell<Vec<(u32, String)>>,
}

impl WatchdogLauncher for FakeWatchdog {
    fn stage_copy(&self) -> io::Result<WatchdogCopy> {
        self.log.push("watchdog.copy");
        if self.copy_fails {
            return Err(io::Error::other("нет места"));
        }
        Ok(WatchdogCopy {
            path: PathBuf::from("watchdog.exe"),
            hold: Box::new(io::empty()),
        })
    }

    fn spawn(&self, _: &WatchdogCopy, installer_pid: u32, version: &str) -> io::Result<()> {
        self.log.push("watchdog.spawn");
        self.spawned
            .borrow_mut()
            .push((installer_pid, version.to_string()));
        if self.spawn_fails {
            return Err(io::Error::other("не запустился"));
        }
        Ok(())
    }
}

/// Все подставки одного прогона; поля настраиваются до `run`.
struct Rig {
    log: Log,
    layout: Layout,
    fs: MemFs,
    opener: MemOpener,
    core: FakeCore,
    proxy: FakeProxy,
    elevator: FakeElevator,
    signature: FakeSignature,
    archive: FakeArchive,
    watchdog: FakeWatchdog,
    gate: Rc<ApplyGate>,
    installer: PathBuf,
    sum: String,
}

impl Rig {
    fn new(mode: Mode) -> Self {
        let log = Log::default();
        let layout = Layout::new(&std::env::temp_dir().join("lavray-fake-prepare"));
        let dir = match mode {
            Mode::Update => layout.staging(),
            Mode::Rollback => layout.previous_dir(),
        };
        let name = staged_name('d', "setup.exe");
        let installer = dir.join(&name);
        let opener = MemOpener {
            log: Some(log.clone()),
            ..MemOpener::default()
        };
        opener.put(&installer, BYTES);
        let gate = Rc::new(ApplyGate::default());
        let sum = to_hex(&sha256_reader(&mut &BYTES[..]).unwrap());
        Self {
            fs: MemFs::with_file(&dir, &name),
            core: FakeCore {
                log: log.clone(),
                stop: Ok(()),
            },
            proxy: FakeProxy {
                log: log.clone(),
                fail: false,
            },
            elevator: FakeElevator {
                log: log.clone(),
                answer: Ok(ElevatedHandle { pid: 777 }),
                launched: RefCell::default(),
                gate: Rc::clone(&gate),
                busy_inside: RefCell::default(),
            },
            signature: FakeSignature::ok("0.5.1", &sum, Some(log.clone())),
            archive: FakeArchive {
                log: log.clone(),
                stage_fails: false,
            },
            watchdog: FakeWatchdog {
                log: log.clone(),
                copy_fails: false,
                spawn_fails: false,
                spawned: RefCell::default(),
            },
            sum,
            log,
            layout,
            opener,
            gate,
            installer,
        }
    }

    fn run(&self, mode: Mode) -> Result<ApplyOutcome, ApplyError> {
        let deps = ApplyDeps {
            fs: &self.fs,
            opener: &self.opener,
            core: &self.core,
            proxy: &self.proxy,
            elevator: &self.elevator,
            signature: &self.signature,
            archive: &self.archive,
            watchdog: &self.watchdog,
        };
        let request = ApplyRequest {
            layout: &self.layout,
            mode,
            candidate: &self.installer,
            sha256: &self.sum,
            version: "0.5.1",
        };
        apply_guarded(&self.gate, &deps, &request)
    }
}

#[test]
fn apply_order_stop_core_release_proxy_then_launch() {
    let rig = Rig::new(Mode::Update);
    assert_eq!(rig.run(Mode::Update), Ok(ApplyOutcome::Installing));
    assert_eq!(
        rig.log.events(),
        [
            "verify_open",
            "signature.verify",
            "watchdog.copy",
            "archive.stage",
            "core.stop",
            "proxy.release",
            "elevator.run",
            "handle.drop",
            "watchdog.spawn",
            "archive.commit_update",
        ]
    );
    // установщик запущен тихо, ровно с проверенного пути
    let launched = rig.elevator.launched.borrow();
    assert_eq!(
        launched.as_slice(),
        [(rig.installer.clone(), vec!["/S".to_string()])]
    );
    // watchdog получил pid установщика и ожидаемую версию
    assert_eq!(
        rig.watchdog.spawned.borrow().as_slice(),
        [(777, "0.5.1".to_string())]
    );
}

#[test]
fn apply_requires_reverify() {
    let rig = Rig::new(Mode::Update);
    // после проверки ядром в staging подменили байт
    rig.opener.put(&rig.installer, b"new installeR");
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::Sha256Mismatch));
    assert_eq!(
        rig.log.events(),
        ["verify_open", "handle.drop"],
        "ничего не остановлено и не запущено"
    );
    assert!(rig.elevator.launched.borrow().is_empty());
}

#[test]
fn apply_rejects_path_outside_staging() {
    let mut rig = Rig::new(Mode::Update);
    rig.installer = std::env::temp_dir().join(staged_name('d', "setup.exe"));
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::PathOutsideStaging));
    assert!(rig.log.events().is_empty(), "файл даже не открывали");
}

#[test]
fn an_invalid_sum_is_reported_before_anything_happens() {
    let mut rig = Rig::new(Mode::Update);
    rig.sum = "not-a-sum".into();
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::InvalidSha256));
    assert!(rig.log.events().is_empty());
}

#[test]
fn an_unusable_version_is_refused_before_anything_happens() {
    for bad in ["", "0.5 1", "x".repeat(65).as_str()] {
        let rig = Rig::new(Mode::Update);
        let deps = ApplyDeps {
            fs: &rig.fs,
            opener: &rig.opener,
            core: &rig.core,
            proxy: &rig.proxy,
            elevator: &rig.elevator,
            signature: &rig.signature,
            archive: &rig.archive,
            watchdog: &rig.watchdog,
        };
        let request = ApplyRequest {
            layout: &rig.layout,
            mode: Mode::Update,
            candidate: &rig.installer,
            sha256: &rig.sum,
            version: bad,
        };
        assert_eq!(
            apply_guarded(&rig.gate, &deps, &request),
            Err(ApplyError::InvalidVersion),
            "{bad:?}"
        );
        assert!(rig.log.events().is_empty());
    }
}

#[test]
fn apply_twice_busy() {
    let rig = Rig::new(Mode::Update);
    assert_eq!(rig.run(Mode::Update), Ok(ApplyOutcome::Installing));
    assert_eq!(
        *rig.elevator.busy_inside.borrow(),
        Some(ApplyError::Busy),
        "вторая установка во время первой отвергается"
    );
    assert_eq!(
        rig.gate.try_enter().err(),
        Some(ApplyError::Busy),
        "замок остаётся занятым после запуска: приложение вот-вот закроется"
    );
}

#[test]
fn the_gate_is_released_on_every_failure_path() {
    let mut rig = Rig::new(Mode::Update);
    rig.core.stop = Err("завис".into());
    assert!(rig.run(Mode::Update).is_err());
    assert!(rig.gate.try_enter().is_ok());

    let mut rig = Rig::new(Mode::Update);
    rig.sum = "x".into();
    assert!(rig.run(Mode::Update).is_err());
    assert!(rig.gate.try_enter().is_ok());
}

#[test]
fn uac_cancel_returns_ready() {
    let mut rig = Rig::new(Mode::Update);
    rig.elevator.answer = Err(ElevateError::UacCancelled);
    // не ошибка: UI вернётся к состоянию «готово» и покажет сообщение
    assert_eq!(rig.run(Mode::Update), Ok(ApplyOutcome::UacCancelled));
    assert_eq!(rig.log.count("core.restart"), 1, "ядро поднято снова");
    assert!(rig.log.pos("elevator.run") < rig.log.pos("core.restart"));
    assert_eq!(rig.log.count("archive.discard"), 1);
    assert_eq!(rig.log.count("watchdog.spawn"), 0);
    assert_eq!(rig.log.count("archive.commit_update"), 0);
    assert!(
        rig.gate.try_enter().is_ok(),
        "можно нажать «Установить» снова"
    );
}

#[test]
fn a_launch_failure_restarts_the_core_and_reports_launch_failed() {
    let mut rig = Rig::new(Mode::Update);
    rig.elevator.answer = Err(ElevateError::Failed("файл занят".into()));
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::LaunchFailed));
    assert_eq!(rig.log.count("core.restart"), 1);
    assert_eq!(rig.log.count("archive.discard"), 1);
    assert_eq!(rig.log.count("watchdog.spawn"), 0);
}

#[test]
fn a_core_that_does_not_stop_aborts_before_the_proxy_is_touched() {
    let mut rig = Rig::new(Mode::Update);
    rig.core.stop = Err("таймаут".into());
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::CoreStopFailed));
    assert_eq!(rig.log.count("proxy.release"), 0);
    assert_eq!(rig.log.count("elevator.run"), 0);
    assert_eq!(rig.log.count("archive.discard"), 1);
}

#[test]
fn a_proxy_that_cannot_be_released_restarts_the_core_and_stops() {
    let mut rig = Rig::new(Mode::Update);
    rig.proxy.fail = true;
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::ProxyReleaseFailed));
    assert_eq!(rig.log.count("core.restart"), 1);
    assert_eq!(rig.log.count("elevator.run"), 0);
}

#[test]
fn a_failed_watchdog_copy_aborts_before_the_core_is_stopped() {
    let mut rig = Rig::new(Mode::Update);
    rig.watchdog.copy_fails = true;
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::PrepareFailed));
    assert_eq!(rig.log.count("core.stop"), 0);
}

#[test]
fn a_failed_rollback_copy_aborts_before_the_core_is_stopped() {
    let mut rig = Rig::new(Mode::Update);
    rig.archive.stage_fails = true;
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::PrepareFailed));
    assert_eq!(rig.log.count("core.stop"), 0);
    assert_eq!(rig.log.count("archive.discard"), 1);
}

#[test]
fn a_watchdog_that_cannot_start_does_not_undo_a_running_installer() {
    let mut rig = Rig::new(Mode::Update);
    rig.watchdog.spawn_fails = true;
    assert_eq!(rig.run(Mode::Update), Ok(ApplyOutcome::Installing));
    assert_eq!(rig.log.count("archive.commit_update"), 1);
    assert_eq!(rig.log.count("core.restart"), 0);
}

#[test]
fn rollback_runs_the_previous_installer_and_commits_the_rollback() {
    let rig = Rig::new(Mode::Rollback);
    assert_eq!(rig.run(Mode::Rollback), Ok(ApplyOutcome::Installing));
    assert_eq!(
        rig.log.events(),
        [
            "verify_open",
            "signature.verify",
            "watchdog.copy",
            "core.stop",
            "proxy.release",
            "elevator.run",
            "handle.drop",
            "watchdog.spawn",
            "archive.commit_rollback",
        ]
    );
    assert!(rig.installer.starts_with(rig.layout.previous_dir()));
}

#[test]
fn rollback_refuses_an_installer_from_staging() {
    let mut rig = Rig::new(Mode::Rollback);
    rig.installer = rig.layout.staging().join(staged_name('d', "setup.exe"));
    assert_eq!(rig.run(Mode::Rollback), Err(ApplyError::PathOutsideStaging));
}

// ---- подпись: оболочка не доверяет ни сумме, ни версии от страницы ----

#[test]
fn apply_rejects_an_unsigned_file() {
    let mut rig = Rig::new(Mode::Update);
    rig.signature =
        FakeSignature::answering(Err(ApplyError::SignatureInvalid), Some(rig.log.clone()));
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::SignatureInvalid));
    assert!(
        rig.elevator.launched.borrow().is_empty(),
        "UAC не запрашивался"
    );
    assert_eq!(rig.log.count("core.stop"), 0, "ядро не остановлено");
    assert_eq!(rig.log.count("watchdog.copy"), 0);
}

#[test]
fn apply_rejects_a_wrong_key_signature_and_a_missing_core() {
    for error in [ApplyError::SignatureInvalid, ApplyError::CoreUnavailable] {
        let mut rig = Rig::new(Mode::Update);
        rig.signature = FakeSignature::answering(Err(error), Some(rig.log.clone()));
        assert_eq!(rig.run(Mode::Update), Err(error));
        assert!(rig.elevator.launched.borrow().is_empty());
    }
}

#[test]
fn apply_rejects_a_version_mismatch() {
    let mut rig = Rig::new(Mode::Update);
    // страница просит поставить 0.5.1, а подписан установщик версии 0.4.0
    rig.signature = FakeSignature::ok("0.4.0", &rig.sum, Some(rig.log.clone()));
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::VersionMismatch));
    assert!(rig.elevator.launched.borrow().is_empty());
    assert_eq!(rig.log.count("core.stop"), 0);
}

#[test]
fn apply_rejects_a_sum_the_core_did_not_confirm() {
    let mut rig = Rig::new(Mode::Update);
    // страница угадала сумму файла, но ядро подписало другие байты
    rig.signature = FakeSignature::ok("0.5.1", &"a".repeat(64), Some(rig.log.clone()));
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::Sha256Mismatch));
    assert!(rig.elevator.launched.borrow().is_empty());
    rig.signature = FakeSignature::answering(
        Ok(SignedFacts {
            version: "0.5.1".into(),
            sha256: "не hex".into(),
        }),
        None,
    );
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::SignatureInvalid));
}

#[test]
fn the_signature_is_checked_on_the_locked_file_next_to_its_minisig() {
    let rig = Rig::new(Mode::Update);
    assert_eq!(rig.run(Mode::Update), Ok(ApplyOutcome::Installing));
    let calls = rig.signature.calls.borrow();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, rig.installer);
    assert_eq!(
        calls[0].1.file_name().unwrap().to_string_lossy(),
        format!(
            "{}.minisig",
            rig.installer.file_name().unwrap().to_string_lossy()
        )
    );
    assert!(!calls[0].2, "обновление не принимает старую версию");
    // дескриптор отпущен только после запуска: подпись проверена под замком
    assert!(rig.log.pos("signature.verify") < rig.log.pos("handle.drop"));
}

#[test]
fn rollback_allows_an_older_signed_version_but_still_needs_the_signature() {
    let rig = Rig::new(Mode::Rollback);
    assert_eq!(rig.run(Mode::Rollback), Ok(ApplyOutcome::Installing));
    assert!(
        rig.signature.calls.borrow()[0].2,
        "--allow-older только для отката"
    );

    let mut bad = Rig::new(Mode::Rollback);
    bad.signature = FakeSignature::answering(Err(ApplyError::SignatureInvalid), None);
    assert_eq!(bad.run(Mode::Rollback), Err(ApplyError::SignatureInvalid));
    assert!(bad.elevator.launched.borrow().is_empty());
}

// ---- замок удерживается до выхода процесса ----

#[test]
fn the_gate_stays_held_after_the_installer_started() {
    let rig = Rig::new(Mode::Update);
    assert_eq!(rig.run(Mode::Update), Ok(ApplyOutcome::Installing));
    assert_eq!(
        rig.gate.try_enter().err(),
        Some(ApplyError::Busy),
        "до выхода приложения вторая установка получает busy"
    );
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::Busy));
    assert_eq!(
        rig.elevator.launched.borrow().len(),
        1,
        "установщик запущен один раз"
    );
}

#[test]
fn the_gate_is_released_when_nothing_was_started() {
    let mut cancelled = Rig::new(Mode::Update);
    cancelled.elevator.answer = Err(ElevateError::UacCancelled);
    assert_eq!(cancelled.run(Mode::Update), Ok(ApplyOutcome::UacCancelled));
    assert!(
        cancelled.gate.try_enter().is_ok(),
        "после отказа в UAC можно повторить"
    );

    let mut rejected = Rig::new(Mode::Update);
    rejected.signature = FakeSignature::answering(Err(ApplyError::SignatureInvalid), None);
    assert!(rejected.run(Mode::Update).is_err());
    assert!(rejected.gate.try_enter().is_ok());
}

// ---- установщик, удерживаемый с запретом записи, мог не принять ShellExecute/CreateProcess ----

#[test]
fn a_sharing_violation_is_a_clear_code_and_the_core_is_restarted_without_retries() {
    let mut rig = Rig::new(Mode::Update);
    rig.elevator.answer = Err(ElevateError::SharingViolation);
    assert_eq!(rig.run(Mode::Update), Err(ApplyError::InstallerLocked));
    assert_eq!(ApplyError::InstallerLocked.code(), "installer_locked");
    assert_eq!(
        rig.elevator.launched.borrow().len(),
        1,
        "повторных запусков нет"
    );
    assert_eq!(rig.log.count("core.restart"), 1, "ядро возвращено");
    assert!(
        rig.gate.try_enter().is_ok(),
        "замок снят: пользователь может повторить сам"
    );
    assert_eq!(rig.log.count("watchdog.spawn"), 0);
}
