// SPDX-License-Identifier: GPL-3.0-only

//! Каталог данных приложения (D5): Windows — `%APPDATA%\LAVRay`, macOS —
//! `~/Library/Application Support/LAVRay`, Linux — `$XDG_DATA_HOME/lavray`
//! (по умолчанию `~/.local/share/lavray`).
//!
//! На Linux каталог раньше назывался `LAVRay` (как на Windows). Если новый
//! `lavray` не существует, а старый содержит `lavray.db`, он один раз
//! переименовывается: иначе клиент молча стартовал бы с пустой базой.

#[cfg(test)]
mod tests;

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Прежнее имя каталога данных на Linux.
const LEGACY_NAME: &str = "LAVRay";
/// Нынешнее имя каталога данных на Linux.
const LINUX_NAME: &str = "lavray";
/// Файл базы: по нему видно, что старый каталог — настоящие данные.
const DB_FILE: &str = "lavray.db";

/// Что сделал перенос прежнего каталога.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Migration {
    /// Переносить нечего: нового каталога нет, а в старом нет базы — или новый уже есть.
    NotNeeded,
    /// Старый каталог переименован в новый.
    Renamed,
    /// Переименовать не вышло (текст ошибки): работаем со старым каталогом.
    Failed(String),
}

/// Переименовать `legacy` в `current`, если `current` нет, а в `legacy` есть база.
#[must_use]
pub fn migrate_legacy(legacy: &Path, current: &Path) -> Migration {
    if current.exists() || !legacy.join(DB_FILE).is_file() {
        return Migration::NotNeeded;
    }
    match std::fs::rename(legacy, current) {
        Ok(()) => Migration::Renamed,
        Err(e) => Migration::Failed(format!(
            "{} -> {}: {e}",
            legacy.display(),
            current.display()
        )),
    }
}

/// База данных Linux: абсолютный `XDG_DATA_HOME`, иначе `~/.local/share`.
#[must_use]
pub fn linux_base(xdg: Option<OsString>, home: Option<OsString>) -> Option<PathBuf> {
    let xdg = xdg.map(PathBuf::from).filter(|p| p.is_absolute());
    xdg.or_else(|| {
        let home = PathBuf::from(home?);
        home.is_absolute()
            .then(|| home.join(".local").join("share"))
    })
}

/// Каталог данных Linux с переносом прежнего `LAVRay`.
fn linux_dir(base: &Path) -> PathBuf {
    let (legacy, current) = (base.join(LEGACY_NAME), base.join(LINUX_NAME));
    match migrate_legacy(&legacy, &current) {
        Migration::Failed(reason) => {
            eprintln!("LAVRay: каталог данных не переименован ({reason}); используется старый");
            legacy
        }
        Migration::Renamed => {
            if let Err(e) = ensure_private(&current) {
                eprintln!("LAVRay: права каталога данных не выставлены: {e}");
            }
            current
        }
        Migration::NotNeeded => current,
    }
}

/// Каталог принадлежит нам и закрыт 0700 (владелец `owner`, права `mode`).
#[must_use]
pub fn is_private_to(owner: u32, mode: u32, me: u32) -> bool {
    owner == me && mode & 0o777 == 0o700
}

/// Запасной каталог без HOME и `XDG_DATA_HOME` (unix): `$XDG_RUNTIME_DIR/lavray`,
/// иначе `<tmp>/lavray`, но только если `usable` его принимает (свой и 0700).
/// `None` — безопасного места нет.
#[must_use]
pub fn fallback_dir(
    runtime: Option<OsString>,
    temp: &Path,
    usable: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let runtime = runtime.map(PathBuf::from).filter(|p| p.is_absolute());
    if let Some(runtime) = runtime {
        return Some(runtime.join(LINUX_NAME));
    }
    let shared = temp.join(LINUX_NAME);
    usable(&shared).then_some(shared)
}

/// Создать каталог данных закрытым: на unix режим 0700 при создании и
/// безусловно у уже существующего (раньше было 0755 до того, как ядро закроет).
pub fn ensure_private(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        if let Some(parent) = dir.parent() {
            std::fs::create_dir_all(parent)?;
        }
        match std::fs::DirBuilder::new().mode(0o700).create(dir) {
            Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => return Err(e),
            _ => {}
        }
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(dir)
    }
}

/// Запасной каталог во временной папке: создан 0700 нами или уже такой же.
#[cfg(unix)]
fn temp_dir_is_ours(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    if ensure_private_new(path).is_err() {
        return false;
    }
    // SAFETY: `geteuid` — сисколл без аргументов и побочных эффектов.
    let me = unsafe { libc::geteuid() };
    std::fs::symlink_metadata(path)
        .is_ok_and(|m| m.is_dir() && is_private_to(m.uid(), m.mode(), me))
}

/// Создать, если нет (0700), не меняя права чужого каталога.
#[cfg(unix)]
fn ensure_private_new(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    match std::fs::DirBuilder::new().mode(0o700).create(path) {
        Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => Err(e),
        _ => Ok(()),
    }
}

#[cfg(unix)]
fn unix_fallback() -> Result<PathBuf, String> {
    fallback_dir(
        std::env::var_os("XDG_RUNTIME_DIR"),
        &std::env::temp_dir(),
        temp_dir_is_ours,
    )
    .ok_or_else(|| {
        "нет каталога для данных: не заданы HOME и XDG_DATA_HOME, а каталог во временной \
         папке чужой или открыт другим пользователям"
            .to_string()
    })
}

#[cfg(not(unix))]
fn unix_fallback() -> Result<PathBuf, String> {
    Ok(std::env::temp_dir().join("lavray"))
}

fn resolve() -> Result<PathBuf, String> {
    let var = std::env::var_os;
    if cfg!(windows) {
        if let Some(appdata) = var("APPDATA") {
            return Ok(PathBuf::from(appdata).join("LAVRay"));
        }
    } else if cfg!(target_os = "macos") {
        if let Some(home) = var("HOME") {
            let support = PathBuf::from(home)
                .join("Library")
                .join("Application Support");
            return Ok(support.join("LAVRay"));
        }
    } else if let Some(base) = linux_base(var("XDG_DATA_HOME"), var("HOME")) {
        return Ok(linux_dir(&base));
    }
    unix_fallback()
}

fn cached() -> &'static Result<PathBuf, String> {
    static DIR: OnceLock<Result<PathBuf, String>> = OnceLock::new();
    DIR.get_or_init(resolve)
}

/// Каталог данных с понятной ошибкой, если безопасного места нет (запуск ядра
/// её показывает). Перенос на Linux выполняется при первом вызове.
pub fn data_dir_checked() -> Result<PathBuf, String> {
    cached().clone()
}

/// Каталог данных; при ошибке выбора — временный (её покажет запуск ядра).
pub fn data_dir() -> PathBuf {
    data_dir_checked().unwrap_or_else(|_| std::env::temp_dir().join("lavray"))
}
