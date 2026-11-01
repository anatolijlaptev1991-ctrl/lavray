// SPDX-License-Identifier: GPL-3.0-only

//! Порядок установки (T-75), зафиксированный тестом
//! `apply_order_stop_core_release_proxy_then_launch`:
//! 1) `verify_locked` — пока ничего не остановлено; 2) остановить ядро;
//! 3) снять системный прокси; 4) запустить установщик с повышением.
//!
//! Копии для watchdog и отката делаются ДО остановки ядра: тяжёлый ввод-вывод не
//! должен идти, пока VPN выключен.
//!
//! Сбой после остановки ядра компенсируется перезапуском ядра: отказ в UAC —
//! не ошибка, а исход [`ApplyOutcome::UacCancelled`] (UI возвращается к «готово»).
//! Не компенсируется только сам сбой остановки: состояние ядра неизвестно.

use super::error::{ApplyError, ApplyOutcome};
pub use super::gate::{ApplyGate, GateGuard};
use super::install::{launch_installer, ElevateError, ElevatedHandle, Elevator};
use super::layout::Layout;
use super::paths::FsProbe;
pub use super::ports::{
    CoreController, ProxyReleaser, SignatureVerifier, WatchdogCopy, WatchdogLauncher,
};
use super::previous::{PreviousInfo, RollbackArchive};
use super::verify::{open_verified, verify_signed, LockedOpener};
use super::watchdog_args::version_ok;
use std::path::Path;

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
    pub signature: &'a dyn SignatureVerifier,
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

/// Установка под замком: вторая параллельная получает `busy`. Установщик
/// запущен — замок остаётся занятым до выхода процесса (приложение вот-вот
/// закроется, второй `update_apply` в это окно не должен пройти); отказ в UAC и
/// сбои замок отпускают.
pub fn apply_guarded(
    gate: &ApplyGate,
    deps: &ApplyDeps<'_>,
    request: &ApplyRequest<'_>,
) -> Result<ApplyOutcome, ApplyError> {
    let held = gate.try_enter()?;
    let outcome = apply(deps, request)?;
    if outcome == ApplyOutcome::Installing {
        held.keep();
    }
    Ok(outcome)
}

/// Исход шагов «остановить, снять прокси, запустить».
enum Launched {
    Started(ElevatedHandle),
    Cancelled,
}

fn apply(deps: &ApplyDeps<'_>, req: &ApplyRequest<'_>) -> Result<ApplyOutcome, ApplyError> {
    if !version_ok(req.version) {
        return Err(ApplyError::InvalidVersion);
    }
    let dir = match req.mode {
        Mode::Update => req.layout.staging(),
        Mode::Rollback => req.layout.previous_dir(),
    };
    let locked = open_verified(deps.fs, deps.opener, &dir, req.candidate, req.sha256)?;
    // подпись проверяется, пока дескриптор держит файл: между проверкой и
    // запуском с повышением подменить его нельзя; откат принимает и старую версию
    verify_signed(
        deps.signature,
        &locked,
        req.version,
        req.mode == Mode::Rollback,
    )?;
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
    if handle.pid == 0 {
        eprintln!("LAVRay: pid установщика неизвестен, watchdog обновления не запущен");
    } else if let Err(e) = deps.watchdog.spawn(copy, handle.pid, req.version) {
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
