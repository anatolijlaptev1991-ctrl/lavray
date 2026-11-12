// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::update::hash::to_hex;
use crate::update::paths::{parse_staged_name, validate_in, RealFs};
use crate::update::testkit::TempDir;
use sha2::{Digest, Sha256};

fn sum(bytes: &[u8]) -> String {
    to_hex(&Sha256::digest(bytes))
}

fn source(tmp: &TempDir, name: &str, bytes: &[u8]) -> PathBuf {
    let path = tmp.path().join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

fn part_files(layout: &Layout) -> Vec<String> {
    std::fs::read_dir(layout.staging())
        .map(|rd| {
            rd.map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .filter(|n| {
                    std::path::Path::new(n)
                        .extension()
                        .is_some_and(|e| e.eq_ignore_ascii_case("part"))
                })
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn a_picked_installer_is_copied_into_staging_under_its_hash() {
    let tmp = TempDir::new("stage-ok");
    let layout = Layout::new(&tmp.path().join("data"));
    let src = source(&tmp, "LAVRay_0.5.1_x64-setup.exe", b"installer bytes");

    let staged = stage_local(&layout, &src, MAX_INSTALLER_BYTES).unwrap();
    assert_eq!(staged.sha256, sum(b"installer bytes"));
    let expected = layout
        .staging()
        .join(format!("{}-LAVRay_0.5.1_x64-setup.exe", staged.sha256));
    assert_eq!(PathBuf::from(&staged.staged_path), expected);
    assert_eq!(std::fs::read(&expected).unwrap(), b"installer bytes");
    assert!(part_files(&layout).is_empty());
    // тем же путём потом пройдёт `update_apply`
    assert!(validate_in(&RealFs, &layout.staging(), &expected).is_ok());
}

#[test]
fn the_staged_json_uses_the_agreed_field_names() {
    let staged = StagedFile {
        staged_path: "C:\\x".into(),
        sha256: "ab".into(),
    };
    assert_eq!(
        serde_json::to_string(&staged).unwrap(),
        r#"{"staged_path":"C:\\x","sha256":"ab"}"#
    );
}

#[test]
fn a_hostile_or_unicode_name_is_made_safe() {
    let tmp = TempDir::new("stage-name");
    let layout = Layout::new(tmp.path());
    let src = source(&tmp, "мой setup (1).exe", b"x");
    let staged = stage_local(&layout, &src, MAX_INSTALLER_BYTES).unwrap();
    let name = PathBuf::from(&staged.staged_path)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let (hash, file) = parse_staged_name(&name).expect("имя годится для update_apply");
    assert_eq!(hash, staged.sha256);
    assert!(file.ends_with("setup__1_.exe"), "{file}");
    assert!(file.is_ascii());
}

#[test]
fn names_are_sanitized_and_capped() {
    assert_eq!(sanitize_name("setup.exe").as_deref(), Some("setup.exe"));
    assert_eq!(sanitize_name("a b&c.exe").as_deref(), Some("a_b_c.exe"));
    assert_eq!(
        sanitize_name("..\\..\\evil.exe").as_deref(),
        Some("_.._evil.exe")
    );
    assert_eq!(sanitize_name("...").as_deref(), None);
    assert_eq!(sanitize_name("").as_deref(), None);
    assert_eq!(sanitize_name("file. ").as_deref(), Some("file._"));
    let long = format!("{}.exe", "x".repeat(300));
    let capped = sanitize_name(&long).unwrap();
    assert_eq!(capped.len(), MAX_NAME);
    assert!(
        capped.to_ascii_lowercase().ends_with(".exe"),
        "расширение сохраняется"
    );
}

#[test]
fn only_absolute_regular_files_are_accepted() {
    let tmp = TempDir::new("stage-bad");
    let layout = Layout::new(tmp.path());
    let dir = tmp.path().join("folder");
    std::fs::create_dir_all(&dir).unwrap();
    let cases = [
        PathBuf::from("relative.exe"),
        dir,
        tmp.path().join("missing.exe"),
        PathBuf::from("\\\\server\\share\\setup.exe"),
        PathBuf::from("\\\\.\\pipe\\x"),
    ];
    for case in cases {
        assert_eq!(
            stage_local(&layout, &case, MAX_INSTALLER_BYTES),
            Err(StageError::InvalidSource),
            "{case:?}"
        );
    }
    assert!(!layout.staging().exists(), "ничего не создано");
}

#[test]
fn a_file_over_the_limit_is_refused_without_copying() {
    let tmp = TempDir::new("stage-big");
    let layout = Layout::new(tmp.path());
    let src = source(&tmp, "big.exe", &[7u8; 64]);
    assert_eq!(stage_local(&layout, &src, 63), Err(StageError::TooLarge));
    assert!(part_files(&layout).is_empty());
    assert!(stage_local(&layout, &src, 64).is_ok(), "ровно на границе");
}

#[test]
fn a_stream_that_outgrows_its_declared_size_is_aborted() {
    let mut sink = Vec::new();
    let mut reader = io::repeat(7).take(100);
    assert_eq!(
        copy_hashing(&mut reader, &mut sink, 50).err(),
        Some(StageError::TooLarge)
    );
    assert!(sink.len() <= 50 + CHUNK, "лишнего не записано");
}

#[test]
fn a_failed_final_rename_leaves_no_part_file() {
    let tmp = TempDir::new("stage-clash");
    let layout = Layout::new(tmp.path());
    let src = source(&tmp, "setup.exe", b"payload");
    // на месте результата лежит каталог: переименование невозможно
    let clash = layout
        .staging()
        .join(format!("{}-setup.exe", sum(b"payload")));
    std::fs::create_dir_all(&clash).unwrap();
    assert_eq!(
        stage_local(&layout, &src, MAX_INSTALLER_BYTES),
        Err(StageError::Io)
    );
    assert!(part_files(&layout).is_empty());
}

#[test]
fn staging_the_same_file_twice_is_idempotent() {
    let tmp = TempDir::new("stage-twice");
    let layout = Layout::new(tmp.path());
    let src = source(&tmp, "setup.exe", b"payload");
    let first = stage_local(&layout, &src, MAX_INSTALLER_BYTES).unwrap();
    let second = stage_local(&layout, &src, MAX_INSTALLER_BYTES).unwrap();
    assert_eq!(first, second);
}

#[test]
fn error_codes_are_stable() {
    assert_eq!(StageError::InvalidSource.code(), "invalid_source");
    assert_eq!(StageError::TooLarge.code(), "too_large");
    assert_eq!(StageError::Io.code(), "stage_failed");
}

#[test]
fn a_signature_next_to_the_installer_is_copied_along() {
    let tmp = TempDir::new("stage-sig");
    let layout = Layout::new(&tmp.path().join("data"));
    let src = source(&tmp, "setup.exe", b"installer bytes");
    source(&tmp, "setup.exe.minisig", b"signature text");

    let staged = stage_local(&layout, &src, MAX_INSTALLER_BYTES).unwrap();
    let sig = PathBuf::from(format!("{}.minisig", staged.staged_path));
    assert_eq!(std::fs::read(sig).unwrap(), b"signature text");
}

#[test]
fn a_missing_or_oversized_signature_is_skipped_without_error() {
    let tmp = TempDir::new("stage-nosig");
    let layout = Layout::new(&tmp.path().join("data"));
    let src = source(&tmp, "a.exe", b"one");
    let staged = stage_local(&layout, &src, MAX_INSTALLER_BYTES).unwrap();
    assert!(!PathBuf::from(format!("{}.minisig", staged.staged_path)).exists());

    let big = source(&tmp, "b.exe", b"two");
    source(
        &tmp,
        "b.exe.minisig",
        &vec![b'x'; (MAX_SIGNATURE_BYTES + 1) as usize],
    );
    let staged = stage_local(&layout, &big, MAX_INSTALLER_BYTES).unwrap();
    assert!(!PathBuf::from(format!("{}.minisig", staged.staged_path)).exists());
}
