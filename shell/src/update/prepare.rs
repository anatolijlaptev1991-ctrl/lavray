// SPDX-License-Identifier: GPL-3.0-only

//! Порядок установки (T-75), зафиксированный тестом
//! `apply_order_stop_core_release_proxy_then_launch`:
//! 1) `verify_locked` — пока ничего не остановлено; 2) остановить ядро;
//! 3) снять системный прокси; 4) запустить установщик с повышением.
//! Копии для watchdog и отката делаются ДО остановки ядра: тяжёлый ввод-вывод не
//! должен идти, пока VPN выключен.
//!
//! Сбой после остановки ядра компенсируется перезапуском ядра: отказ в UAC —
//! не ошибка, а исход [`ApplyOutcome::UacCancelled`] (UI возвращается к «готово»).
//! Не компенсируется только сам сбой остановки: состояние ядра неизвестно.

use super::error::{ApplyError, ApplyOutcome};
use super::install::{launch_installer, ElevateError, ElevatedHandle, Elevator};
use super::layout::Layout;
use super::paths::FsProbe;
use super::previous::{PreviousInfo, RollbackArchive};
use super::verify::{open_verified, LockedFile, LockedOpener};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Остановка и повторный запуск ядра.
pub trait CoreController {
    /// Остановить ядро и дождаться выхода.
    fn stop(&self) -> Result<(), String>;
    /// Вернуть ядро после неудачной установки.
    fn restart(&self);
}

/// Снятие системного прокси (возврат снимка настроек).
pub trait ProxyReleaser {
    fn release(&self) -> Result<(), String>;
}

/// Копия exe для режима watchdog; дескриптор держит её от подмены до запуска.
pub struct WatchdogCopy {
    pub path: PathBuf,
    pub hold: Box<dyn LockedFile>,
}

/// Подготовка и запуск watchdog.
pub trait WatchdogLauncher {
    /// Скопировать собственный exe в безопасное место.
    fn stage_copy(&self) -> io::Result<WatchdogCopy>;
    /// Запустить копию: ждать установщик `installer_pid`, ожидать heartbeat `version`.
    fn spawn(&self, copy: &WatchdogCopy, installer_pid: u32, version: &str) -> io::Result<()>;
}

/// Что ставим.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Обновление: установщик из `staging`.
    Update,
    /// Откат: прошлый установщик из `previous`.
    Rollback,
}

/// Всё, на что опирается установка; настоящее или подставное.
pub struct ApplyDeps<'a> {
    pub fs: &'a dyn FsProbe,
    pub opener: &'a dyn LockedOpener,
    pub core: &'a dyn CoreController,
    pub proxy: &'a dyn ProxyReleaser,
    pub elevator: &'a dyn Elevator,
    pub archive: &'a dyn RollbackArchive,
    pub watchdog: &'a dyn WatchdogLauncher,
}

/// Запрос на установку.
pub struct ApplyRequest<'a> {
    pub layout: &'a Layout,
    pub mode: Mode,
    pub candidate: &'a Path,
    pub sha256: &'a str,
    pub version: &'a str,
}

/// Замок «установка уже идёт».
#[derive(Default)]
pub struct ApplyGate(AtomicBool);

/// Замок удерживается, пока жив этот объект.
pub struct GateGuard<'a>(&'a AtomicBool);

impl ApplyGate {
    /// Занять замок или вернуть [`ApplyError::Busy`].
    pub fn try_enter(&self) -> Result<GateGuard<'_>, ApplyError> {
        match self
            .0
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        {
            Ok(_) => Ok(GateGuard(&self.0)),
            Err(_) => Err(ApplyError::Busy),
        }
    }
}

impl Drop for GateGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Установка под замком: вторая параллельная получает `busy`.
pub fn apply_guarded(
    gate: &ApplyGate,
    deps: &ApplyDeps<'_>,
    request: &ApplyRequest<'_>,
) -> Result<ApplyOutcome, ApplyError> {
    let _held = gate.try_enter()?;
    apply(deps, request)
}

/// Исход шагов «остановить, снять прокси, запустить».
enum Launched {
    Started(ElevatedHandle),
    Cancelled,
}

fn apply(deps: &ApplyDeps<'_>, req: &ApplyRequest<'_>) -> Result<ApplyOutcome, ApplyError> {
    let dir = match req.mode {
        Mode::Update => req.layout.staging(),
        Mode::Rollback => req.layout.previous_dir(),
    };
    let locked = open_verified(deps.fs, deps.opener, &dir, req.candidate, req.sha256)?;
    let meta = PreviousInfo {
        version: req.version.to_string(),
        sha256: locked.sha256().to_string(),
        file: file_name(locked.path()),
    };
    let copy = prepare_copies(deps, req.mode, locked.path(), &meta)?;
    let launched = stop_and_launch(deps, locked.path());
    drop(locked); // дескриптор держали ровно до запуска
    match launched {
        Ok(Launched::Started(handle)) => {
            after_launch(deps, req, &copy, &meta, handle);
            Ok(ApplyOutcome::Installing)
        }
        Ok(Launched::Cancelled) => {
            deps.archive.discard();
            Ok(ApplyOutcome::UacCancelled)
        }
        Err(error) => {
            deps.archive.discard();
            Err(error)
        }
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Копия exe для watchdog и (при обновлении) копия установщика для отката.
fn prepare_copies(
    deps: &ApplyDeps<'_>,
    mode: Mode,
    installer: &Path,
    meta: &PreviousInfo,
) -> Result<WatchdogCopy, ApplyError> {
    let copy = deps
        .watchdog
        .stage_copy()
        .map_err(|_| ApplyError::PrepareFailed)?;
    if mode == Mode::Update {
        deps.archive.stage(installer, meta).map_err(|_| {
            deps.archive.discard();
            ApplyError::PrepareFailed
        })?;
    }
    Ok(copy)
}

/// Шаги 2–4. После остановки ядра любой сбой возвращает ядро.
fn stop_and_launch(deps: &ApplyDeps<'_>, installer: &Path) -> Result<Launched, ApplyError> {
    deps.core.stop().map_err(|_| ApplyError::CoreStopFailed)?;
    if deps.proxy.release().is_err() {
        deps.core.restart();
        return Err(ApplyError::ProxyReleaseFailed);
    }
    match launch_installer(deps.elevator, installer) {
        Ok(handle) => Ok(Launched::Started(handle)),
        Err(ElevateError::UacCancelled) => {
            deps.core.restart();
            Ok(Launched::Cancelled)
        }
        Err(ElevateError::Failed(_)) => {
            deps.core.restart();
            Err(ApplyError::LaunchFailed)
        }
    }
}

/// Установщик уже работает: назад пути нет, сбои только в журнал. Watchdog
/// стартует первым — приложение вот-вот закроет сам установщик.
fn after_launch(
    deps: &ApplyDeps<'_>,
    req: &ApplyRequest<'_>,
    copy: &WatchdogCopy,
    meta: &PreviousInfo,
    handle: ElevatedHandle,
) {
    if let Err(e) = deps.watchdog.spawn(copy, handle.pid, req.version) {
        eprintln!("LAVRay: watchdog обновления не запущен: {e}");
    }
    let committed = match req.mode {
        Mode::Update => deps.archive.commit_update(meta),
        Mode::Rollback => deps.archive.commit_rollback(),
    };
    if let Err(e) = committed {
        eprintln!("LAVRay: не удалось обновить хранилище отката: {e}");
    }
}

#[cfg(test)]
mod tests;
