// SPDX-License-Identifier: GPL-3.0-only

//! WPAD (T-82): «Автоматическое определение настроек»
//! (`PROXY_TYPE_AUTO_DETECT`).
//!
//! Пока флаг включён, Windows может игнорировать ручной прокси, поэтому на
//! время сессии он снимается. Исходное значение лежит в снимке (`wpad` у LAN
//! и у каждой записи RAS) и возвращается тем же трёхсторонним откатом, что и
//! остальные настройки. Флаг LAN хранится в бинарном значении
//! `DefaultConnectionSettings`, а не в отдельной записи реестра, поэтому
//! читается и пишется через API подключений. Записи RAS ведёт `ras.rs`.

use super::conn::{ConnChange, Connections, AUTO_DETECT, AUTO_PROXY_URL, DIRECT, PROXY};
use super::values::{pac_present, proxy_enabled};
use serde_json::Value;

/// Был ли WPAD у LAN включён (по данным снимка; `null` — не прочитался).
fn is_on(data: &Value) -> bool {
    data.get("wpad").and_then(Value::as_bool) == Some(true)
}

/// Прочитать флаг у LAN.
pub(super) fn capture(conns: &impl Connections) -> Result<bool, String> {
    conns.get(None).map(|lan| lan.flags & AUTO_DETECT != 0)
}

/// Снять WPAD у LAN после записи ручного прокси. Флаги пишутся целиком:
/// чтение сразу после правки реестра могло бы отдать устаревший бит прокси, и
/// запись «прочитанное минус WPAD» выключила бы только что включённый прокси.
/// Возвращает предупреждение, если не вышло.
pub(super) fn apply(conns: &impl Connections, original: &Value) -> Option<String> {
    if !is_on(original) {
        return None;
    }
    let change = ConnChange {
        flags: Some(DIRECT | PROXY),
        ..ConnChange::default()
    };
    conns
        .set(None, &change)
        .err()
        .map(|e| format!("WPAD (LAN): {e}"))
}

/// Вернуть WPAD у LAN после отката реестра. Остальные биты считаются из того,
/// что откат только что записал в реестр (`target`), по той же причине, что и
/// в [`apply`]. Если флаг уже стоит (пользователь включил его сам), записи нет.
pub(super) fn restore(conns: &impl Connections, target: &Value) -> Option<String> {
    if !is_on(target) {
        return None;
    }
    if conns
        .get(None)
        .is_ok_and(|now| now.flags & AUTO_DETECT != 0)
    {
        return None;
    }
    let mut flags = DIRECT | AUTO_DETECT;
    if proxy_enabled(target) {
        flags |= PROXY;
    }
    if pac_present(target) {
        flags |= AUTO_PROXY_URL;
    }
    let change = ConnChange {
        flags: Some(flags),
        ..ConnChange::default()
    };
    conns
        .set(None, &change)
        .err()
        .map(|e| format!("WPAD (LAN): {e}"))
}
