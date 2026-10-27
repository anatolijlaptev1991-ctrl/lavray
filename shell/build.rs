use std::path::Path;

fn main() {
    // Ресурс `binaries/lavray-core.exe` объявлен в tauri.conf.json. В CI
    // (и на чистом клоне) ядро ещё не собрано — создаём заглушку, иначе
    // build-script падает с «resource path doesn't exist» и вся rust-джоба
    // красная (аудит №6 T11). Реальный бинарник подкладывает build.ps1/
    // build.sh/релизный workflow перед сборкой.
    let core = Path::new("binaries/lavray-core.exe");
    if !core.exists() {
        let _ = std::fs::create_dir_all("binaries");
        let _ = std::fs::write(core, b"#!/bin/sh\nexit 1\n");
    }
    tauri_build::build()
}
