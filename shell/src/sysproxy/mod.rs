// SPDX-License-Identifier: GPL-3.0-only

//! sysproxy — системный прокси ОС (FR-UI-221/222/259).
//!
//! Принцип: перед изменением — снимок текущих настроек в файл рядом с
//! данными; при отключении/падении — откат (не «выключить прокси», а «вернуть
//! как было»). Если приложение упало, следующий старт находит незакрытый снимок
//! и возвращает настройки (teardown-verify).
//!
//! Откат трёхсторонний (T-42): рядом с исходными настройками в снимок
//! записывается то, что стояло сразу после нашего включения. Значение
//! возвращается к исходному, только если сейчас оно такое, какое поставили мы;
//! если за время сессии его изменили пользователь или другая программа, оно
//! остаётся как есть.
//!
//! Windows: WinINET через реестр (Internet Settings) + InternetSetOption
//! (WM_SETTINGCHANGE) — то, что видят Chrome/Edge/системные приложения.
//! Linux: gsettings (GNOME); KDE — kioslaverc (через `kwriteconfig5/6`).
//! macOS: `networksetup -setwebproxy/-setsecurewebproxy`.

mod backend;
#[cfg(all(unix, not(target_os = "macos")))]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
mod merge;
#[cfg(windows)]
mod registry;
mod snapshot;
#[cfg(test)]
mod tests;
mod validate;
#[cfg(any(windows, test))]
mod values;

pub use backend::{apply, capture, clear, restore, Backend, System};
pub use snapshot::ProxySnapshot;
pub use validate::{validate_host, validate_port};

use merge::three_way;
use snapshot::StoredSnapshot;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// Итог применения.
#[derive(Debug, Clone)]
pub struct Applied {
    /// Точка выхода прокси, которую увидит система.
    pub host: String,
    pub port: u16,
}

/// Операции с прокси идут по одной: ими пользуются и команды UI, и поток
/// надзирателя (снятие прокси при смерти ядра, T-03).
static OPERATIONS: Mutex<()> = Mutex::new(());

fn exclusive() -> MutexGuard<'static, ()> {
    OPERATIONS.lock().unwrap_or_else(|e| e.into_inner())
}

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

    fn store(&self, stored: &StoredSnapshot) -> Result<(), String> {
        stored.save(&self.snapshot_path)
    }

    /// Вернуть настройки из снимка и удалить его. `Ok(false)` — снимка нет.
    /// При ошибке снимок остаётся: следующая попытка доделает откат.
    fn rollback(&self) -> Result<bool, String> {
        let Some(stored) = self.pending() else {
            return Ok(false);
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
        self.backend.restore(&target)?;
        let _ = std::fs::remove_file(&self.snapshot_path);
        Ok(true)
    }

    /// Восстановить настройки из незакрытого снимка (idempotent).
    pub fn recover_if_needed(&self) -> Result<bool, String> {
        let _guard = exclusive();
        self.rollback()
    }

    /// Включить системный прокси `host:port`, сохранив предыдущее состояние.
    ///
    /// Адрес проверяется раньше всего прочего (A2-18): отказ не трогает ни
    /// реестр, ни снимок, ни уже идущую сессию.
    pub fn enable(&self, host: &str, port: u16) -> Result<Applied, String> {
        validate_host(host)?;
        validate_port(i64::from(port))?;
        let _guard = exclusive();
        // Повторное включение при живом снимке: сначала откатываем прошлое.
        // Не вышло — выходим, не трогая файл: в нём настоящие настройки
        // пользователя, а снять новый снимок значило бы стереть их нашими.
        self.rollback()
            .map_err(|e| format!("не удалось вернуть прежние настройки прокси: {e}"))?;
        let original = self.backend.capture()?;
        self.store(&StoredSnapshot {
            original: original.clone(),
            applied: None,
        })?;
        if let Err(e) = self.backend.apply(host, port) {
            return Err(match self.rollback() {
                Ok(_) => e,
                Err(rollback_error) => format!("{e}; откат не удался: {rollback_error}"),
            });
        }
        // То, что стоит сейчас, поставили мы: по этому откат отличит свои
        // значения от чужих. Не записалось — снимок остаётся без `applied`,
        // откат будет безусловным.
        let applied = self.backend.capture().ok();
        let _ = self.store(&StoredSnapshot { original, applied });
        Ok(Applied {
            host: host.to_string(),
            port,
        })
    }

    /// Выключить: вернуть снимок (а не просто «очистить прокси»).
    ///
    /// Без снимка — no-op: значит, прокси включали не мы (или он уже снят),
    /// и стирать настройки пользователя (`clear()`) нельзя. Раньше здесь
    /// стоял `clear()`, из-за чего «Отключить» в приложении выключал
    /// собственный прокси пользователя, выставленный вручную.
    pub fn disable(&self) -> Result<(), String> {
        let _guard = exclusive();
        self.rollback().map(|_| ())
    }

    /// Снять прокси при выходе приложения: восстановить снимок, если он есть.
    /// Отдельный метод, чтобы вызывать его и из команды выхода, и из трея.
    pub fn release_on_quit(&self) -> Result<(), String> {
        self.disable()
    }
}
