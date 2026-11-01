// SPDX-License-Identifier: GPL-3.0-only

//! Команда UI «системный прокси» (`set_system_proxy`): работа с ОС идёт не в
//! потоке команд (T-82).
//!
//! `reg.exe`, WinINET и RAS отвечают десятки и сотни миллисекунд, а на
//! занятой машине — секунды. Синхронная команда держала бы поток IPC (и
//! главное окно за ним) на всё это время, поэтому тело команды выполняется в
//! пуле блокирующих потоков. Операции по-прежнему идут по одной
//! (`SysProxy::enable/disable` берут общую блокировку).

use super::{Backend, SetOutcome, SysProxy};
use std::path::{Path, PathBuf};

/// Включить (`port` уже проверен) или выключить прокси; блокирует поток.
fn set_now(data_dir: &Path, enabled: bool, port: u16) -> Result<SetOutcome, String> {
    set_with(&SysProxy::new(data_dir), enabled, port)
}

/// Тело `set_system_proxy` на любом менеджере (в тестах — с подставным бэкендом
/// ОС). Выключение всегда возвращает снимок: `kill switch` на него не влияет.
pub fn set_with<B: Backend>(
    sp: &SysProxy<B>,
    enabled: bool,
    port: u16,
) -> Result<SetOutcome, String> {
    if enabled {
        let applied = sp.enable("127.0.0.1", port)?;
        Ok(SetOutcome {
            endpoint: format!("{}:{}", applied.host, applied.port),
            warnings: applied.warnings,
        })
    } else {
        Ok(SetOutcome {
            endpoint: String::new(),
            warnings: sp.disable_report()?,
        })
    }
}

/// Выполнить `job` в пуле блокирующих потоков и дождаться результата, не
/// занимая вызывающий поток.
pub(super) async fn run_blocking<T, F>(job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| format!("системный прокси: рабочий поток не завершился: {e}"))?
}

/// `set_system_proxy` без блокировки вызывающего: тело в [`run_blocking`].
pub async fn set_blocking(
    data_dir: PathBuf,
    enabled: bool,
    port: u16,
) -> Result<SetOutcome, String> {
    run_blocking(move || set_now(&data_dir, enabled, port)).await
}
