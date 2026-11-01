// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::update::error::ApplyError;
use crate::update::hash::{sha256_reader, to_hex};
use crate::update::install::{ElevateError, ElevatedHandle};
use crate::update::paths::RealFs;
use crate::update::previous::PreviousInfo;
use crate::update::testkit::{FakeSignature, TempDir};
use crate::update::verify::RealOpener;
use std::cell::RefCell;
use std::path::{Path, PathBuf};

struct FakeElevator {
    answer: Result<ElevatedHandle, ElevateError>,
    launched: RefCell<Vec<(PathBuf, Vec<String>)>>,
}

impl FakeElevator {
    fn answering(answer: Result<ElevatedHandle, ElevateError>) -> Self {
        Self {
            answer,
            launched: RefCell::default(),
        }
    }
}

impl Elevator for FakeElevator {
    fn run_elevated(&self, exe: &Path, args: &[&str]) -> Result<ElevatedHandle, ElevateError> {
        let args = args.iter().map(ToString::to_string).collect();
        self.launched.borrow_mut().push((exe.to_path_buf(), args));
        self.answer.clone()
    }
}

/// Устанавливает «версию» `content`: файл в staging под именем `<sha>-setup.exe`.
fn apply(store: &PreviousStore, tmp: &TempDir, content: &str, version: &str) -> PreviousInfo {
    let sha256 = to_hex(&sha256_reader(&mut content.as_bytes()).unwrap());
    let file = format!("{sha256}-setup.exe");
    let staging = Layout::new(tmp.path()).staging();
    std::fs::create_dir_all(&staging).unwrap();
    std::fs::write(staging.join(&file), content).unwrap();
    let info = PreviousInfo {
        version: version.into(),
        sha256,
        file,
    };
    store.stage(&staging.join(&info.file), &info).unwrap();
    store.commit_update(&info).unwrap();
    info
}

fn run_step(
    layout: &Layout,
    store: &PreviousStore,
    elevator: &FakeElevator,
    signature: &FakeSignature,
) -> RollbackResult {
    let opener = RealOpener::within(&layout.previous_dir());
    PreviousRollback {
        layout,
        store,
        fs: &RealFs,
        opener: &opener,
        elevator,
        signature,
    }
    .run()
}

/// Ядро подтверждает подпись прошлого установщика `info`.
fn signed(info: &PreviousInfo) -> FakeSignature {
    FakeSignature::ok(&info.version, &info.sha256, None)
}

#[test]
fn rollback_unavailable_without_previous() {
    let tmp = TempDir::new("rb-none");
    let layout = Layout::new(tmp.path());
    let store = PreviousStore::new(layout.clone());
    let only = apply(&store, &tmp, "only one release", "0.5.0");
    let sig = signed(&only);
    let elevator = FakeElevator::answering(Ok(ElevatedHandle { pid: 1 }));
    assert_eq!(
        run_step(&layout, &store, &elevator, &sig),
        RollbackResult::Unavailable
    );
    assert!(elevator.launched.borrow().is_empty(), "UAC не запрашивался");
    assert!(sig.calls.borrow().is_empty(), "проверять нечего");
}

#[test]
fn the_previous_installer_is_verified_launched_silently_and_consumed() {
    let tmp = TempDir::new("rb-ok");
    let layout = Layout::new(tmp.path());
    let store = PreviousStore::new(layout.clone());
    let a = apply(&store, &tmp, "release A", "0.5.0");
    apply(&store, &tmp, "release B", "0.5.1");
    let sig = signed(&a);
    let elevator = FakeElevator::answering(Ok(ElevatedHandle { pid: 909 }));

    assert_eq!(
        run_step(&layout, &store, &elevator, &sig),
        RollbackResult::Started(909)
    );
    let launched = elevator.launched.borrow();
    assert_eq!(
        launched.as_slice(),
        [(layout.previous_dir().join(&a.file), vec!["/S".to_string()])]
    );
    assert_eq!(store.available(), None, "второй откат подряд невозможен");
    // подпись проверена рядом лежащим .minisig и с разрешением старой версии
    let calls = sig.calls.borrow();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, layout.previous_dir().join(&a.file));
    assert_eq!(
        calls[0].1,
        layout.previous_dir().join(format!("{}.minisig", a.file))
    );
    assert!(calls[0].2, "откат принимает прошлую подписанную версию");
}

#[test]
fn a_tampered_previous_installer_is_never_launched() {
    let tmp = TempDir::new("rb-tampered");
    let layout = Layout::new(tmp.path());
    let store = PreviousStore::new(layout.clone());
    let a = apply(&store, &tmp, "release A", "0.5.0");
    apply(&store, &tmp, "release B", "0.5.1");
    std::fs::write(layout.previous_dir().join(&a.file), "release X").unwrap();
    let sig = signed(&a);
    let elevator = FakeElevator::answering(Ok(ElevatedHandle { pid: 1 }));

    assert_eq!(
        run_step(&layout, &store, &elevator, &sig),
        RollbackResult::Failed("sha256_mismatch".into())
    );
    assert!(elevator.launched.borrow().is_empty());
    assert!(store.available().is_some(), "ничего не потреблено");
}

#[test]
fn a_cancelled_uac_keeps_the_previous_installer() {
    let tmp = TempDir::new("rb-cancel");
    let layout = Layout::new(tmp.path());
    let store = PreviousStore::new(layout.clone());
    let a = apply(&store, &tmp, "release A", "0.5.0");
    apply(&store, &tmp, "release B", "0.5.1");
    let sig = signed(&a);
    let elevator = FakeElevator::answering(Err(ElevateError::UacCancelled));
    assert_eq!(
        run_step(&layout, &store, &elevator, &sig),
        RollbackResult::UacCancelled
    );
    assert!(store.available().is_some());

    let failing = FakeElevator::answering(Err(ElevateError::Failed("нет".into())));
    assert_eq!(
        run_step(&layout, &store, &failing, &sig),
        RollbackResult::Failed("launch_failed".into())
    );
    assert!(store.available().is_some());
}

// ---- previous.json лежит в каталоге пользователя: верим только подписи ----

#[test]
fn rollback_without_a_valid_signature_never_asks_for_uac() {
    let tmp = TempDir::new("rb-unsigned");
    let layout = Layout::new(tmp.path());
    let store = PreviousStore::new(layout.clone());
    let a = apply(&store, &tmp, "release A", "0.5.0");
    apply(&store, &tmp, "release B", "0.5.1");
    for error in [ApplyError::SignatureInvalid, ApplyError::CoreUnavailable] {
        let sig = FakeSignature::answering(Err(error), None);
        let elevator = FakeElevator::answering(Ok(ElevatedHandle { pid: 1 }));
        assert_eq!(
            run_step(&layout, &store, &elevator, &sig),
            RollbackResult::Failed(error.code().to_string())
        );
        assert!(elevator.launched.borrow().is_empty());
    }
    assert!(store.available().is_some(), "ничего не потреблено");
    assert_eq!(a.version, "0.5.0");
}

#[test]
fn a_signed_installer_of_another_version_than_previous_json_is_refused() {
    let tmp = TempDir::new("rb-version");
    let layout = Layout::new(tmp.path());
    let store = PreviousStore::new(layout.clone());
    let a = apply(&store, &tmp, "release A", "0.5.0");
    apply(&store, &tmp, "release B", "0.5.1");
    // в previous.json — 0.5.0, а подписан файл версии 0.3.0 (подложен старый релиз)
    let sig = FakeSignature::ok("0.3.0", &a.sha256, None);
    let elevator = FakeElevator::answering(Ok(ElevatedHandle { pid: 1 }));
    assert_eq!(
        run_step(&layout, &store, &elevator, &sig),
        RollbackResult::Failed("version_mismatch".into())
    );
    assert!(elevator.launched.borrow().is_empty());
}

#[test]
fn a_sharing_violation_during_rollback_is_reported_with_its_own_code() {
    let tmp = TempDir::new("rb-share");
    let layout = Layout::new(tmp.path());
    let store = PreviousStore::new(layout.clone());
    let a = apply(&store, &tmp, "release A", "0.5.0");
    apply(&store, &tmp, "release B", "0.5.1");
    let sig = signed(&a);
    let elevator = FakeElevator::answering(Err(ElevateError::SharingViolation));
    assert_eq!(
        run_step(&layout, &store, &elevator, &sig),
        RollbackResult::Failed("installer_locked".into())
    );
    assert_eq!(elevator.launched.borrow().len(), 1);
    assert!(store.available().is_some(), "ничего не потреблено");
}
