// SPDX-License-Identifier: GPL-3.0-only

//! Модель данных LAVRay: профили, группы, маршрутизация, настройки.
//!
//! Сюда переедет Go-пакет `core/internal/model` (включая канонический JSON
//! `canonjson`). Пока крейт пуст: это заготовка рабочего пространства R0.

/// Имя крейта; единственный символ заготовки.
pub const CRATE_NAME: &str = "lavray-model";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn crate_name_matches_package() {
        assert_eq!(CRATE_NAME, env!("CARGO_PKG_NAME"));
    }
}
