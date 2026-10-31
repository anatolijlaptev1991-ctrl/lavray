// SPDX-License-Identifier: GPL-3.0-only

//! `verify_locked` (T-75): повторная проверка установщика прямо перед запуском
//! с защитой от TOCTOU. Файл открывается с запретом записи и удаления
//! (`FILE_SHARE_READ` на Windows), SHA-256 считается по ТОМУ ЖЕ дескриптору, а
//! дескриптор остаётся в возвращённом [`LockedInstaller`] до запуска: пока он
//! жив, подменить байт в файле нельзя.

use super::error::ApplyError;
use super::hash::{ct_eq, parse_sha256_hex, sha256_reader, to_hex};
use super::paths::{validate_in, FsProbe};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

/// Открытый дескриптор, из которого читают и который держат до запуска.
pub trait LockedFile: Read {}

impl<T: Read> LockedFile for T {}

/// Открытие файла с запретом записи для остальных.
pub trait LockedOpener {
    fn open_locked(&self, path: &Path) -> io::Result<Box<dyn LockedFile>>;
}

/// Проверенный установщик: дескриптор держит файл неизменным.
pub struct LockedInstaller {
    path: PathBuf,
    sha256: String,
    _handle: Box<dyn LockedFile>,
}

impl LockedInstaller {
    /// Путь для запуска.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Проверенная сумма, строчный hex.
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

/// Открыть `path` с блокировкой, посчитать SHA-256 по тому же дескриптору и
/// сравнить с `expected_hex` за постоянное время.
pub fn verify_locked(
    opener: &dyn LockedOpener,
    path: &Path,
    expected_hex: &str,
) -> Result<LockedInstaller, ApplyError> {
    let expected = parse_sha256_hex(expected_hex).ok_or(ApplyError::InvalidSha256)?;
    let mut handle = opener.open_locked(path).map_err(|_| ApplyError::Locked)?;
    let actual = sha256_reader(&mut handle).map_err(|_| ApplyError::Locked)?;
    if !ct_eq(&actual, &expected) {
        return Err(ApplyError::Sha256Mismatch);
    }
    Ok(LockedInstaller {
        path: path.to_path_buf(),
        sha256: to_hex(&actual),
        _handle: handle,
    })
}

/// Путь внутри `dir` (staging или previous), затем [`verify_locked`].
pub fn open_verified(
    fs: &dyn FsProbe,
    opener: &dyn LockedOpener,
    dir: &Path,
    candidate: &Path,
    expected_hex: &str,
) -> Result<LockedInstaller, ApplyError> {
    parse_sha256_hex(expected_hex).ok_or(ApplyError::InvalidSha256)?;
    let path = validate_in(fs, dir, candidate).map_err(|_| ApplyError::PathOutsideStaging)?;
    verify_locked(opener, &path, expected_hex)
}

/// Настоящее открытие: на Windows — с `FILE_SHARE_READ`, остальные ОС не
/// умеют обязательных блокировок, там обычное чтение.
pub struct RealOpener;

impl LockedOpener for RealOpener {
    fn open_locked(&self, path: &Path) -> io::Result<Box<dyn LockedFile>> {
        open_shared_read(path).map(|file| Box::new(file) as Box<dyn LockedFile>)
    }
}

#[cfg(windows)]
fn open_shared_read(path: &Path) -> io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    /// `FILE_SHARE_READ`: другим можно читать, писать и удалять — нельзя.
    const FILE_SHARE_READ: u32 = 0x1;
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
}

#[cfg(not(windows))]
fn open_shared_read(path: &Path) -> io::Result<std::fs::File> {
    std::fs::File::open(path)
}

#[cfg(test)]
mod tests;
