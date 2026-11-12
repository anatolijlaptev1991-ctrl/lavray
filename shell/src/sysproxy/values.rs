// SPDX-License-Identifier: GPL-3.0-only

//! Значения Internet Settings (`WinINET` через реестр): снимок, применение и
//! запись из снимка. Логика без обращения к ОС: сам реестр подставляется
//! (`Registry`), поэтому проверяется на любой платформе.

use super::ProxySnapshot;
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Значения Internet Settings, которыми управляет прокси.
pub(super) const NAMES: [&str; 4] = [
    "ProxyEnable",
    "ProxyServer",
    "ProxyOverride",
    "AutoConfigURL",
];
/// Локальные адреса и типичные внутренние сети — мимо прокси.
pub(super) const BYPASS: &str =
    "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;\
    172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;\
    172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>";

/// Значение реестра: тип и текст так, как их печатает `reg query`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct RegValue {
    pub kind: String,
    pub data: String,
}

impl RegValue {
    pub fn sz(data: impl Into<String>) -> Self {
        Self {
            kind: "REG_SZ".into(),
            data: data.into(),
        }
    }

    pub fn dword(n: u32) -> Self {
        Self {
            kind: "REG_DWORD".into(),
            data: format!("0x{n:x}"),
        }
    }

    fn to_json(&self) -> Value {
        json!({ "type": self.kind, "data": self.data })
    }

    /// Из снимка: `null` (значения нет), объект `{type, data}` или строка
    /// старого формата (число для `ProxyEnable`, иначе `REG_SZ`).
    fn from_json(name: &str, value: &Value) -> Result<Option<Self>, String> {
        match value {
            Value::Null => Ok(None),
            Value::String(s) if name == "ProxyEnable" => parse_dword(s)
                .map(|n| Some(Self::dword(n)))
                .ok_or_else(|| format!("снимок: {name}: не число: {s}")),
            Value::String(s) => Ok(Some(Self::sz(s.clone()))),
            Value::Object(map) => match (map.get("type"), map.get("data")) {
                (Some(Value::String(kind)), Some(Value::String(data))) => Ok(Some(Self {
                    kind: kind.clone(),
                    data: data.clone(),
                })),
                _ => Err(format!("снимок: {name}: нет type/data")),
            },
            _ => Err(format!("снимок: {name}: неожиданное значение")),
        }
    }
}

/// `0x1` (так печатает `reg query`) или `1` → число.
pub(super) fn parse_dword(text: &str) -> Option<u32> {
    let text = text.trim();
    match text.strip_prefix("0x") {
        Some(hex) => u32::from_str_radix(hex, 16).ok(),
        None => text.parse().ok(),
    }
}

/// Значения из вывода `reg query <ключ>`: строки `    Имя    ТИП    данные`.
/// Данные берутся целиком, с любыми пробелами (раньше значение обрезалось
/// по первому пробелу, A2-04). Заголовок ключа, имена подразделов и пустые
/// строки пропускаются.
pub(super) fn parse_query(output: &str) -> BTreeMap<String, RegValue> {
    let mut found = BTreeMap::new();
    for line in output.lines() {
        let Some(rest) = line.strip_prefix("    ") else {
            continue;
        };
        let mut parts = rest.splitn(3, "    ");
        let (Some(name), Some(kind)) = (parts.next(), parts.next()) else {
            continue;
        };
        if kind.starts_with("REG_") {
            let data = parts.next().unwrap_or("").to_string();
            found.insert(
                name.to_string(),
                RegValue {
                    kind: kind.to_string(),
                    data,
                },
            );
        }
    }
    found
}

/// Чтение и запись значений Internet Settings: `reg.exe` или подставной.
pub(super) trait Registry {
    /// Текущие значения; отсутствующих в карте нет.
    fn read(&self) -> Result<BTreeMap<String, RegValue>, String>;
    fn write(&self, name: &str, value: &RegValue) -> Result<(), String>;
    /// Удаление отсутствующего значения — не ошибка.
    fn remove(&self, name: &str) -> Result<(), String>;
}

/// Снимок текущих настроек. `ProxyEnable` и `ProxyServer` лежат в одной записи
/// `proxy`: если `ProxyServer` сменила другая программа, её `ProxyEnable` мы
/// тоже не трогаем.
pub(super) fn capture_with(reg: &impl Registry) -> Result<ProxySnapshot, String> {
    let found = reg.read()?;
    let get = |name: &str| -> Result<Value, String> {
        match found.get(name) {
            None => Ok(Value::Null),
            Some(v) if matches!(v.kind.as_str(), "REG_SZ" | "REG_EXPAND_SZ" | "REG_DWORD") => {
                Ok(v.to_json())
            }
            Some(v) => Err(format!(
                "{name}: тип {} не поддерживается, системный прокси не изменён",
                v.kind
            )),
        }
    };
    Ok(ProxySnapshot {
        version: 2,
        os: "windows".into(),
        data: json!({
            "proxy": { "ProxyEnable": get("ProxyEnable")?, "ProxyServer": get("ProxyServer")? },
            "ProxyOverride": get("ProxyOverride")?,
            "AutoConfigURL": get("AutoConfigURL")?,
        }),
    })
}

pub(super) fn apply_with(reg: &impl Registry, host: &str, port: u16) -> Result<(), String> {
    reg.write("ProxyServer", &RegValue::sz(format!("{host}:{port}")))?;
    reg.write("ProxyOverride", &RegValue::sz(BYPASS))?;
    // PAC-скрипт несовместим с ручным прокси — убираем на время сессии
    // (значение сохранено в снимке и вернётся при выключении).
    reg.remove("AutoConfigURL")?;
    reg.write("ProxyEnable", &RegValue::dword(1))
}

/// Значение из данных снимка: новый формат (группа `proxy`) или плоский
/// старый.
fn field<'a>(data: &'a Value, name: &str) -> &'a Value {
    data.get("proxy")
        .and_then(|group| group.get(name))
        .or_else(|| data.get(name))
        .unwrap_or(&Value::Null)
}

/// Включён ли ручной прокси в данных снимка (`ProxyEnable` = 1).
pub(super) fn proxy_enabled(data: &Value) -> bool {
    match RegValue::from_json("ProxyEnable", field(data, "ProxyEnable")) {
        Ok(Some(value)) => parse_dword(&value.data) == Some(1),
        _ => false,
    }
}

/// Есть ли в данных снимка PAC-скрипт (`AutoConfigURL`).
pub(super) fn pac_present(data: &Value) -> bool {
    !field(data, "AutoConfigURL").is_null()
}

/// Записать настройки из снимка (новый формат или плоский старый).
/// `ProxyEnable` идёт первым: если запись оборвётся посередине, прокси
/// останется выключенным, а не включённым с чужим адресом.
pub(super) fn restore_with(reg: &impl Registry, snap: &ProxySnapshot) -> Result<(), String> {
    for name in NAMES {
        match RegValue::from_json(name, field(&snap.data, name))? {
            Some(v) => reg.write(name, &v)?,
            None => reg.remove(name)?,
        }
    }
    Ok(())
}
