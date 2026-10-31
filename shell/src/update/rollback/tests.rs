// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::update::hash::{sha256_reader, to_hex};
use crate::update::install::{ElevateError, ElevatedHandle};
use crate::update::paths::RealFs;
use crate::update::previous::PreviousInfo;
use crate::update::testkit::TempDir;
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

fn step<'a>(
    layout: &'a Layout,
    store: &'a PreviousStore,
    elevator: &'a FakeElevator,
) -> PreviousRollback<'a> {
    PreviousRollback {
        layout,
        store,
        fs: &RealFs,
        opener: &RealOpener,
        elevator,
    }
}

#[test]
fn rollback_unavailable_without_previous() {
    let tmp = TempDir::new("rb-none");
    let layout = Layout::new(tmp.path());
    let store = PreviousStore::new(layout.clone());
    apply(&store, &tmp, "only one release", "0.5.0");
    let elevator = FakeElevator::answering(Ok(ElevatedHandle { pid: 1 }));
    assert_eq!(
        step(&layout, &store, &elevator).run(),
        RollbackResult::Unavailable
    );
    assert!(elevator.launched.borrow().is_empty(), "UAC не запрашивался");
}

#[test]
fn the_previous_installer_is_verified_launched_silently_and_consumed() {
    let tmp = TempDir::new("rb-ok");
    let layout = Layout::new(tmp.path());
    let store = PreviousStore::new(layout.clone());
    let a = apply(&store, &tmp, "release A", "0.5.0");
    apply(&store, &tmp, "release B", "0.5.1");
    let elevator = FakeElevator::answering(Ok(ElevatedHandle { pid: 909 }));

    assert_eq!(
        step(&layout, &store, &elevator).run(),
        RollbackResult::Started(909)
    );
    let launched = elevator.launched.borrow();
    assert_eq!(
        launched.as_slice(),
        [(layout.previous_dir().join(&a.file), vec!["/S".to_string()])]
    );
    assert_eq!(store.available(), None, "второй откат подряд невозможен");
}

#[test]
fn a_tampered_previous_installer_is_never_launched() {
    let tmp = TempDir::new("rb-tampered");
    let layout = Layout::new(tmp.path());
    let store = PreviousStore::new(layout.clone());
    let a = apply(&store, &tmp, "release A", "0.5.0");
    apply(&store, &tmp, "release B", "0.5.1");
    std::fs::write(layout.previous_dir().join(&a.file), "release X").unwrap();
    let elevator = FakeElevator::answering(Ok(ElevatedHandle { pid: 1 }));

    assert_eq!(
        step(&layout, &store, &elevator).run(),
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
    apply(&store, &tmp, "release A", "0.5.0");
    apply(&store, &tmp, "release B", "0.5.1");
    let elevator = FakeElevator::answering(Err(ElevateError::UacCancelled));
    assert_eq!(
        step(&layout, &store, &elevator).run(),
        RollbackResult::UacCancelled
    );
    assert!(store.available().is_some());

    let failing = FakeElevator::answering(Err(ElevateError::Failed("нет".into())));
    assert_eq!(
        step(&layout, &store, &failing).run(),
        RollbackResult::Failed("launch_failed".into())
    );
    assert!(store.available().is_some());
}
