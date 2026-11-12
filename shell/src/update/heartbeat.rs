// SPDX-License-Identifier: GPL-3.0-only

//! Heartbeat новой версии (T-75): `health.json {"version","ok_at"}` в
//! `<data>/updates`. Файл пишет команда `update_health_ok`, когда UI сообщил,
//! что ядро готово и первый кадр нарисован; watchdog читает его и решает, жива
//! ли свежеустановленная версия.

use super::layout::Layout;
use crate::files::bounded::read_bounded;
use crate::files::io::write_atomic;
use crate::updater::HEARTBEAT_GRACE;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::PathBuf;

/// Содержимое `health.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Health {
    /// Версия приложения, которое отметилось.
    pub version: String,
    /// Когда, миллисекунды Unix.
    pub ok_at: u64,
}

/// Тот же `health.json` для записи: версия заимствована, без копии строки.
#[derive(Serialize)]
struct HealthRef<'a> {
    version: &'a str,
    ok_at: u64,
}

/// Наибольший размер `health.json`, байт: настоящий файл — десятки байт.
pub const MAX_HEALTH_BYTES: u64 = 4 * 1024;

/// Что показывает отметка здоровья на момент `now`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthVerdict {
    /// Отметка ожидаемой версии, сделанная после запуска.
    Ok,
    /// Годной отметки нет, а grace-период ещё идёт.
    Pending,
    /// Годной отметки нет, grace-период вышел: пора откатываться.
    Missing,
}

/// Версия без ведущего `v` (`v0.5.1` и `0.5.1` — одно и то же).
fn bare(version: &str) -> &str {
    version.trim().trim_start_matches('v')
}

/// [`HEARTBEAT_GRACE`] в миллисекундах: единый источник — `updater.rs`.
#[must_use]
pub fn grace_ms() -> u64 {
    u64::try_from(HEARTBEAT_GRACE.as_millis()).unwrap_or(u64::MAX)
}

/// Оценить отметку. Годная — версия совпадает с ожидаемой и сделана не раньше
/// запуска (`started_at`): отметка прошлого запуска той же версии не в счёт.
/// Отметка другой версии считается отсутствующей.
#[must_use]
pub fn evaluate(
    health: Option<&Health>,
    expected_version: &str,
    started_at: u64,
    now: u64,
) -> HealthVerdict {
    let valid =
        health.is_some_and(|h| bare(&h.version) == bare(expected_version) && h.ok_at >= started_at);
    match (valid, now.saturating_sub(started_at) >= grace_ms()) {
        (true, _) => HealthVerdict::Ok,
        (false, false) => HealthVerdict::Pending,
        (false, true) => HealthVerdict::Missing,
    }
}

/// Откуда watchdog берёт отметку (в тестах — подставка).
pub trait HealthSource {
    fn read(&self) -> Option<Health>;
}

/// `health.json` на диске.
pub struct HealthStore {
    path: PathBuf,
}

impl HealthStore {
    #[must_use]
    pub fn new(layout: &Layout) -> Self {
        Self {
            path: layout.health_file(),
        }
    }

    /// Записать отметку атомарно; повторный вызов просто обновляет время.
    pub fn write_ok(&self, version: &str, now_ms: u64) -> io::Result<()> {
        let health = HealthRef {
            version,
            ok_at: now_ms,
        };
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_vec(&health).map_err(io::Error::other)?;
        write_atomic(&self.path, &json)
    }
}

impl HealthSource for HealthStore {
    /// Нет файла, он испорчен или больше предела — отметки нет.
    fn read(&self) -> Option<Health> {
        let raw = read_bounded(&self.path, MAX_HEALTH_BYTES).ok()?;
        serde_json::from_slice(&raw).ok()
    }
}

#[cfg(test)]
mod tests;
