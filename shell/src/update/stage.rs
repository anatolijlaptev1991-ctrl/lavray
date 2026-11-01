// SPDX-License-Identifier: GPL-3.0-only

//! `stage_local` (T-75, вызывает `update_pick_installer`): установщик, выбранный пользователем («Из
//! файла»), копируется в `<data>/updates/staging` под именем `<sha256>-<имя>`.
//! Хэш считается потоково при копировании; дальше ядро проверяет подпись
//! (`VerifyLocalUpdate`), а `update_apply` под блокировкой проверяет подпись через `lavray-core verify-artifact`.
//! Путь приходит от страницы, поэтому берутся только абсолютные пути обычных
//! файлов (не UNC и не устройства), а имя очищается до безопасного.

use super::hash::to_hex;
use super::layout::Layout;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

/// Предел размера установщика (как для скачивания в ядре).
pub const MAX_INSTALLER_BYTES: u64 = 512 * 1024 * 1024;
/// Сколько символов имени сохраняется (с конца: расширение важнее начала).
const MAX_NAME: usize = 100;
/// Размер блока копирования.
const CHUNK: usize = 64 * 1024;

/// Результат `stage_local`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StagedFile {
    pub staged_path: String,
    pub sha256: String,
}

/// Почему копирование не состоялось.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StageError {
    /// Путь не абсолютный, не файл или недопустим.
    InvalidSource,
    /// Файл больше предела.
    TooLarge,
    /// Ошибка ввода-вывода.
    Io,
}

impl StageError {
    /// Код для UI.
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidSource => "invalid_source",
            Self::TooLarge => "too_large",
            Self::Io => "stage_failed",
        }
    }
}

/// Имя файла без разделителей и опасных символов; `None` — ничего не осталось.
pub fn sanitize_name(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('.');
    let skip = trimmed.chars().count().saturating_sub(MAX_NAME);
    let name: String = trimmed.chars().skip(skip).collect();
    (!name.is_empty()).then_some(name)
}

/// Копирование с подсчётом SHA-256; больше `max` байт — прерывание.
fn copy_hashing(
    reader: &mut impl Read,
    writer: &mut impl Write,
    max: u64,
) -> Result<[u8; 32], StageError> {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    let mut total = 0u64;
    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(StageError::Io),
        };
        total += n as u64;
        if total > max {
            return Err(StageError::TooLarge);
        }
        hasher.update(&buf[..n]);
        writer.write_all(&buf[..n]).map_err(|_| StageError::Io)?;
    }
    Ok(hasher.finalize().into())
}

/// Обычный файл по абсолютному пути (не UNC и не устройство), не больше `max`.
fn check_source(source: &Path, max: u64) -> Result<(), StageError> {
    let device_or_unc = source.to_string_lossy().starts_with("\\\\");
    if !source.is_absolute() || device_or_unc {
        return Err(StageError::InvalidSource);
    }
    let meta = std::fs::metadata(source).map_err(|_| StageError::InvalidSource)?;
    if !meta.is_file() {
        return Err(StageError::InvalidSource);
    }
    if meta.len() > max {
        return Err(StageError::TooLarge);
    }
    Ok(())
}

/// Скопировать `source` во временный `.part` и вернуть сумму.
fn write_part(source: &Path, part: &Path, max: u64) -> Result<[u8; 32], StageError> {
    let mut input = std::fs::File::open(source).map_err(|_| StageError::Io)?;
    let mut output = std::fs::File::create_new(part).map_err(|_| StageError::Io)?;
    let sum = copy_hashing(&mut input, &mut output, max)?;
    output.sync_all().map_err(|_| StageError::Io)?;
    Ok(sum)
}

/// Предел размера файла подписи minisign рядом с установщиком.
const MAX_SIGNATURE_BYTES: u64 = 4096;

/// Подпись `<источник>.minisig`, если лежит рядом, копируется как
/// `<установщик>.minisig`: ядро проверит по ней файл без сети. Подписи нет или
/// она не читается — молча пропускаем (ядро сошлётся на манифест).
fn copy_signature(source: &Path, target: &Path) {
    let sibling = |p: &Path| {
        let mut name = p.as_os_str().to_os_string();
        name.push(".minisig");
        PathBuf::from(name)
    };
    let from = sibling(source);
    let small =
        std::fs::metadata(&from).is_ok_and(|m| m.is_file() && m.len() <= MAX_SIGNATURE_BYTES);
    if small {
        let _ = std::fs::copy(&from, sibling(target));
    }
}

/// Положить выбранный установщик в staging и вернуть путь и сумму.
pub fn stage_local(layout: &Layout, source: &Path, max: u64) -> Result<StagedFile, StageError> {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    check_source(source, max)?;
    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(sanitize_name)
        .ok_or(StageError::InvalidSource)?;
    let staging = layout.staging();
    std::fs::create_dir_all(&staging).map_err(|_| StageError::Io)?;
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let part = staging.join(format!(".stage-{}-{n}.part", std::process::id()));
    let result = write_part(source, &part, max).and_then(|sum| {
        let sha256 = to_hex(&sum);
        let target: PathBuf = staging.join(format!("{sha256}-{name}"));
        std::fs::rename(&part, &target).map_err(|_| StageError::Io)?;
        copy_signature(source, &target);
        Ok(StagedFile {
            staged_path: target.to_string_lossy().into_owned(),
            sha256,
        })
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    result
}

#[cfg(test)]
mod tests;
