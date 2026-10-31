// SPDX-License-Identifier: GPL-3.0-only

//! Раскладка каталога `<data>/updates`. `<data>` — тот же каталог данных, что
//! оболочка передаёт ядру (`DataDir`); ядро пишет проверенные установщики в
//! `staging`, остальное ведёт оболочка.

use crate::updater::ROLLBACK_DIR;
use std::path::{Path, PathBuf};

/// Имя каталога обновлений внутри каталога данных.
pub const UPDATES_DIR: &str = "updates";
/// Имя файла отметки здоровья в `<data>/updates`.
pub const HEALTH_FILE: &str = "health.json";

/// Пути обновлений для одного каталога данных.
#[derive(Debug, Clone)]
pub struct Layout {
    data: PathBuf,
}

impl Layout {
    /// Раскладка для каталога данных приложения.
    pub fn new(data_dir: &Path) -> Self {
        Self {
            data: data_dir.to_path_buf(),
        }
    }

    /// Каталог данных, от которого всё считается.
    pub fn data_dir(&self) -> &Path {
        &self.data
    }

    /// `<data>/updates`.
    pub fn root(&self) -> PathBuf {
        self.data.join(UPDATES_DIR)
    }

    /// `<data>/updates/staging` — сюда ядро кладёт проверенные установщики.
    pub fn staging(&self) -> PathBuf {
        self.root().join("staging")
    }

    /// Единственный прошлый установщик ([`ROLLBACK_DIR`] — единый источник пути).
    pub fn previous_dir(&self) -> PathBuf {
        ROLLBACK_DIR
            .split('/')
            .fold(self.data.clone(), |path, part| path.join(part))
    }

    /// Установщик версии, которая стоит сейчас: при следующем обновлении
    /// он станет «прошлым».
    pub fn applied_dir(&self) -> PathBuf {
        self.root().join("applied")
    }

    /// Копия применяемого установщика, пока обновление не запущено.
    pub fn pending_dir(&self) -> PathBuf {
        self.root().join("pending")
    }

    /// Каталог копий exe для режима watchdog.
    pub fn watchdog_dir(&self) -> PathBuf {
        self.root().join("watchdog")
    }

    /// `health.json` — отметка здоровья запущенной версии.
    pub fn health_file(&self) -> PathBuf {
        self.root().join(HEALTH_FILE)
    }

    /// `last-update.json` — чем кончил работу watchdog.
    pub fn result_file(&self) -> PathBuf {
        self.root().join("last-update.json")
    }
}
