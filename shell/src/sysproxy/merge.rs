// SPDX-License-Identifier: GPL-3.0-only

//! Трёхсторонний откат настроек прокси.

use serde_json::Value;

/// Трёхсторонний откат: запись возвращается к исходной, только если сейчас
/// она такая, какую поставили мы. Иначе её изменил пользователь или другая
/// программа, и она остаётся как есть (A2-05).
///
/// Записи подключений RAS (`ras`) сливаются по одной, а внутри записи — по
/// слотам тем же правилом (T-82): правка пользователем одного подключения не
/// мешает вернуть остальные.
pub(super) fn three_way(original: &Value, applied: &Value, current: &Value) -> Value {
    let (Some(original), Some(applied), Some(current)) = (
        original.as_object(),
        applied.as_object(),
        current.as_object(),
    ) else {
        return original.clone();
    };
    let merged = original
        .iter()
        .map(|(key, old)| {
            let (ours, now) = (applied.get(key), current.get(key));
            let value = if key == "ras" {
                merge_ras(old, ours, now)
            } else if ours == now {
                old.clone()
            } else {
                now.cloned().unwrap_or(Value::Null)
            };
            (key.clone(), value)
        })
        .collect();
    Value::Object(merged)
}

/// Слияние записей RAS. Нет данных для сравнения — записи нет в `applied`,
/// она не читается (`null`) или список `current` не перечислился — запись
/// возвращается безусловно: оставить подключение с нашим прокси хуже. Запись,
/// пропавшая из списка (подключение удалили), не восстанавливается.
fn merge_ras(original: &Value, applied: Option<&Value>, current: Option<&Value>) -> Value {
    let Some(entries) = original.as_object() else {
        return original.clone();
    };
    let listed = current.and_then(Value::as_object);
    let merged = entries
        .iter()
        .filter_map(|(name, old)| {
            let ours = applied.and_then(|a| a.get(name));
            let value = match (ours, listed.map(|list| list.get(name))) {
                (_, Some(None)) => return None,
                (Some(ours), Some(Some(now))) => three_way(old, ours, now),
                _ => old.clone(),
            };
            Some((name.clone(), value))
        })
        .collect();
    Value::Object(merged)
}
