// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::update::testkit::{staged_name, MemFs};

fn staging() -> PathBuf {
    std::env::temp_dir().join("lavray-fake").join("staging")
}

fn other() -> PathBuf {
    std::env::temp_dir().join("lavray-fake").join("other")
}

fn name() -> String {
    staged_name('a', "LAVRay_0.5.1_x64-setup.exe")
}

#[test]
fn accepts_a_direct_child_with_a_valid_name() {
    let fs = MemFs::with_file(&staging(), &name());
    let candidate = staging().join(name());
    assert_eq!(validate_in(&fs, &staging(), &candidate), Ok(candidate));
}

#[test]
fn rejects_parent_dir_components_even_when_the_result_is_inside() {
    let fs = MemFs::with_file(&staging(), &name());
    let sneaky = staging().join("sub").join("..").join(name());
    fs.add(&sneaky, &staging().join(name()));
    assert_eq!(
        validate_in(&fs, &staging(), &sneaky),
        Err(PathError::NotInside)
    );
}

#[test]
fn rejects_a_file_outside_the_directory() {
    let fs = MemFs::with_file(&staging(), &name());
    fs.add(&other(), &other());
    fs.add(&other().join(name()), &other().join(name()));
    let candidate = other().join(name());
    assert_eq!(
        validate_in(&fs, &staging(), &candidate),
        Err(PathError::NotInside)
    );
}

#[test]
fn rejects_a_symlink_that_resolves_elsewhere() {
    let fs = MemFs::with_file(&staging(), &name());
    let candidate = staging().join(name());
    fs.add(&candidate, &other().join(name()));
    assert_eq!(
        validate_in(&fs, &staging(), &candidate),
        Err(PathError::NotInside)
    );
}

#[test]
fn rejects_a_link_to_a_sibling_with_another_name() {
    let fs = MemFs::with_file(&staging(), &name());
    let candidate = staging().join(name());
    fs.add(&candidate, &staging().join(staged_name('b', "other.exe")));
    assert_eq!(
        validate_in(&fs, &staging(), &candidate),
        Err(PathError::NotInside)
    );
}

#[test]
fn rejects_a_reparse_point_even_if_it_canonicalizes_inside() {
    let fs = MemFs::with_file(&staging(), &name());
    let candidate = staging().join(name());
    fs.mark_link(&candidate);
    assert_eq!(
        validate_in(&fs, &staging(), &candidate),
        Err(PathError::NotInside)
    );
}

#[test]
fn rejects_a_directory_that_is_itself_a_link() {
    let fs = MemFs::with_file(&staging(), &name());
    fs.mark_link(&staging());
    let candidate = staging().join(name());
    assert_eq!(
        validate_in(&fs, &staging(), &candidate),
        Err(PathError::NotInside)
    );
}

#[test]
fn rejects_nested_paths() {
    let fs = MemFs::with_file(&staging(), &name());
    let nested = staging().join("sub").join(name());
    fs.add(&staging().join("sub"), &staging().join("sub"));
    fs.add(&nested, &nested);
    assert_eq!(
        validate_in(&fs, &staging(), &nested),
        Err(PathError::NotInside)
    );
}

#[test]
fn rejects_relative_paths() {
    let fs = MemFs::default();
    let relative = Path::new("updates").join("staging").join(name());
    assert_eq!(
        validate_in(&fs, &staging(), &relative),
        Err(PathError::NotInside)
    );
}

#[test]
fn rejects_malformed_names() {
    let sha = "a".repeat(64);
    let bad = [
        "evil.exe".to_string(),
        format!("{sha}-"),
        format!("{}-x.exe", "a".repeat(63)),
        format!("{}-x.exe", "g".repeat(64)),
        format!("{sha}_x.exe"),
        format!("{sha}-a:stream"),
        format!("{sha}-a<b.exe"),
        format!("{sha}-a|b.exe"),
        format!("{sha}-a.exe."),
        format!("{sha}-a.exe "),
        format!("{sha}-.."),
        format!("{sha}-a\u{1}b.exe"),
        format!("{sha}-{}", "x".repeat(300)),
    ];
    for file in bad {
        let fs = MemFs::with_file(&staging(), &file);
        let candidate = staging().join(&file);
        assert_eq!(
            validate_in(&fs, &staging(), &candidate),
            Err(PathError::BadName),
            "{file:?}"
        );
    }
}

#[test]
fn a_missing_directory_or_file_is_refused() {
    let fs = MemFs::default();
    let candidate = staging().join(name());
    assert!(validate_in(&fs, &staging(), &candidate).is_err());
    fs.add(&staging(), &staging());
    assert!(validate_in(&fs, &staging(), &candidate).is_err());
}

#[test]
fn reparse_attribute_is_detected() {
    assert!(is_reparse_attr(0x400));
    assert!(is_reparse_attr(0x20 | 0x400));
    assert!(!is_reparse_attr(0x20));
    assert!(!is_reparse_attr(0x10));
}

#[test]
fn a_staged_name_splits_into_sum_and_file() {
    let n = name();
    assert_eq!(
        parse_staged_name(&n),
        Some(("a".repeat(64).as_str(), "LAVRay_0.5.1_x64-setup.exe"))
    );
}

#[cfg(windows)]
mod real_windows {
    use super::*;
    use crate::update::testkit::TempDir;

    /// Junction `link` -> `target` через `cmd /c mklink /J` (только во временной
    /// папке); `false` — создать не удалось (политика), тест пропускается.
    fn junction(link: &Path, target: &Path) -> bool {
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .is_ok_and(|out| out.status.success())
    }

    /// Убирает junction, не заходя в цель.
    fn unlink(link: &Path) {
        let _ = std::fs::remove_dir(link);
    }

    fn layout(tmp: &TempDir) -> (PathBuf, PathBuf) {
        let staging = tmp.path().join("updates").join("staging");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join(name()), b"payload").unwrap();
        (staging, outside)
    }

    #[test]
    fn real_files_pass_and_the_probe_resolves_them() {
        let tmp = TempDir::new("paths-real");
        let (staging, _) = layout(&tmp);
        std::fs::write(staging.join(name()), b"ok").unwrap();
        let candidate = staging.join(name());
        assert_eq!(validate_in(&RealFs, &staging, &candidate), Ok(candidate));
    }

    #[test]
    fn junction_escape_rejected() {
        let tmp = TempDir::new("paths-junction");
        let (staging, outside) = layout(&tmp);
        // 1) сам «установщик» — junction на каталог снаружи
        let evil = staging.join(staged_name('b', "evil.exe"));
        if !junction(&evil, &outside) {
            eprintln!("mklink /J недоступен — проверка пропущена");
            return;
        }
        assert!(validate_in(&RealFs, &staging, &evil).is_err());
        unlink(&evil);

        // 2) подкаталог-junction: файл внутри него лежит вне staging
        let hop = staging.join("hop");
        assert!(junction(&hop, &outside));
        assert!(validate_in(&RealFs, &staging, &hop.join(name())).is_err());
        unlink(&hop);

        // 3) сам staging подменён junction
        let fake = tmp.path().join("fake-staging");
        assert!(junction(&fake, &outside));
        assert!(validate_in(&RealFs, &fake, &fake.join(name())).is_err());
        unlink(&fake);
    }
}
