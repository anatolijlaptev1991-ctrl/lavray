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
    let core = Path::new("binaries/lavray-core.exe");
    if !core.exists() {
        let _ = std::fs::create_dir_all("binaries");
        let _ = std::fs::write(core, b"#!/bin/sh\nexit 1\n");
    }
    // T-44: SHA-256 поставляемого ядра вшивается в оболочку, перед запуском
    // она сверяет с ним файл (shell/src/integrity.rs). Нет файла — пустая
    // строка, оболочка такое ядро не запустит.
    println!("cargo:rerun-if-changed={}", shipped.display());
    println!(
        "cargo:rustc-env=LAVRAY_CORE_SHA256={}",
        sha256_file(shipped).unwrap_or_default()
    );
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
