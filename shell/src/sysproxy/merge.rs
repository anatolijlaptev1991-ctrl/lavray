// SPDX-License-Identifier: GPL-3.0-only

//! Трёхсторонний откат настроек прокси.

use serde_json::Value;

/// Трёхсторонний откат: запись возвращается к исходной, только если сейчас
/// она такая, какую поставили мы. Иначе её изменил пользователь или другая
/// программа, и она остаётся как есть (A2-05).
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
            let ours = applied.get(key) == current.get(key);
            let value = if ours {
                old.clone()
            } else {
                current.get(key).cloned().unwrap_or(Value::Null)
            };
            (key.clone(), value)
        })
        .collect();
    Value::Object(merged)
}
