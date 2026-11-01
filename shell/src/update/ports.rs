// SPDX-License-Identifier: GPL-3.0-only

//! Порты установки: всё, что трогает живое приложение и ОС, стоит за этими
//! трейтами. Настоящие реализации — `app_adapters.rs` и `real.rs`, в тестах —
//! подставки.

use super::error::ApplyError;
use super::verify::LockedFile;
use std::io;
use std::path::{Path, PathBuf};

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

/// Что ядро подтвердило об установщике: версия из подписанных заявлений и
/// SHA-256, посчитанный самим ядром.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignedFacts {
    pub version: String,
    pub sha256: String,
}

/// Проверка подписи minisign. В продакшене это ВСТРОЕННОЕ ядро из каталога
/// установки (`lavray-core verify-artifact`): оболочка подписи не разбирает и
/// сумме или версии от страницы не верит. Вызывается, пока оболочка держит
/// дескриптор файла с запретом записи.
pub trait SignatureVerifier {
    /// `allow_older` — откат: подписанная версия может быть не новее текущей.
    fn verify(
        &self,
        installer: &Path,
        signature: &Path,
        allow_older: bool,
    ) -> Result<SignedFacts, ApplyError>;
}
