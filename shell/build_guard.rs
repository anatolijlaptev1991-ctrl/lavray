// SPDX-License-Identifier: GPL-3.0-only

// Правило «с каким ядром можно собирать оболочку». Подключается через include!
// в build.rs и в tests/build_guard.rs: сам build.rs тестами не запускается.

/// Меньше этого размера файл не может быть sing-box: заглушка build.rs — 17
/// байт, настоящее ядро — десятки МиБ.
const MIN_REAL_CORE_BYTES: u64 = 1 << 20;

/// Можно ли собирать оболочку с таким ядром. Release с заглушкой даёт
/// установщик, где «Подключиться» не работает (A2-24), поэтому сборка падает.
fn check_core(release: bool, size: Option<u64>) -> Result<(), String> {
    if !release || size.is_some_and(|n| n >= MIN_REAL_CORE_BYTES) {
        return Ok(());
    }
    let found = size.map_or_else(|| "файла нет".to_string(), |n| format!("{n} Б"));
    Err(format!(
        "release-сборка без настоящего ядра ({found}): соберите lavray-core в shell/binaries \
         до `cargo tauri build` (shell/build.ps1 или build.sh; теги ядра — core/BUILD_TAGS)"
    ))
}
