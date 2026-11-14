// SPDX-License-Identifier: GPL-3.0-only

//! GNOME: чистая часть системного прокси — какие ключи `gsettings` и с какими
//! значениями ставить, как собрать из них снимок и вернуть обратно. Сами вызовы
//! `gsettings` — в `linux.rs`; здесь ничего не запускается, поэтому тесты идут и
//! на Windows.
//!
//! Схемы GNOME раздельные: `mode` и `ignore-hosts` лежат в
//! `org.gnome.system.proxy`, а адрес и порт — в дочерних схемах `….http` и
//! `….https` (ключи `host`, `port`). Ключа «http.host» в схеме нет.

use super::ProxySnapshot;
use serde_json::{json, Map, Value};

#[cfg(test)]
mod tests;

/// Схема с режимом и списком исключений.
pub const PROXY: &str = "org.gnome.system.proxy";
/// Схема HTTP-прокси.
pub const HTTP: &str = "org.gnome.system.proxy.http";
/// Схема HTTPS-прокси.
pub const HTTPS: &str = "org.gnome.system.proxy.https";

/// Версия формата снимка: 2 — ключи gsettings верные и есть `ignore_hosts`
/// (версия 1 читала несуществующие ключи; её снимок по-прежнему возвращается).
pub const SNAPSHOT_VERSION: u32 = 2;

/// Адреса, которые идут мимо прокси: как `<local>` и частные сети в Windows-ветке.
pub const IGNORE_HOSTS: [&str; 6] = [
    "localhost",
    "127.0.0.0/8",
    "::1",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
];

/// Что меняет и снимает прокси: поле снимка, схема и ключ gsettings. `mode`
/// последний — режим включается, когда остальное уже записано.
pub const KEYS: [(&str, &str, &str); 6] = [
    ("http_host", HTTP, "host"),
    ("http_port", HTTP, "port"),
    ("https_host", HTTPS, "host"),
    ("https_port", HTTPS, "port"),
    ("ignore_hosts", PROXY, "ignore-hosts"),
    ("mode", PROXY, "mode"),
];

/// Одна команда `gsettings set <схема> <ключ> <значение>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Setting {
    pub schema: &'static str,
    pub key: &'static str,
    /// Значение в текстовой записи GVariant.
    pub value: String,
}

fn setting(schema: &'static str, key: &'static str, value: String) -> Setting {
    Setting { schema, key, value }
}

/// Строка GVariant: в одинарных кавычках, `\` и `'` экранируются.
fn quote(text: &str) -> String {
    format!("'{}'", text.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// Массив строк GVariant: `['a', 'b']`.
fn string_array(items: &[&str]) -> String {
    let quoted: Vec<String> = items.iter().map(|item| quote(item)).collect();
    format!("[{}]", quoted.join(", "))
}

/// Команды включения прокси `host:port` в порядке применения.
#[must_use]
pub fn enable_settings(host: &str, port: u16) -> Vec<Setting> {
    vec![
        setting(HTTP, "host", quote(host)),
        setting(HTTP, "port", port.to_string()),
        setting(HTTPS, "host", quote(host)),
        setting(HTTPS, "port", port.to_string()),
        setting(PROXY, "ignore-hosts", string_array(&IGNORE_HOSTS)),
        setting(PROXY, "mode", quote("manual")),
    ]
}

/// Команда выключения прокси без снимка.
#[must_use]
pub fn disable_settings() -> Vec<Setting> {
    vec![setting(PROXY, "mode", quote("none"))]
}

/// Снимок из прочитанных значений. `read(схема, ключ)` отдаёт текст GVariant;
/// ошибка чтения срывает снимок: менять настройки, не зная прежних, нельзя.
pub fn capture_with(
    mut read: impl FnMut(&str, &str) -> Result<String, String>,
) -> Result<ProxySnapshot, String> {
    let mut data = Map::new();
    data.insert("backend".into(), json!("gnome"));
    for (field, schema, key) in KEYS {
        data.insert(field.into(), Value::String(read(schema, key)?));
    }
    Ok(ProxySnapshot {
        version: SNAPSHOT_VERSION,
        os: "linux".into(),
        data: Value::Object(data),
    })
}

/// Команды возврата из снимка (любой версии). Поля без значения (`null` в
/// снимке версии 1, где ключ прочитать не вышло) пропускаются.
#[must_use]
pub fn restore_settings(data: &Value) -> Vec<Setting> {
    KEYS.iter()
        .filter_map(|(field, schema, key)| {
            let value = data.get(*field)?.as_str()?;
            Some(setting(schema, key, value.to_string()))
        })
        .collect()
}
