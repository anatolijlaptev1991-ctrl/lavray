// SPDX-License-Identifier: GPL-3.0-only

//! Запуск и надзор за дочерним процессом ядра: жизненный цикл, backoff, пайп логов.
//!
//! Общий код вынесут из `shell/src/coreproc` (оболочка Tauri) и из Go-пакетов
//! запуска движка, когда появится Rust-супервизор. Пока крейт пуст.

/// Имя крейта; единственный символ заготовки.
pub const CRATE_NAME: &str = "lavray-proc";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
