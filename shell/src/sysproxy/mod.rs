// SPDX-License-Identifier: GPL-3.0-only

//! sysproxy — системный прокси ОС (FR-UI-221/222/259).
//!
//! Принцип: перед изменением — снимок настроек в файл рядом с данными; при
//! отключении/падении — откат (не «выключить прокси», а «вернуть как было»).
//! Незакрытый снимок после падения находит следующий старт.
//!
//! Откат трёхсторонний (T-42): значение возвращается к исходному, только если
//! сейчас оно наше (снимок хранит и то, что стояло сразу после включения).
//! Windows: реестр Internet Settings (LAN) + WinINET по подключениям (WPAD и
//! каждая запись RAS/VPN, T-82). Linux: gsettings (GNOME). macOS: `networksetup`.

mod backend;
mod command;
#[cfg(test)]
mod command_tests;
#[cfg(any(windows, test))]
mod conn;
#[cfg(test)]
mod fakes;
#[cfg(all(unix, not(target_os = "macos")))]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(test)]
mod memconns;
mod merge;
mod outcome;
#[cfg(any(windows, test))]
mod ras;
#[cfg(test)]
mod ras_failure_tests;
#[cfg(test)]
mod ras_tests;
#[cfg(windows)]
mod registry;
mod serial;
#[cfg(test)]
mod serial_tests;
mod snapshot;
#[cfg(test)]
mod tests;
mod validate;
#[cfg(any(windows, test))]
mod values;
#[cfg(any(windows, test))]
mod windows;
#[cfg(windows)]
mod wininet;
#[cfg(all(test, windows))]
mod wininet_tests;
#[cfg(any(windows, test))]
mod wpad;
#[cfg(test)]
mod wpad_tests;

pub use backend::{apply, capture, clear, restore, Backend, System};
pub use command::{set_blocking, set_with};
pub use outcome::{Applied, SetOutcome};
pub use snapshot::ProxySnapshot;
pub use validate::{validate_host, validate_port};

use merge::three_way;
use outcome::log_warnings;
use serial::exclusive;
use snapshot::StoredSnapshot;
use std::path::{Path, PathBuf};

/// Менеджер системного прокси: снимок + применение + откат.
pub struct SysProxy<B: Backend = System> {
    snapshot_path: PathBuf,
    backend: B,
}

impl SysProxy {
    /// Менеджер с файлом снимка в каталоге данных.
    pub fn new(data_dir: &Path) -> Self {
        Self::with_backend(data_dir, System)
    }
}

impl<B: Backend> SysProxy<B> {
    /// Менеджер с подставным бэкендом (тесты).
    pub fn with_backend(data_dir: &Path, backend: B) -> Self {
        Self {
            snapshot_path: data_dir.join("sysproxy.snapshot.json"),
            backend,
        }
    }

    /// Исходные настройки из незакрытого снимка (приложение упало, не успев
    /// их вернуть) — надо откатить ДО нового применения.
    pub fn pending_snapshot(&self) -> Option<ProxySnapshot> {
        self.pending().map(|stored| stored.original)
    }

    fn pending(&self) -> Option<StoredSnapshot> {
        StoredSnapshot::load(&self.snapshot_path)
    }

    /// Вернуть настройки из снимка и удалить его; `Ok(None)` — снимка нет. Ошибка
    /// или предупреждение (RAS, WPAD — T-82) оставляют снимок для повтора.
    fn rollback(&self) -> Result<Option<Vec<String>>, String> {
        let Some(stored) = self.pending() else {
            return Ok(None);
        };
        let target = match &stored.applied {
            Some(applied) => ProxySnapshot {
                data: three_way(
                    &stored.original.data,
                    &applied.data,
                    &self.backend.capture()?.data,
                ),
                ..stored.original.clone()
            },
            None => stored.original.clone(),
        };
        let warnings = self.backend.restore(&target)?;
        // RAS/WPAD не вернулись — снимок остаётся для повтора (исчезнувшие записи пропускаются).
        if warnings.is_empty() {
            let _ = std::fs::remove_file(&self.snapshot_path);
        }
        Ok(Some(warnings))
    }

    /// Восстановить настройки из незакрытого снимка (idempotent).
    pub fn recover_if_needed(&self) -> Result<bool, String> {
        let _guard = exclusive();
        let warnings = self.rollback()?;
        log_warnings(warnings.as_deref().unwrap_or_default());
        Ok(warnings.is_some())
    }

    /// Включить системный прокси `host:port`, сохранив предыдущее состояние.
    ///
    /// Адрес проверяется раньше всего прочего (A2-18): отказ не трогает ни
    /// реестр, ни снимок, ни уже идущую сессию. Сбой необязательной части
    /// (RAS, WPAD) не срывает включение: он в [`Applied::warnings`].
    pub fn enable(&self, host: &str, port: u16) -> Result<Applied, String> {
        validate_host(host)?;
        validate_port(i64::from(port))?;
        let _guard = exclusive();
        // Повторное включение при живом снимке: сначала откатываем прошлое.
        // Не вышло — выходим, не трогая файл: в нём настоящие настройки
        // пользователя, а снять новый снимок значило бы стереть их нашими.
        let mut warnings = self
            .rollback()
            .map_err(|e| format!("не удалось вернуть прежние настройки прокси: {e}"))?
            .unwrap_or_default();
        let original = self.backend.capture()?;
        let first = StoredSnapshot {
            original: original.clone(),
            applied: None,
        };
        first.save(&self.snapshot_path)?;
        match self.backend.apply(host, port, &original) {
            Ok(more) => warnings.extend(more),
            Err(e) => {
                return Err(match self.rollback() {
                    Ok(_) => e,
                    Err(rollback_error) => format!("{e}; откат не удался: {rollback_error}"),
                })
            }
        }
        // То, что стоит сейчас, поставили мы: по этому откат отличит свои
        // значения от чужих. Не записалось — снимок остаётся без `applied`,
        // откат будет безусловным.
        let applied = self.backend.capture().ok();
        let _ = StoredSnapshot { original, applied }.save(&self.snapshot_path);
        Ok(Applied {
            host: host.to_string(),
            port,
            warnings,
        })
    }

    /// Выключить: вернуть снимок (а не просто «очистить прокси»).
    ///
    /// Без снимка — no-op: значит, прокси включали не мы (или он уже снят),
    /// и стирать настройки пользователя (`clear()`) нельзя. Раньше здесь
    /// стоял `clear()`, из-за чего «Отключить» в приложении выключал
    /// собственный прокси пользователя, выставленный вручную.
    pub fn disable(&self) -> Result<(), String> {
        self.disable_report()
            .map(|warnings| log_warnings(&warnings))
    }

    /// То же, что [`disable`](Self::disable), но предупреждения (подключение
    /// RAS не вернулось и т. п.) отдаются вызывающему, а не в журнал.
    pub fn disable_report(&self) -> Result<Vec<String>, String> {
        let _guard = exclusive();
        self.rollback().map(Option::unwrap_or_default)
    }

    /// Снять прокси при выходе: вернуть снимок, если он есть (команда выхода и трей).
    pub fn release_on_quit(&self) -> Result<(), String> {
        self.disable()
    }
}
