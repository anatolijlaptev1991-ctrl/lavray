// SPDX-License-Identifier: GPL-3.0-only

//! Linux: поток XDG-автозапуска — состояние из записи Desktop Entry
//! ([`desktop`]) в каталоге автозапуска сеанса. Внешних команд нет, поэтому
//! [`super::Exec`] здесь не участвует; файловая часть — в [`desktop`].

use super::desktop;
use super::{AutostartState, Env, Method};
use std::path::Path;

/// Каталог автозапуска из значений переменных (по спецификации базовых
/// каталогов): абсолютное `$XDG_CONFIG_HOME` → `<xdg>/autostart`; пустое и
/// относительное значение игнорируется, тогда `~/.config/autostart`.
pub fn autostart_dir_in(
    xdg: Option<&std::ffi::OsStr>,
    home: Option<&std::ffi::OsStr>,
) -> Result<std::path::PathBuf, String> {
    if let Some(xdg) = xdg {
        let dir = std::path::PathBuf::from(xdg);
        if dir.is_absolute() {
            return Ok(dir.join("autostart"));
        }
    }
    let home = home
        .map(std::path::PathBuf::from)
        .filter(|home| home.is_absolute())
        .ok_or_else(|| "не удалось определить домашний каталог (HOME не задан)".to_string())?;
    Ok(home.join(".config").join("autostart"))
}

/// Каталог автозапуска текущего пользователя — значения из окружения.
pub fn autostart_dir() -> Result<std::path::PathBuf, String> {
    autostart_dir_in(
        std::env::var_os("XDG_CONFIG_HOME").as_deref(),
        std::env::var_os("HOME").as_deref(),
    )
}

/// Состояние XDG-автозапуска: включённость — из файла записи (FR-UI-013).
/// Запись с путём от прежнего расположения программы обновляется на текущий
/// exe (как пересоздание задачи старого вида на Windows), не мешая ответу.
/// Способ указывается всегда: на Linux он один, и UI подбирает по нему
/// формулировки подсказок.
pub(super) fn state(dir: &Path, env: &Env) -> Result<AutostartState, String> {
    let path = dir.join(desktop::ENTRY_FILE);
    let contents = match std::fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let entry = contents.as_deref().map(desktop::entry_state);
    if let Some(desktop::Entry::Enabled { exec }) = &entry {
        if *exec != desktop::entry_exec(&env.exe) {
            // Переезд программы. Запись атомарная (temp+rename), не следует
            // симлинку; сбой — в журнал, состояние остаётся как прочитано.
            if let Err(reason) = desktop::enable(dir, &env.exe) {
                eprintln!("LAVRay: запись автозапуска не обновлена: {reason}");
            }
        }
    }
    Ok(AutostartState {
        supported: true,
        enabled: matches!(entry, Some(desktop::Entry::Enabled { .. })),
        method: Some(Method::DesktopEntry),
        elevated: env.elevated,
        installed: env.installed,
        unknown: matches!(entry, Some(desktop::Entry::Unknown)),
        notice: None,
    })
}

/// Включить или выключить XDG-автозапуск и вернуть состояние, заново
/// прочитанное из каталога. Имя файла `lavray.desktop` принадлежит приложению:
/// чужой или повреждённый файл при включении затирается.
pub(super) fn set_enabled(dir: &Path, env: &Env, enabled: bool) -> Result<AutostartState, String> {
    if enabled {
        desktop::enable(dir, &env.exe)?;
    } else {
        desktop::disable(dir)?;
    }
    state(dir, env)
}
