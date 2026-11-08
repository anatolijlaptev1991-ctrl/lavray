// SPDX-License-Identifier: GPL-3.0-only

//! Читатель каталога `conformance/` (корень репозитория): нейтральные тестовые
//! данные, общие для Go и Rust. Крейт разбирает `manifest.json` и проверяет, что
//! каждый перечисленный файл существует, имеет заявленный размер и sha256.
//! Форматы и правила пересборки — в `conformance/README.md`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// Файл каталога: путь от корня репозитория, размер, sha256 (hex).
#[derive(Debug, Deserialize)]
pub struct Entry {
    /// Путь от корня репозитория, разделитель `/`.
    pub path: String,
    /// Размер в байтах.
    pub size: u64,
    /// sha256 содержимого, строчный hex.
    pub sha256: String,
}

/// Именованная группа файлов.
#[derive(Debug, Deserialize)]
pub struct Category {
    /// Что за файлы.
    pub description: String,
    /// Файлы группы.
    pub files: Vec<Entry>,
}

/// Содержимое `conformance/manifest.json`.
#[derive(Debug, Deserialize)]
pub struct Manifest {
    /// Версия схемы manifest.
    pub schema: u32,
    /// Категории по имени.
    pub categories: BTreeMap<String, Category>,
}

/// Корень репозитория: три уровня вверх от `rust/crates/lavray-conformance`.
pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

/// Читает и разбирает `conformance/manifest.json`.
pub fn load_manifest(root: &Path) -> Result<Manifest, String> {
    let path = root.join("conformance/manifest.json");
    let raw = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_slice(&raw).map_err(|e| format!("{}: {e}", path.display()))
}

/// Сверяет один файл с записью; `Err` — человекочитаемое расхождение.
pub fn verify_entry(root: &Path, entry: &Entry) -> Result<(), String> {
    let path = root.join(&entry.path);
    let data = fs::read(&path).map_err(|e| format!("{}: {e}", entry.path))?;
    if data.len() as u64 != entry.size {
        return Err(format!(
            "{}: размер {} != {}",
            entry.path,
            data.len(),
            entry.size
        ));
    }
    let sum = hex(&Sha256::digest(&data));
    if sum != entry.sha256 {
        return Err(format!("{}: sha256 {sum} != {}", entry.path, entry.sha256));
    }
    Ok(())
}

/// Сверяет все файлы manifest; возвращает список расхождений.
pub fn verify_all(root: &Path, manifest: &Manifest) -> Vec<String> {
    manifest
        .categories
        .values()
        .flat_map(|c| c.files.iter())
        .filter_map(|e| verify_entry(root, e).err())
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_is_lowercase_pairs() {
        assert_eq!(hex(&[0x00, 0xab, 0x0f]), "00ab0f");
    }

    #[test]
    fn missing_file_is_reported() {
        let entry = Entry {
            path: "conformance/нет-такого".into(),
            size: 0,
            sha256: String::new(),
        };
        assert!(verify_entry(&repo_root(), &entry).is_err());
    }
}
