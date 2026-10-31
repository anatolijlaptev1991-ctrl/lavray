// SPDX-License-Identifier: GPL-3.0-only

//! Windows: прокси отдельного подключения через WinINET (T-82) —
//! `InternetQueryOptionW`/`InternetSetOptionW` с
//! `INTERNET_OPTION_PER_CONNECTION_OPTION`. `pszConnection` = NULL — подключение
//! по локальной сети (LAN), иначе имя записи RAS. Параметры: флаги, прокси,
//! исключения, адрес PAC-скрипта.

use super::conn::{ConnChange, ConnSettings, Connections};
use std::ffi::c_void;
use std::mem::size_of;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{GetLastError, GlobalFree};
use windows_sys::Win32::Networking::WinInet::{
    InternetQueryOptionW, InternetSetOptionW, INTERNET_OPTION_PER_CONNECTION_OPTION,
    INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED, INTERNET_PER_CONN_AUTOCONFIG_URL,
    INTERNET_PER_CONN_FLAGS, INTERNET_PER_CONN_OPTIONW, INTERNET_PER_CONN_OPTIONW_0,
    INTERNET_PER_CONN_OPTION_LISTW, INTERNET_PER_CONN_PROXY_BYPASS, INTERNET_PER_CONN_PROXY_SERVER,
};

/// Настоящий WinINET.
pub(super) struct WinInet;

/// Строка UTF-16 с завершающим нулём.
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn option_dword(kind: u32, value: u32) -> INTERNET_PER_CONN_OPTIONW {
    INTERNET_PER_CONN_OPTIONW {
        dwOption: kind,
        Value: INTERNET_PER_CONN_OPTIONW_0 { dwValue: value },
    }
}

/// Параметр-строка; `text` должен жить до конца вызова API.
fn option_text(kind: u32, text: &[u16]) -> INTERNET_PER_CONN_OPTIONW {
    INTERNET_PER_CONN_OPTIONW {
        dwOption: kind,
        Value: INTERNET_PER_CONN_OPTIONW_0 {
            pszValue: text.as_ptr().cast_mut(),
        },
    }
}

/// Список параметров для подключения `name` (NULL — LAN).
fn list_for(
    name: Option<&[u16]>,
    options: &mut [INTERNET_PER_CONN_OPTIONW],
) -> INTERNET_PER_CONN_OPTION_LISTW {
    INTERNET_PER_CONN_OPTION_LISTW {
        dwSize: size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32,
        pszConnection: name.map_or(null_mut(), |n| n.as_ptr().cast_mut()),
        dwOptionCount: options.len() as u32,
        dwOptionError: 0,
        pOptions: options.as_mut_ptr(),
    }
}

fn last_error(api: &str) -> String {
    // SAFETY: GetLastError без параметров.
    format!("{api}: код {}", unsafe { GetLastError() })
}

/// Строка, выданная WinINET (`GlobalAlloc`): копия в `String`, исходная
/// память освобождается. Пустая и NULL — `None`.
///
/// # Safety
/// `ptr` — NULL либо указатель на строку UTF-16 с нулём, выданную WinINET и
/// ещё не освобождённую.
unsafe fn take_text(ptr: *mut u16) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let mut len = 0;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
    GlobalFree(ptr.cast());
    Some(text).filter(|t| !t.is_empty())
}

fn query(conn: Option<&str>) -> Result<ConnSettings, String> {
    let name = conn.map(wide);
    let mut options = [
        INTERNET_PER_CONN_FLAGS,
        INTERNET_PER_CONN_PROXY_SERVER,
        INTERNET_PER_CONN_PROXY_BYPASS,
        INTERNET_PER_CONN_AUTOCONFIG_URL,
    ]
    .map(|kind| option_dword(kind, 0));
    let mut list = list_for(name.as_deref(), &mut options);
    let mut size = list.dwSize;
    let list_ptr: *mut INTERNET_PER_CONN_OPTION_LISTW = &mut list;
    // SAFETY: `list` и `options` живут до конца вызова, `size` — размер
    // `list`; hInternet = NULL — настройки по умолчанию, как требует опция.
    let ok = unsafe {
        InternetQueryOptionW(
            null(),
            INTERNET_OPTION_PER_CONNECTION_OPTION,
            list_ptr.cast(),
            &mut size,
        )
    };
    if ok == 0 {
        return Err(last_error("InternetQueryOptionW"));
    }
    // SAFETY: успешный запрос заполнил dwValue флагов и pszValue трёх строк
    // (NULL либо память WinINET, которую `take_text` освобождает один раз).
    unsafe {
        Ok(ConnSettings {
            flags: options[0].Value.dwValue,
            server: take_text(options[1].Value.pszValue),
            bypass: take_text(options[2].Value.pszValue),
            pac_url: take_text(options[3].Value.pszValue),
        })
    }
}

fn store(conn: Option<&str>, change: &ConnChange) -> Result<(), String> {
    let name = conn.map(wide);
    let text = |value: &Option<String>| value.as_deref().map(wide);
    let (server, bypass, pac) = (
        text(&change.server),
        text(&change.bypass),
        text(&change.pac_url),
    );
    let mut options = Vec::with_capacity(4);
    if let Some(flags) = change.flags {
        options.push(option_dword(INTERNET_PER_CONN_FLAGS, flags));
    }
    for (kind, value) in [
        (INTERNET_PER_CONN_PROXY_SERVER, &server),
        (INTERNET_PER_CONN_PROXY_BYPASS, &bypass),
        (INTERNET_PER_CONN_AUTOCONFIG_URL, &pac),
    ] {
        if let Some(value) = value {
            options.push(option_text(kind, value));
        }
    }
    if options.is_empty() {
        return Ok(());
    }
    let list = list_for(name.as_deref(), &mut options);
    let list_ptr: *const INTERNET_PER_CONN_OPTION_LISTW = &list;
    // SAFETY: `list`, `options` и строки (`server`/`bypass`/`pac`, `name`)
    // живут до конца вызова; длина буфера — размер `list`.
    let ok = unsafe {
        InternetSetOptionW(
            null(),
            INTERNET_OPTION_PER_CONNECTION_OPTION,
            list_ptr.cast::<c_void>(),
            list.dwSize,
        )
    };
    if ok == 0 {
        return Err(last_error("InternetSetOptionW"));
    }
    Ok(())
}

impl Connections for WinInet {
    fn get(&self, conn: Option<&str>) -> Result<ConnSettings, String> {
        query(conn)
    }

    fn set(&self, conn: Option<&str>, change: &ConnChange) -> Result<(), String> {
        store(conn, change)
    }

    /// Уведомить WinINET об изменении (без этого Chrome видит старый прокси).
    fn refresh(&self) {
        // SAFETY: вызовы без параметров (hInternet = NULL), документированы
        // WinINET: система узнаёт о смене настроек прокси.
        unsafe {
            InternetSetOptionW(null(), INTERNET_OPTION_SETTINGS_CHANGED, null(), 0);
            InternetSetOptionW(null(), INTERNET_OPTION_REFRESH, null(), 0);
        }
    }
}
