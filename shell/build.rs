// SPDX-License-Identifier: GPL-3.0-only

use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

// Правило check_core вынесено в файл, который подключает и тест
// (tests/build_guard.rs): сам build.rs тестами не запускается.
include!("build_guard.rs");

fn main() {
    // Ресурс `binaries/lavray-core.exe` объявлен в tauri.conf.json. В CI
    // (и на чистом клоне) ядро ещё не собрано — создаём заглушку, иначе
    // build-script падает с «resource path doesn't exist» и вся rust-джоба
    // красная (аудит №6 T11). Реальный бинарник подкладывает build.ps1/
    // build.sh/релизный workflow перед сборкой. T-57 (A2-24): в release
    // заглушка недопустима — сборка падает, если настоящего ядра нет.
    let on_windows = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "windows");
    let shipped = Path::new(if on_windows {
        "binaries/lavray-core.exe"
    } else {
        "binaries/lavray-core"
    });
    let release = std::env::var("PROFILE").is_ok_and(|profile| profile == "release");
    let size = std::fs::metadata(shipped).ok().map(|meta| meta.len());
    if let Err(message) = check_core(release, size) {
        panic!("{message}");
    }
    // Заглушка — по пути ресурса текущей платформы (раньше писалась в
    // binaries/lavray-core.exe и на Linux/macOS оставляла ресурс несуществующим).
    let mut stub = false;
    if !shipped.exists() {
        let _ = std::fs::create_dir_all("binaries");
        let _ = std::fs::write(shipped, b"#!/bin/sh\nexit 1\n");
        stub = true;
    }
    // T-44: SHA-256 поставляемого ядра вшивается в оболочку, перед запуском
    // она сверяет с ним файл (shell/src/integrity.rs).
    println!("cargo:rerun-if-changed={}", shipped.display());
    // Для заглушки хэш не вшивается: оболочка честно ответит «не вшит хэш
    // ядра», а не «доверенно» запустит 17-байтовую заглушку.
    println!(
        "cargo:rustc-env=LAVRAY_CORE_SHA256={}",
        if stub {
            String::new()
        } else {
            sha256_file(shipped).unwrap_or_default()
        }
    );
    // Имя приложения — по нему Tauri на Linux раскладывает ресурсы
    // (/usr/lib/<имя> и $APPDIR/usr/lib/<имя>); оболочка ищет ядро там
    // (shell/src/integrity.rs::core_search_paths). Платформенный конфиг
    // перекрывает базовый, как при слиянии у Tauri.
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let mut name = None;
    for file in ["tauri.conf.json", &format!("tauri.{os}.conf.json")] {
        if let Ok(text) = std::fs::read_to_string(Path::new(file)) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(product) = value.get("productName").and_then(|p| p.as_str()) {
                    name = Some(product.to_string());
                }
            }
        }
        println!("cargo:rerun-if-changed={file}");
    }
    let name = name.unwrap_or_else(|| env!("CARGO_PKG_NAME").to_string());
    println!("cargo:rustc-env=LAVRAY_PRODUCT_NAME={name}");
    tauri_build::build()
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            return Ok(format!("{:x}", hasher.finalize()));
        }
        hasher.update(&buf[..n]);
    }
}
