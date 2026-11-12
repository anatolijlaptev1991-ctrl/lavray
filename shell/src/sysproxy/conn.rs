// SPDX-License-Identifier: GPL-3.0-only

//! Прокси отдельного подключения `WinINET`: LAN или запись RAS/VPN (T-82).
//!
//! Windows хранит для каждого подключения свои настройки, и ручной прокси в
//! `Internet Settings` относится только к LAN. Здесь — модель этих настроек и
//! трейт доступа к ним; сами вызовы `InternetQueryOptionW`/`InternetSetOptionW`
//! лежат в `wininet.rs`. Логика без обращения к ОС проверяется на любой
//! платформе.

use serde_json::{json, Value};

/// Биты `INTERNET_PER_CONN_FLAGS` (`PROXY_TYPE_*` из wininet.h).
pub(super) const DIRECT: u32 = 1;
pub(super) const PROXY: u32 = 2;
pub(super) const AUTO_PROXY_URL: u32 = 4;
/// «Автоматическое определение настроек» (WPAD).
pub(super) const AUTO_DETECT: u32 = 8;

/// Настройки прокси одного подключения.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct ConnSettings {
    pub flags: u32,
    pub server: Option<String>,
    pub bypass: Option<String>,
    pub pac_url: Option<String>,
}

/// Что записать в подключение: `None` — параметр не трогать, `Some("")` —
/// очистить.
#[derive(Clone, Debug, Default)]
pub(super) struct ConnChange {
    pub flags: Option<u32>,
    pub server: Option<String>,
    pub bypass: Option<String>,
    pub pac_url: Option<String>,
}

/// Настройки подключений: `WinINET` или подставные (тесты).
pub(super) trait Connections {
    /// `None` — LAN, `Some(имя)` — запись RAS.
    fn get(&self, conn: Option<&str>) -> Result<ConnSettings, String>;
    fn set(&self, conn: Option<&str>, change: &ConnChange) -> Result<(), String>;
    /// Сообщить системе, что настройки изменены (Chrome/Edge перечитают).
    fn refresh(&self) {}
}

fn text(value: &Value, key: &str) -> Option<String> {
    let found = value.get(key).and_then(Value::as_str);
    found.filter(|s| !s.is_empty()).map(str::to_string)
}

fn bit(value: &Value, key: &str, mask: u32) -> u32 {
    match value.get(key).and_then(Value::as_bool) {
        Some(true) => mask,
        _ => 0,
    }
}

impl ConnSettings {
    /// Запись снимка. Флаги разложены по независимым слотам (`proxy`,
    /// `bypass`, `pac`, `wpad`): трёхсторонний откат сравнивает их по
    /// отдельности, и правка пользователем одной галочки не оставляет наш
    /// прокси в подключении.
    pub(super) fn to_record(&self) -> Value {
        json!({
            "proxy": { "on": self.flags & PROXY != 0, "server": self.server },
            "bypass": self.bypass,
            "pac": { "on": self.flags & AUTO_PROXY_URL != 0, "url": self.pac_url },
            "wpad": self.flags & AUTO_DETECT != 0,
        })
    }

    /// Обратно из записи снимка. Бит `DIRECT` есть в любом состоянии, которое
    /// пишет сам Windows (1, 3, 5, 9, 11…), поэтому ставится всегда.
    pub(super) fn from_record(record: &Value) -> Result<Self, String> {
        if !record.is_object() {
            return Err("снимок: запись подключения не объект".to_string());
        }
        let (proxy, pac) = (&record["proxy"], &record["pac"]);
        Ok(Self {
            flags: DIRECT
                | bit(proxy, "on", PROXY)
                | bit(pac, "on", AUTO_PROXY_URL)
                | bit(record, "wpad", AUTO_DETECT),
            server: text(proxy, "server"),
            bypass: text(record, "bypass"),
            pac_url: text(pac, "url"),
        })
    }

    /// Записать все четыре параметра (пустые — очистить).
    pub(super) fn to_change(&self) -> ConnChange {
        let own = |v: &Option<String>| Some(v.clone().unwrap_or_default());
        ConnChange {
            flags: Some(self.flags),
            server: own(&self.server),
            bypass: own(&self.bypass),
            pac_url: own(&self.pac_url),
        }
    }
}
