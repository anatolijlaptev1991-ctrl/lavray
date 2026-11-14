// SPDX-License-Identifier: GPL-3.0-only

//! Какой путь записывать в автозапуск. Из `AppImage` `current_exe()` указывает
//! внутрь временной точки монтирования (`/tmp/.mount_…`), которой после выхода
//! не будет, поэтому запись должна вести на сам файл `AppImage`: путь в
//! переменной `APPIMAGE`, которую задаёт его загрузчик.

use std::ffi::OsString;
use std::path::PathBuf;

/// `appimage` (значение `APPIMAGE`), если это абсолютный путь, иначе `current`.
pub(super) fn pick(appimage: Option<OsString>, current: PathBuf) -> PathBuf {
    match appimage.map(PathBuf::from) {
        Some(path) if path.is_absolute() => path,
        _ => current,
    }
}

/// Путь программы для автозапуска: `APPIMAGE` на Linux, иначе `current_exe()`.
pub(super) fn detect() -> Result<PathBuf, String> {
    let current = std::env::current_exe().map_err(|e| format!("путь к LAVRay.exe: {e}"))?;
    let appimage = std::env::var_os("APPIMAGE").filter(|_| cfg!(target_os = "linux"));
    Ok(pick(appimage, current))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abs(name: &str) -> PathBuf {
        std::env::temp_dir().join(name)
    }

    #[test]
    fn appimage_path_wins_over_the_mount_point() {
        let image = abs("LAVRay-x86_64.AppImage");
        let mounted = abs(".mount_LAVRayX/usr/bin/lavray");
        assert_eq!(pick(Some(image.clone().into_os_string()), mounted), image);
    }

    #[test]
    fn without_appimage_the_current_exe_is_used() {
        let current = abs("lavray");
        assert_eq!(pick(None, current.clone()), current);
    }

    #[test]
    fn an_empty_or_relative_value_is_ignored() {
        let current = abs("lavray");
        for bad in ["", "LAVRay.AppImage"] {
            assert_eq!(pick(Some(bad.into()), current.clone()), current);
        }
    }
}
