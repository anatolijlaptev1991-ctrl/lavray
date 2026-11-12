// SPDX-License-Identifier: GPL-3.0-only

//! Windows: прокси из трёх частей (T-82).
//!
//! * LAN — значения Internet Settings через реестр, как и раньше;
//! * WPAD у LAN — флаг в `DefaultConnectionSettings`, через `WinINET`;
//! * записи RAS/VPN — у каждой своя настройка, тоже через `WinINET`.
//!
//! LAN обязателен: его сбой — ошибка. WPAD и RAS необязательны: что не
//! удалось, возвращается предупреждениями, остальное применено.

use super::backend::Backend;
use super::conn::Connections;
use super::ras::{self, RasEntries};
#[cfg(windows)]
use super::values::RegValue;
use super::values::{apply_with, capture_with, restore_with, Registry};
#[cfg(windows)]
use super::{ras::RasApi, registry::RegExe, wininet::WinInet};
use super::{wpad, ProxySnapshot};
use serde_json::{json, Map, Value};

/// Бэкенд Windows: реестр, подключения `WinINET` и список записей RAS
/// подставляются (в тестах — в памяти).
pub(super) struct Windows<R, C, E> {
    pub reg: R,
    pub conns: C,
    pub ras: E,
}

/// Версия формата снимка с полями `wpad` и `ras`. Снимок версии 2 их не
/// имеет и откатывается как раньше, без WPAD и RAS.
const FORMAT: u32 = 3;

/// Данные `base` плюс ключи `extra` (новая карта, `base` не меняется).
fn with_extra(base: &Value, extra: Map<String, Value>) -> Value {
    let mut map = base.as_object().cloned().unwrap_or_default();
    map.extend(extra);
    Value::Object(map)
}

/// Предупреждения, записанные в снимок при чтении (`capture_warnings`).
fn captured_warnings(data: &Value) -> Vec<String> {
    let list = data.get("capture_warnings").and_then(Value::as_array);
    let strings = list.into_iter().flatten().filter_map(Value::as_str);
    strings.map(str::to_string).collect()
}

/// Есть ли в снимке записи RAS, которые пишутся через `WinINET`.
///
/// Запись подключения RAS через `WinINET` переписывает и общие значения LAN в
/// реестре: прогон 0.9.0 (D-1) увидел, как после неё обнулился `ProxyServer`.
/// Поэтому после записей RAS значения LAN пишутся ещё раз, последними.
fn has_ras(data: &Value) -> bool {
    let entries = data.get("ras").and_then(Value::as_object);
    entries.is_some_and(|map| map.values().any(Value::is_object))
}

impl<R: Registry, C: Connections, E: RasEntries> Backend for Windows<R, C, E> {
    fn capture(&self) -> Result<ProxySnapshot, String> {
        let lan = capture_with(&self.reg)?;
        let mut extra = Map::new();
        let mut warnings = Vec::new();
        match wpad::capture(&self.conns) {
            Ok(on) => extra.insert("wpad".to_string(), json!(on)),
            Err(e) => {
                warnings.push(format!("WPAD (LAN): флаг не прочитан: {e}"));
                extra.insert("wpad".to_string(), Value::Null)
            }
        };
        let (entries, ras_warnings) = ras::capture(&self.conns, &self.ras);
        if let Some(entries) = entries {
            extra.insert("ras".to_string(), entries);
        }
        warnings.extend(ras_warnings);
        if !warnings.is_empty() {
            extra.insert("capture_warnings".to_string(), json!(warnings));
        }
        Ok(ProxySnapshot {
            version: FORMAT,
            data: with_extra(&lan.data, extra),
            ..lan
        })
    }

    fn apply(
        &self,
        host: &str,
        port: u16,
        original: &ProxySnapshot,
    ) -> Result<Vec<String>, String> {
        apply_with(&self.reg, host, port)?;
        // Ручной прокси LAN должен дойти до WinINET раньше правки флагов.
        self.conns.refresh();
        let mut warnings = captured_warnings(&original.data);
        warnings.extend(wpad::apply(&self.conns, &original.data));
        warnings.extend(ras::apply(&self.conns, host, port, &original.data));
        if has_ras(&original.data) {
            apply_with(&self.reg, host, port)?;
        }
        self.conns.refresh();
        Ok(warnings)
    }

    fn restore(&self, snap: &ProxySnapshot) -> Result<Vec<String>, String> {
        restore_with(&self.reg, snap)?;
        self.conns.refresh();
        let mut warnings: Vec<String> =
            wpad::restore(&self.conns, &snap.data).into_iter().collect();
        warnings.extend(ras::restore(&self.conns, &snap.data));
        if has_ras(&snap.data) {
            restore_with(&self.reg, snap)?;
        }
        self.conns.refresh();
        Ok(warnings)
    }
}

/// Настоящая ОС: `reg.exe`, `WinINET` и RAS.
#[cfg(windows)]
pub(super) fn system() -> Windows<RegExe, WinInet, RasApi> {
    Windows {
        reg: RegExe,
        conns: WinInet,
        ras: RasApi,
    }
}

/// Снимок текущих настроек (прежний свободный API модуля).
#[cfg(windows)]
pub fn capture() -> Result<ProxySnapshot, String> {
    system().capture()
}

/// Включить прокси `host:port`, предупреждения отбрасываются.
#[cfg(windows)]
pub fn apply(host: &str, port: u16) -> Result<(), String> {
    let sys = system();
    sys.apply(host, port, &sys.capture()?).map(|_| ())
}

/// Записать настройки из снимка, предупреждения отбрасываются.
#[cfg(windows)]
pub fn restore(snap: &ProxySnapshot) -> Result<(), String> {
    system().restore(snap).map(|_| ())
}

/// Выключить ручной прокси LAN (`ProxyEnable` = 0), ничего не восстанавливая.
#[cfg(windows)]
pub fn clear() -> Result<(), String> {
    let sys = system();
    sys.reg.write("ProxyEnable", &RegValue::dword(0))?;
    sys.conns.refresh();
    Ok(())
}
