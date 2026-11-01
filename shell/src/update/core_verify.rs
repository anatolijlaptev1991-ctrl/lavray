// SPDX-License-Identifier: GPL-3.0-only

//! Проверка подписи установщика встроенным ядром (T-75): оболочка не разбирает
//! minisign и не верит ни сумме, ни версии от страницы. Перед повышением прав
//! она запускает `lavray-core verify-artifact` — ТОЛЬКО то ядро, что лежит в
//! каталоге установки (не в staging и не в каталоге данных), — и принимает
//! установщик, если код выхода 0, а в stdout версия и сумма, совпадающие с
//! ожидаемой версией и с суммой, которую оболочка сама посчитала по дескриптору.
//!
//! Запуск процесса стоит за трейтом [`CoreRunner`]: тесты подменяют его.

use super::error::ApplyError;
use super::hash::parse_sha256_hex;
use super::ports::{SignatureVerifier, SignedFacts};
use super::watchdog_args::version_ok;
use serde::Deserialize;
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Предел ожидания ответа ядра: хэш установщика считается секунды.
pub const VERIFY_TIMEOUT: Duration = Duration::from_secs(120);

/// Итог запущенного процесса.
pub struct RunOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
}

/// Запуск внешней программы с ожиданием; в тестах — подставка.
pub trait CoreRunner {
    fn run(&self, exe: &Path, args: &[OsString]) -> io::Result<RunOutput>;
}

/// Каталоги установки, где может лежать встроенное ядро, относительно exe
/// приложения. Только рядом с ним: ни staging, ни каталог данных сюда не входят.
pub fn bundled_core_candidates(app_exe: &Path) -> Vec<PathBuf> {
    let name = if cfg!(windows) {
        "lavray-core.exe"
    } else {
        "lavray-core"
    };
    let dir = app_exe.parent().unwrap_or_else(|| Path::new(""));
    vec![
        dir.join("binaries").join(name),
        dir.join("resources").join("binaries").join(name),
        dir.join("resources").join(name),
    ]
}

/// Встроенное ядро. `pin` — SHA-256, вшитый при сборке оболочки (T-44): подменённое
/// ядро не запускается. Watchdog работает из копии СТАРОГО exe, а ядро в каталоге
/// установки уже новое, поэтому ему сумму сверять нечем (`None`): каталог
/// установки per-machine доступен на запись только администратору.
pub fn bundled_core(app_exe: &Path, pin: Option<&str>) -> Result<PathBuf, ApplyError> {
    let candidates = bundled_core_candidates(app_exe);
    match pin {
        Some(sum) => crate::integrity::find_trusted_core(&candidates, sum),
        None => candidates
            .into_iter()
            .find(|p| p.is_file())
            .ok_or_else(|| "ядро не найдено".to_string()),
    }
    .map_err(|_| ApplyError::CoreUnavailable)
}

/// Проверка подписи через встроенное ядро.
pub struct CoreVerifier {
    core: PathBuf,
    data_dir: PathBuf,
    runner: Box<dyn CoreRunner>,
}

impl CoreVerifier {
    pub fn new(core: PathBuf, data_dir: PathBuf, runner: Box<dyn CoreRunner>) -> Self {
        Self {
            core,
            data_dir,
            runner,
        }
    }

    /// Настоящее: встроенное ядро рядом с `app_exe`, процесс без окна.
    pub fn bundled(app_exe: &Path, pin: Option<&str>, data_dir: &Path) -> Result<Self, ApplyError> {
        let core = bundled_core(app_exe, pin)?;
        Ok(Self::new(
            core,
            data_dir.to_path_buf(),
            Box::new(super::real::ProcessRunner),
        ))
    }
}

/// Встроенного ядра нет: подпись проверить нечем, любой установщик отвергается.
pub struct MissingCore;

impl SignatureVerifier for MissingCore {
    fn verify(&self, _: &Path, _: &Path, _: bool) -> Result<SignedFacts, ApplyError> {
        Err(ApplyError::CoreUnavailable)
    }
}

/// Аргументы `verify-artifact`; `--allow-older` только для отката.
pub fn verify_args(
    installer: &Path,
    signature: &Path,
    data_dir: &Path,
    allow_older: bool,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["verify-artifact".into()];
    for (flag, value) in [
        ("--file", installer),
        ("--sig", signature),
        ("--data", data_dir),
    ] {
        args.push(flag.into());
        args.push(value.as_os_str().to_os_string());
    }
    if allow_older {
        args.push("--allow-older".into());
    }
    args
}

#[derive(Deserialize)]
struct Reply {
    version: String,
    sha256: String,
}

/// Разбор ответа ядра: любой сбой (код выхода, JSON, форма версии и суммы) —
/// «подпись не подтверждена».
pub fn interpret(output: &RunOutput) -> Result<SignedFacts, ApplyError> {
    if !output.success {
        return Err(ApplyError::SignatureInvalid);
    }
    let reply: Reply =
        serde_json::from_slice(&output.stdout).map_err(|_| ApplyError::SignatureInvalid)?;
    if !version_ok(&reply.version) || parse_sha256_hex(&reply.sha256).is_none() {
        return Err(ApplyError::SignatureInvalid);
    }
    Ok(SignedFacts {
        version: reply.version,
        sha256: reply.sha256,
    })
}

impl SignatureVerifier for CoreVerifier {
    fn verify(
        &self,
        installer: &Path,
        signature: &Path,
        allow_older: bool,
    ) -> Result<SignedFacts, ApplyError> {
        let args = verify_args(installer, signature, &self.data_dir, allow_older);
        let output = self
            .runner
            .run(&self.core, &args)
            .map_err(|_| ApplyError::CoreUnavailable)?;
        interpret(&output)
    }
}

#[cfg(test)]
mod tests;
