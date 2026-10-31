// SPDX-License-Identifier: GPL-3.0-only

//! Один прошлый установщик для отката (T-75). Раскладка в `<data>/updates`:
//! `applied/` — установщик версии, что стоит сейчас; `pending/` — копия
//! применяемого, пока обновление не запущено; `previous/` — единственный
//! прошлый. После успешного запуска установщика `previous ← applied`,
//! `applied ← pending`. Описание прошлого — `previous/previous.json`
//! `{"version","sha256","file"}`: его читает Go-ядро (`rollback_available`).

use super::layout::Layout;
use super::paths::parse_staged_name;
use crate::files::io::write_atomic;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};

/// Описание прошлого установщика (формат читает ядро).
pub const INFO_FILE: &str = "previous.json";
/// То же описание, пока установщик ещё «текущий».
pub const APPLIED_FILE: &str = "applied.json";

/// Описание одного хранимого установщика.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviousInfo {
    /// Версия, которую ставит этот установщик.
    pub version: String,
    /// SHA-256 установщика, hex.
    pub sha256: String,
    /// Имя файла в каталоге (`<sha256>-<имя>`).
    pub file: String,
}

/// Хранение установщиков для отката. В тестах `apply` подменяет его подставкой.
pub trait RollbackArchive {
    /// Сохранить копию применяемого установщика, пока ничего не изменено.
    fn stage(&self, installer: &Path, meta: &PreviousInfo) -> io::Result<()>;
    /// Установщик запущен: `previous ← applied`, `applied ← копия`.
    fn commit_update(&self, meta: &PreviousInfo) -> io::Result<()>;
    /// Запущен прошлый установщик: он стал текущим, прошлого больше нет.
    fn commit_rollback(&self) -> io::Result<()>;
    /// Обновление не состоялось: выбросить копию.
    fn discard(&self);
}

/// Хранилище на диске.
pub struct PreviousStore {
    layout: Layout,
}

/// Описание из `dir/file_name`, если оно целое: сумма — hex, имя — `<сумма>-…`
/// без разделителей, файл установщика на месте.
fn read_info(dir: &Path, file_name: &str) -> Option<PreviousInfo> {
    let raw = std::fs::read(dir.join(file_name)).ok()?;
    let info: PreviousInfo = serde_json::from_slice(&raw).ok()?;
    let (sum, _) = parse_staged_name(&info.file)?;
    let same_sum = sum.eq_ignore_ascii_case(&info.sha256);
    (same_sum && dir.join(&info.file).is_file()).then_some(info)
}

fn write_info(dir: &Path, file_name: &str, info: &PreviousInfo) -> io::Result<()> {
    let json = serde_json::to_vec(info).map_err(io::Error::other)?;
    write_atomic(&dir.join(file_name), &json)
}

/// Скопировать файл с `fsync`, создав каталог назначения.
fn copy_synced(from: &Path, to_dir: &Path, name: &str) -> io::Result<()> {
    std::fs::create_dir_all(to_dir)?;
    let mut source = std::fs::File::open(from)?;
    let mut target = std::fs::File::create(to_dir.join(name))?;
    io::copy(&mut source, &mut target)?;
    target.sync_all()
}

fn remove_dir(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

impl PreviousStore {
    pub fn new(layout: Layout) -> Self {
        Self { layout }
    }

    /// Прошлый установщик, если он есть и описание целое.
    pub fn available(&self) -> Option<PreviousInfo> {
        read_info(&self.layout.previous_dir(), INFO_FILE)
    }

    /// `previous ← applied`; два переименования, каждое — безопасная точка.
    fn rotate(&self) -> io::Result<()> {
        let (applied, previous) = (self.layout.applied_dir(), self.layout.previous_dir());
        remove_dir(&previous);
        std::fs::rename(&applied, &previous)?;
        std::fs::rename(previous.join(APPLIED_FILE), previous.join(INFO_FILE))
    }
}

impl RollbackArchive for PreviousStore {
    fn stage(&self, installer: &Path, meta: &PreviousInfo) -> io::Result<()> {
        let pending = self.layout.pending_dir();
        remove_dir(&pending);
        let copied = copy_synced(installer, &pending, &meta.file);
        if copied.is_err() {
            remove_dir(&pending);
        }
        copied
    }

    fn commit_update(&self, meta: &PreviousInfo) -> io::Result<()> {
        let applied_dir = self.layout.applied_dir();
        let current = read_info(&applied_dir, APPLIED_FILE);
        // тот же установщик повторно (отказ UAC, повтор) прошлым не становится
        if current.is_some_and(|c| !c.sha256.eq_ignore_ascii_case(&meta.sha256)) {
            self.rotate()?;
        }
        remove_dir(&applied_dir);
        std::fs::rename(self.layout.pending_dir(), &applied_dir)?;
        write_info(&applied_dir, APPLIED_FILE, meta)
    }

    fn commit_rollback(&self) -> io::Result<()> {
        let previous_dir = self.layout.previous_dir();
        let info = read_info(&previous_dir, INFO_FILE)
            .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
        let applied = self.layout.applied_dir();
        remove_dir(&applied);
        copy_synced(&previous_dir.join(&info.file), &applied, &info.file)?;
        write_info(&applied, APPLIED_FILE, &info)?;
        // установщик ещё может работать и держать свой файл: описание убираем
        // первым (откат тут же «недоступен»), остальное — по возможности
        std::fs::remove_file(previous_dir.join(INFO_FILE))?;
        remove_dir(&previous_dir);
        Ok(())
    }

    fn discard(&self) {
        remove_dir(&self.layout.pending_dir());
    }
}

/// Путь прошлого установщика по его описанию.
pub fn installer_path(layout: &Layout, info: &PreviousInfo) -> PathBuf {
    layout.previous_dir().join(&info.file)
}

#[cfg(test)]
mod tests;
