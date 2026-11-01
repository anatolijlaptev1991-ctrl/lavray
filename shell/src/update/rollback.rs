// SPDX-License-Identifier: GPL-3.0-only

//! Откат прошлым установщиком из watchdog (T-75): достать описание из
//! `previous/previous.json`, повторно проверить файл (`verify_locked`) и запустить
//! `/S` с повышением. Ядро и прокси здесь не трогаются: приложение, которое
//! не отметилось здоровьем, остановит сам установщик.

use super::error::ApplyError;
use super::install::{launch_installer, ElevateError, Elevator};
use super::layout::Layout;
use super::paths::FsProbe;
use super::ports::SignatureVerifier;
use super::previous::{installer_path, PreviousStore, RollbackArchive};
use super::verify::{open_verified, verify_signed, LockedOpener};
use super::watchdog::{RollbackResult, RollbackStep};

/// Откат поверх хранилища прошлого установщика.
pub struct PreviousRollback<'a> {
    pub layout: &'a Layout,
    pub store: &'a PreviousStore,
    pub fs: &'a dyn FsProbe,
    pub opener: &'a dyn LockedOpener, // RealOpener::within(previous): файл физически в каталоге
    pub elevator: &'a dyn Elevator,
    pub signature: &'a dyn SignatureVerifier,
}

impl RollbackStep for PreviousRollback<'_> {
    fn run(&self) -> RollbackResult {
        let Some(info) = self.store.available() else {
            return RollbackResult::Unavailable;
        };
        let candidate = installer_path(self.layout, &info);
        let dir = self.layout.previous_dir();
        let locked = match open_verified(self.fs, self.opener, &dir, &candidate, &info.sha256) {
            Ok(locked) => locked,
            Err(error) => return RollbackResult::Failed(error.code().to_string()),
        };
        // описание отката лежит в каталоге, доступном пользователю: верить можно
        // только подписи прошлого установщика (проверка под тем же дескриптором)
        if let Err(error) = verify_signed(self.signature, &locked, &info.version, true) {
            return RollbackResult::Failed(error.code().to_string());
        }
        let launched = launch_installer(self.elevator, locked.path());
        drop(locked);
        match launched {
            Ok(handle) => {
                // установщик уже работает: сбой хранилища только в журнал
                if let Err(e) = self.store.commit_rollback() {
                    eprintln!("LAVRay: хранилище отката не обновлено: {e}");
                }
                RollbackResult::Started(handle.pid)
            }
            Err(ElevateError::UacCancelled) => RollbackResult::UacCancelled,
            Err(ElevateError::SharingViolation) => {
                RollbackResult::Failed(ApplyError::InstallerLocked.code().to_string())
            }
            Err(ElevateError::Failed(_)) => {
                RollbackResult::Failed(ApplyError::LaunchFailed.code().to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests;
