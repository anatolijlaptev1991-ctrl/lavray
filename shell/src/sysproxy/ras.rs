// SPDX-License-Identifier: GPL-3.0-only

//! Подключения RAS/VPN (T-82): у каждой записи телефонной книги Windows своя
//! настройка прокси, и LAN-прокси на них не действует. Прокси ставится в каждую
//! запись, исходные настройки записи лежат в снимке (`ras`), откат идёт тем же
//! трёхсторонним правилом. Список записей даёт [`RasEntries`] (`RasEnumEntriesW`
//! или подставной), настройки — [`Connections`].

use super::conn::{ConnChange, ConnSettings, Connections, DIRECT, PROXY};
use super::values::BYPASS;
use serde_json::{Map, Value};

/// Перечисление записей телефонной книги RAS.
pub(super) trait RasEntries {
    /// Имена записей; ошибка — перечислить не удалось.
    fn names(&self) -> Result<Vec<String>, String>;
}

/// Настоящая ОС: `RasEnumEntriesW` по телефонным книгам (общей и пользователя).
#[cfg(windows)]
pub(super) struct RasApi;

#[cfg(windows)]
impl RasEntries for RasApi {
    fn names(&self) -> Result<Vec<String>, String> {
        use std::mem::size_of;
        use std::ptr::{null, null_mut};
        use windows_sys::Win32::NetworkManagement::Rras::{
            RasEnumEntriesW, ERROR_BUFFER_TOO_SMALL, RASENTRYNAMEW,
        };
        let entry = size_of::<RASENTRYNAMEW>() as u32;
        let (mut bytes, mut count) = (0u32, 0u32);
        // SAFETY: буфер не передаётся (NULL, размер 0): функция только
        // сообщает, сколько места нужно; остальные указатели — локальные.
        let code =
            unsafe { RasEnumEntriesW(null(), null(), null_mut(), &raw mut bytes, &raw mut count) };
        match code {
            0 => return Ok(Vec::new()),
            ERROR_BUFFER_TOO_SMALL => {}
            other => return Err(format!("RasEnumEntriesW: код {other}")),
        }
        // Список мог измениться между вызовами: несколько попыток.
        for _ in 0..3 {
            let slots = (bytes / entry).max(1) as usize;
            let first = RASENTRYNAMEW {
                dwSize: entry,
                ..RASENTRYNAMEW::default()
            };
            let mut buf = vec![first; slots];
            bytes = slots as u32 * entry;
            // SAFETY: `buf` — `slots` инициализированных структур с заполненным
            // `dwSize`, `bytes` — их размер в байтах; указатели локальные.
            let code = unsafe {
                RasEnumEntriesW(
                    null(),
                    null(),
                    buf.as_mut_ptr(),
                    &raw mut bytes,
                    &raw mut count,
                )
            };
            match code {
                0 => return Ok(entry_names(&buf[..(count as usize).min(slots)])),
                ERROR_BUFFER_TOO_SMALL => {}
                other => return Err(format!("RasEnumEntriesW: код {other}")),
            }
        }
        Err("RasEnumEntriesW: список записей всё время меняется".to_string())
    }
}

/// Имена записей без повторов (одна запись может быть в обеих книгах).
#[cfg(windows)]
fn entry_names(
    entries: &[windows_sys::Win32::NetworkManagement::Rras::RASENTRYNAMEW],
) -> Vec<String> {
    let names: std::collections::BTreeSet<String> = entries
        .iter()
        .map(|e| {
            let len = e.szEntryName.iter().position(|&c| c == 0);
            String::from_utf16_lossy(&e.szEntryName[..len.unwrap_or(e.szEntryName.len())])
        })
        .collect();
    names.into_iter().collect()
}

/// Записи RAS для снимка: карта «имя → настройки». Не перечислились — `None`
/// и предупреждение (прокси встанет только на LAN). Запись, настройки которой
/// не прочитались, значится как `null`: при включении она не трогается, а при
/// откате возвращается без сравнения (сравнивать не с чем).
pub(super) fn capture(
    conns: &impl Connections,
    ras: &impl RasEntries,
) -> (Option<Value>, Vec<String>) {
    let names = match ras.names() {
        Ok(names) => names,
        Err(e) => {
            let warning = format!("RAS: не перечислить подключения, прокси только для LAN: {e}");
            return (None, vec![warning]);
        }
    };
    let mut warnings = Vec::new();
    let mut entries = Map::new();
    for name in names {
        match conns.get(Some(&name)) {
            Ok(settings) => {
                entries.insert(name, settings.to_record());
            }
            Err(e) => {
                warnings.push(format!("RAS «{name}»: настройки не прочитаны: {e}"));
                entries.insert(name, Value::Null);
            }
        }
    }
    (Some(Value::Object(entries)), warnings)
}

/// Поставить в каждую снятую запись тот же прокси, что и в LAN. Сбой одной
/// записи не мешает остальным: он становится предупреждением.
pub(super) fn apply(
    conns: &impl Connections,
    host: &str,
    port: u16,
    original: &Value,
) -> Vec<String> {
    let Some(entries) = original.get("ras").and_then(Value::as_object) else {
        return Vec::new();
    };
    // PAC не трогаем: без флага AUTO_PROXY_URL он не используется.
    let change = ConnChange {
        flags: Some(DIRECT | PROXY),
        server: Some(format!("{host}:{port}")),
        bypass: Some(BYPASS.to_string()),
        pac_url: None,
    };
    let readable = entries.iter().filter(|(_, record)| record.is_object());
    readable
        .filter_map(|(name, _)| {
            let failed = conns.set(Some(name), &change).err();
            failed.map(|e| format!("RAS «{name}»: {e}"))
        })
        .collect()
}

/// Записать записи из итогового снимка (после трёхстороннего слияния).
pub(super) fn restore(conns: &impl Connections, target: &Value) -> Vec<String> {
    let Some(entries) = target.get("ras").and_then(Value::as_object) else {
        return Vec::new();
    };
    let readable = entries.iter().filter(|(_, record)| record.is_object());
    readable
        .filter_map(|(name, record)| {
            let failed = restore_entry(conns, name, record).err();
            failed.map(|e| format!("RAS «{name}»: {e}"))
        })
        .collect()
}

fn restore_entry(conns: &impl Connections, name: &str, record: &Value) -> Result<(), String> {
    let want = ConnSettings::from_record(record)?;
    if conns.get(Some(name)).is_ok_and(|now| now == want) {
        return Ok(());
    }
    conns.set(Some(name), &want.to_change())
}
