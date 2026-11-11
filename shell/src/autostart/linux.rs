// SPDX-License-Identifier: GPL-3.0-only

//! Linux: поток XDG-автозапуска — состояние из записи Desktop Entry
//! ([`desktop`]) в каталоге автозапуска сеанса. Внешних команд нет, поэтому
//! [`super::Exec`] здесь не участвует; файловая часть — в [`desktop`].

use super::desktop;
use super::{AutostartState, Env, Method};
use std::path::Path;

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
            let _ = desktop::enable(dir, &env.exe);
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
