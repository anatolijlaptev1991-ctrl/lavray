// SPDX-License-Identifier: GPL-3.0-only

//! Сборка конфигурации sing-box из профилей, пресетов и настроек.
//!
//! Сюда переедет Go-пакет `core/internal/cfgbuild`; результат сверяется с
//! golden-файлами из `conformance/` побайтно. Пока крейт пуст.

/// Имя крейта; единственный символ заготовки.
pub const CRATE_NAME: &str = "lavray-cfgbuild";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
