// SPDX-License-Identifier: GPL-3.0-only

//! Путь к установщику только внутри заданного каталога (T-75, `staging` и
//! `previous`). Страница присылает путь строкой, поэтому оболочка не верит ему:
//! каталог и файл канонизируются, ссылки, junction и точки повторной обработки
//! отвергаются, файл обязан лежать прямо в каталоге и называться
//! `<sha256 из 64 hex>-<имя>` без разделителей.

use std::io;
use std::path::{Path, PathBuf};

/// Почему путь отвергнут.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathError {
    /// Имя не вида `<sha256>-<имя>` или содержит недопустимые символы.
    BadName,
    /// Путь не прямой потомок каталога (или это ссылка).
    NotInside,
    /// Каталог не читается.
    Unreadable,
}

/// Узкий срез файловой системы: каноническая форма и признак ссылки.
pub trait FsProbe {
    fn canonicalize(&self, path: &Path) -> io::Result<PathBuf>;
    /// Символьная ссылка, junction или иная точка повторной обработки.
    fn is_link(&self, path: &Path) -> io::Result<bool>;
}

/// Атрибут `FILE_ATTRIBUTE_REPARSE_POINT`: симлинки и junction.
const REPARSE_POINT: u32 = 0x400;
/// Предел длины имени файла в Windows.
const MAX_NAME: usize = 255;

/// Атрибуты файла Windows говорят, что это точка повторной обработки.
#[must_use]
pub fn is_reparse_attr(attributes: u32) -> bool {
    attributes & REPARSE_POINT != 0
}

/// Разобрать `<64 hex>-<имя>`: вернуть (сумма, имя) или `None`.
#[must_use]
pub fn parse_staged_name(name: &str) -> Option<(&str, &str)> {
    if name.len() > MAX_NAME || !name.is_char_boundary(64) {
        return None;
    }
    let (sum, rest) = name.split_at(64);
    let file = rest.strip_prefix('-')?;
    let sum_ok = sum.bytes().all(|b| b.is_ascii_hexdigit());
    let bad_char = |c: char| c.is_control() || "\\/:*?\"<>|".contains(c);
    let file_ok = !file.is_empty()
        && !file.chars().any(bad_char)
        && !file.ends_with(['.', ' '])
        && file != "..";
    (sum_ok && file_ok).then_some((sum, file))
}

fn same_name(real: Option<&std::ffi::OsStr>, wanted: &str) -> bool {
    real.and_then(|n| n.to_str()).is_some_and(|n| {
        if cfg!(windows) {
            n.eq_ignore_ascii_case(wanted)
        } else {
            n == wanted
        }
    })
}

/// Проверить, что `candidate` — установщик прямо в `dir`. Возвращает путь для
/// запуска: `dir` + проверенное имя (не канонический, `ShellExecute` не любит
/// префикс `\?\`).
pub fn validate_in(
    probe: &dyn FsProbe,
    dir: &Path,
    candidate: &Path,
) -> Result<PathBuf, PathError> {
    use std::path::Component::{CurDir, ParentDir};
    if !candidate.is_absolute()
        || candidate
            .components()
            .any(|c| matches!(c, ParentDir | CurDir))
    {
        return Err(PathError::NotInside);
    }
    let name = candidate
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or(PathError::BadName)?;
    parse_staged_name(name).ok_or(PathError::BadName)?;
    let dir_real = probe.canonicalize(dir).map_err(|_| PathError::Unreadable)?;
    let links = |path: &Path| probe.is_link(path).map_err(|_| PathError::NotInside);
    if links(dir)? || links(candidate)? {
        return Err(PathError::NotInside);
    }
    let real = probe
        .canonicalize(candidate)
        .map_err(|_| PathError::NotInside)?;
    if real.parent() != Some(dir_real.as_path()) || !same_name(real.file_name(), name) {
        return Err(PathError::NotInside);
    }
    Ok(dir.join(name))
}

/// Настоящая файловая система.
pub struct RealFs;

impl FsProbe for RealFs {
    fn canonicalize(&self, path: &Path) -> io::Result<PathBuf> {
        std::fs::canonicalize(path)
    }

    fn is_link(&self, path: &Path) -> io::Result<bool> {
        std::fs::symlink_metadata(path).map(|meta| meta_is_link(&meta))
    }
}

#[cfg(windows)]
fn meta_is_link(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    is_reparse_attr(meta.file_attributes())
}

#[cfg(not(windows))]
fn meta_is_link(meta: &std::fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

#[cfg(test)]
mod tests;
