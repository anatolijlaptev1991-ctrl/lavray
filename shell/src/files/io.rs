// SPDX-License-Identifier: GPL-3.0-only

//! Атомарная запись выбранного пользователем файла (T-82): временный файл в
//! том же каталоге, `fsync`, переименование поверх прежнего. Сбой на любом шаге
//! оставляет прежний файл нетронутым и убирает временный.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Записать `data` в `path` атомарно. Каталог в `path` — ошибка.
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if path.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::IsADirectory,
            "это каталог",
        ));
    }
    let temp = temp_path(path)?;
    let result = write_temp(&temp, data).and_then(|()| std::fs::rename(&temp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn temp_path(path: &Path) -> std::io::Result<PathBuf> {
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty());
    let name = path
        .file_name()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "нет имени файла"))?;
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    let suffix: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let temp = format!(".{}.lavray-{suffix}.tmp", name.to_string_lossy());
    Ok(dir.map_or_else(|| PathBuf::from(&temp), |d| d.join(&temp)))
}

fn write_temp(temp: &Path, data: &[u8]) -> std::io::Result<()> {
    let mut file: File = OpenOptions::new().write(true).create_new(true).open(temp)?;
    file.write_all(data)?;
    file.sync_all()
}

/// Код ошибки ввода-вывода для UI: `io:<вид>`.
pub fn io_code(e: &std::io::Error) -> String {
    format!("io:{:?}", e.kind()).to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lavray-files-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn leftovers(d: &Path) -> Vec<String> {
        std::fs::read_dir(d)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn writes_new_and_replaces_existing() {
        let d = dir("replace");
        let p = d.join("журнал.txt");
        write_atomic(&p, b"one").unwrap();
        write_atomic(&p, b"two").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"two");
        assert!(leftovers(&d).is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn empty_file_is_written() {
        let d = dir("empty");
        let p = d.join("empty.txt");
        write_atomic(&p, b"").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn write_atomic_keeps_old_on_error() {
        let d = dir("keep");
        let p = d.join("missing-dir").join("x.txt");
        assert!(write_atomic(&p, b"new").is_err(), "каталога нет");
        let target = d.join("target");
        std::fs::create_dir(&target).unwrap();
        let err = write_atomic(&target, b"new").unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::IsADirectory);
        assert!(target.is_dir(), "каталог не тронут");
        assert!(leftovers(&d).is_empty(), "временный файл убран");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn io_codes_are_stable() {
        let e = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert_eq!(io_code(&e), "io:permissiondenied");
    }
}
