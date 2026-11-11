// SPDX-License-Identifier: GPL-3.0-only

//! Тесты файловых операций записи автозапуска: замена симлинка без перехода
//! на цель, валидация пути, отсутствие временных файлов.

use super::desktop::{enable, entry_exec, entry_state, Entry};
use super::desktop_tests::TempDir;
use std::os::unix::ffi::OsStringExt;
use std::path::Path;

const EXE: &str = "/usr/bin/lavray-shell";

#[test]
fn enable_replaces_symlink_without_touching_target() {
    // Симлинк на месте записи заменяется целиком (temp+rename), цель не
    // перезаписывается содержимым записи.
    let dir = TempDir::new();
    let target = dir.0.join("target.txt");
    std::fs::write(&target, "важный файл").expect("цель");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, dir.0.join("lavray.desktop")).expect("симлинк");

    enable(&dir.0, Path::new(EXE)).expect("включить");
    assert_eq!(
        std::fs::read_to_string(&target).unwrap(),
        "важный файл",
        "цель симлинка не тронута"
    );
    let meta = std::fs::symlink_metadata(dir.0.join("lavray.desktop")).expect("запись есть");
    assert!(
        !meta.file_type().is_symlink(),
        "на месте записи — обычный файл, а не симлинк"
    );
}

#[test]
fn enable_rejects_control_characters_and_non_utf8() {
    let dir = TempDir::new();
    let err = enable(&dir.0, Path::new("/tmp/bad\npath")).unwrap_err();
    assert!(err.contains("управляющие символы"), "{err}");
    let broken = std::ffi::OsString::from_vec(vec![0x2f, 0xff]);
    let err = enable(&dir.0, Path::new(&broken)).unwrap_err();
    assert!(err.contains("не UTF-8"), "{err}");
    assert!(
        !dir.0.join("lavray.desktop").exists(),
        "недопустимый путь не создаёт запись"
    );
}

#[test]
fn enable_leaves_no_temporary_files() {
    let dir = TempDir::new();
    enable(&dir.0, Path::new(EXE)).expect("включить");
    let leftovers: Vec<_> = std::fs::read_dir(&dir.0)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(".lavray-"))
        .collect();
    assert!(leftovers.is_empty(), "temp-файлы удалены: {leftovers:?}");
}
