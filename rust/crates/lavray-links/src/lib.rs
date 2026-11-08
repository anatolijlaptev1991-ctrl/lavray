// SPDX-License-Identifier: GPL-3.0-only

//! Разбор и сборка ссылок профилей (`vless://`, `vmess://`, `ss://` и др.).
//!
//! Сюда переедет Go-пакет `core/internal/links`; корпус фаззинга лежит в
//! `conformance/` и читается и Go-, и Rust-тестами. Пока крейт пуст.

/// Имя крейта; единственный символ заготовки.
pub const CRATE_NAME: &str = "lavray-links";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
