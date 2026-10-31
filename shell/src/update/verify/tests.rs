// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::update::hash::{sha256_reader, to_hex};
use crate::update::testkit::{staged_name, MemFs};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::io::Cursor;

/// Файлы в памяти; считает открытия, чтобы доказать «один дескриптор».
#[derive(Default)]
struct MemOpener {
    files: RefCell<HashMap<PathBuf, Vec<u8>>>,
    opens: Cell<u32>,
    unreadable: bool,
}

impl MemOpener {
    fn with(path: &Path, bytes: &[u8]) -> Self {
        let opener = Self::default();
        opener
            .files
            .borrow_mut()
            .insert(path.to_path_buf(), bytes.to_vec());
        opener
    }
}

struct Broken;

impl Read for Broken {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("диск отвалился"))
    }
}

impl LockedOpener for MemOpener {
    fn open_locked(&self, path: &Path) -> io::Result<Box<dyn LockedFile>> {
        self.opens.set(self.opens.get() + 1);
        if self.unreadable {
            return Ok(Box::new(Broken));
        }
        let bytes = self.files.borrow().get(path).cloned();
        let bytes = bytes.ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
        Ok(Box::new(Cursor::new(bytes)))
    }
}

fn sum_of(bytes: &[u8]) -> String {
    to_hex(&sha256_reader(&mut &bytes[..]).unwrap())
}

fn installer() -> PathBuf {
    std::env::temp_dir()
        .join("lavray-fake-verify")
        .join("setup.exe")
}

#[test]
fn a_matching_file_yields_a_guard_after_a_single_open() {
    let opener = MemOpener::with(&installer(), b"installer bytes");
    let sum = sum_of(b"installer bytes");
    let guard = verify_locked(&opener, &installer(), &sum).unwrap();
    assert_eq!(guard.path(), installer());
    assert_eq!(guard.sha256(), sum);
    assert_eq!(
        opener.opens.get(),
        1,
        "хэш считается по тому же дескриптору"
    );
}

#[test]
fn a_swapped_byte_fails_the_check() {
    let sum = sum_of(b"installer bytes");
    let opener = MemOpener::with(&installer(), b"installer bytez");
    assert_eq!(
        verify_locked(&opener, &installer(), &sum).err(),
        Some(ApplyError::Sha256Mismatch)
    );
}

#[test]
fn an_uppercase_expected_sum_is_accepted() {
    let opener = MemOpener::with(&installer(), b"x");
    let sum = sum_of(b"x").to_uppercase();
    assert!(verify_locked(&opener, &installer(), &sum).is_ok());
}

#[test]
fn a_malformed_expected_sum_is_refused_before_anything_is_opened() {
    let opener = MemOpener::with(&installer(), b"x");
    for bad in ["", "abc", &"z".repeat(64), &"a".repeat(65)] {
        assert_eq!(
            verify_locked(&opener, &installer(), bad).err(),
            Some(ApplyError::InvalidSha256),
            "{bad:?}"
        );
    }
    assert_eq!(opener.opens.get(), 0);
}

#[test]
fn an_unopenable_or_unreadable_file_is_locked() {
    let sum = sum_of(b"x");
    let missing = MemOpener::default();
    assert_eq!(
        verify_locked(&missing, &installer(), &sum).err(),
        Some(ApplyError::Locked)
    );
    let broken = MemOpener {
        unreadable: true,
        ..MemOpener::default()
    };
    assert_eq!(
        verify_locked(&broken, &installer(), &sum).err(),
        Some(ApplyError::Locked)
    );
}

#[test]
fn open_verified_checks_the_path_before_touching_the_file() {
    let dir = std::env::temp_dir().join("lavray-fake-verify-dir");
    let name = staged_name('c', "setup.exe");
    let fs = MemFs::with_file(&dir, &name);
    let opener = MemOpener::with(&dir.join(&name), b"payload");
    let sum = sum_of(b"payload");

    let outside = std::env::temp_dir().join(&name);
    assert_eq!(
        open_verified(&fs, &opener, &dir, &outside, &sum).err(),
        Some(ApplyError::PathOutsideStaging)
    );
    assert_eq!(opener.opens.get(), 0);

    let inside = dir.join(&name);
    let guard = open_verified(&fs, &opener, &dir, &inside, &sum).unwrap();
    assert_eq!(guard.path(), inside);
}

#[cfg(windows)]
mod real_windows {
    use super::*;
    use crate::update::testkit::TempDir;

    #[test]
    fn deny_write_lock_blocks_replace() {
        let tmp = TempDir::new("verify-lock");
        let path = tmp.path().join("setup.exe");
        std::fs::write(&path, b"installer bytes").unwrap();
        let sum = sum_of(b"installer bytes");

        let guard = verify_locked(&RealOpener, &path, &sum).unwrap();

        let write = std::fs::OpenOptions::new().write(true).open(&path);
        assert!(write.is_err(), "запись при удержанной блокировке");
        assert!(std::fs::remove_file(&path).is_err(), "удаление");
        let moved = tmp.path().join("moved.exe");
        assert!(std::fs::rename(&path, &moved).is_err(), "переименование");
        assert!(std::fs::read(&path).is_ok(), "чтение остаётся доступным");

        drop(guard);
        std::fs::write(&path, b"replaced").expect("после снятия блокировки запись возможна");
    }
}
