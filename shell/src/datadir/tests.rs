// SPDX-License-Identifier: GPL-3.0-only

use super::*;

/// Временный каталог, удаляемый в конце теста.
struct Temp(PathBuf);

impl Temp {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("lavray-datadir-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn legacy_with_db(base: &Path) -> PathBuf {
    let legacy = base.join("old");
    std::fs::create_dir_all(&legacy).unwrap();
    std::fs::write(legacy.join(DB_FILE), b"data").unwrap();
    legacy
}

#[test]
fn legacy_directory_with_a_database_is_renamed() {
    let tmp = Temp::new("rename");
    let legacy = legacy_with_db(&tmp.0);
    let current = tmp.0.join("new");
    assert_eq!(migrate_legacy(&legacy, &current), Migration::Renamed);
    assert!(current.join(DB_FILE).is_file());
    assert!(!legacy.exists());
}

#[test]
fn nothing_happens_when_the_new_directory_exists() {
    let tmp = Temp::new("exists");
    let legacy = legacy_with_db(&tmp.0);
    let current = tmp.0.join("new");
    std::fs::create_dir_all(&current).unwrap();
    assert_eq!(migrate_legacy(&legacy, &current), Migration::NotNeeded);
    assert!(legacy.join(DB_FILE).is_file(), "старый каталог не тронут");
}

#[test]
fn a_legacy_directory_without_a_database_stays() {
    let tmp = Temp::new("nodb");
    let legacy = tmp.0.join("old");
    std::fs::create_dir_all(&legacy).unwrap();
    assert_eq!(
        migrate_legacy(&legacy, &tmp.0.join("new")),
        Migration::NotNeeded
    );
    assert!(legacy.is_dir());
    assert_eq!(
        migrate_legacy(&tmp.0.join("none"), &tmp.0.join("new")),
        Migration::NotNeeded
    );
}

#[test]
fn a_failed_rename_is_reported_and_leaves_the_data() {
    let tmp = Temp::new("fail");
    let legacy = legacy_with_db(&tmp.0);
    // родителя у нового каталога нет — переименование не удастся
    let current = tmp.0.join("missing-parent").join("new");
    assert!(matches!(
        migrate_legacy(&legacy, &current),
        Migration::Failed(_)
    ));
    assert!(legacy.join(DB_FILE).is_file());
}

#[test]
fn linux_base_follows_the_xdg_rules() {
    let abs = |p: &str| {
        Some(OsString::from(if cfg!(windows) {
            format!("C:{p}")
        } else {
            p.to_string()
        }))
    };
    let xdg = linux_base(abs("/data"), abs("/home/u")).unwrap();
    assert!(xdg.ends_with("data"));
    let home = linux_base(None, abs("/home/u")).unwrap();
    assert!(home.ends_with(Path::new(".local").join("share")));
    assert!(linux_base(Some("rel".into()), abs("/home/u"))
        .unwrap()
        .ends_with("share"));
    assert_eq!(linux_base(None, Some("rel".into())), None);
    assert_eq!(linux_base(None, None), None);
}

#[test]
fn private_means_ours_and_0700() {
    assert!(is_private_to(1000, 0o040_700, 1000));
    assert!(!is_private_to(1000, 0o040_755, 1000));
    assert!(!is_private_to(0, 0o040_700, 1000));
}

#[test]
fn fallback_prefers_the_runtime_dir_then_a_checked_temp_dir() {
    let abs = if cfg!(windows) {
        "C:\\run"
    } else {
        "/run/user/1"
    };
    let temp = Path::new("tmp-root");
    let runtime = fallback_dir(Some(abs.into()), temp, |_| false).unwrap();
    assert!(runtime.ends_with("lavray") && runtime.starts_with(abs));
    assert_eq!(
        fallback_dir(None, temp, |_| true),
        Some(temp.join("lavray"))
    );
    assert_eq!(
        fallback_dir(Some("rel".into()), temp, |_| true),
        Some(temp.join("lavray"))
    );
    assert_eq!(fallback_dir(None, temp, |_| false), None);
}

#[cfg(unix)]
#[test]
fn ensure_private_creates_and_tightens_with_0700() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = Temp::new("private");
    let fresh = tmp.0.join("a").join("fresh");
    ensure_private(&fresh).unwrap();
    let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&fresh), 0o700);
    let open = tmp.0.join("open");
    std::fs::create_dir(&open).unwrap();
    std::fs::set_permissions(&open, std::fs::Permissions::from_mode(0o755)).unwrap();
    ensure_private(&open).unwrap();
    assert_eq!(mode(&open), 0o700);
}
