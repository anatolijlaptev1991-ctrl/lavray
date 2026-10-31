// SPDX-License-Identifier: GPL-3.0-only

//! Windows: чтение и запись значений Internet Settings через системный
//! `reg.exe` и уведомление WinINET об изменениях.

use super::values::{self, parse_dword, parse_query, RegValue, Registry, NAMES};
use super::ProxySnapshot;
use crate::oemtext::decode_console_output;
use std::collections::BTreeMap;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;

const REG_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `%SystemRoot%\System32\reg.exe`. Запуск по имени (`Command::new("reg")`)
/// ищет программу сначала в каталоге приложения: подложенный рядом с
/// LAVRay.exe `reg.exe` выполнялся бы при каждом включении прокси, а при
/// запуске от администратора — с повышенными правами (A2-07).
pub(super) fn reg_exe() -> PathBuf {
    let root = std::env::var_os("SystemRoot")
        .or_else(|| std::env::var_os("windir"))
        .unwrap_or_else(|| r"C:\Windows".into());
    PathBuf::from(root).join("System32").join("reg.exe")
}

/// Запустить `reg.exe`. Аргументы уходят в `CreateProcessW` (UTF-16), так
/// что не-ASCII значения при записи доходят без потерь; а вывод `reg.exe`
/// пишет в OEM-кодовой странице (CP866 на русской Windows), поэтому читается
/// через [`decode_console_output`], а не как UTF-8 (S-02).
fn run(args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new(reg_exe())
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("reg: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "reg {}: {}",
            args.first().unwrap_or(&""),
            decode_console_output(&out.stderr).trim()
        ));
    }
    Ok(decode_console_output(&out.stdout))
}

struct RegExe;

impl Registry for RegExe {
    /// Один `reg query` по ключу вместо четырёх: пока он успешен,
    /// отсутствие имени в выводе значит «значения нет».
    fn read(&self) -> Result<BTreeMap<String, RegValue>, String> {
        let mut all = parse_query(&run(&["query", REG_KEY])?);
        all.retain(|name, _| NAMES.contains(&name.as_str()));
        Ok(all)
    }

    fn write(&self, name: &str, value: &RegValue) -> Result<(), String> {
        let data = if value.kind == "REG_DWORD" {
            parse_dword(&value.data)
                .ok_or_else(|| format!("{name}: не число: {}", value.data))?
                .to_string()
        } else {
            value.data.clone()
        };
        run(&[
            "add",
            REG_KEY,
            "/v",
            name,
            "/t",
            &value.kind,
            "/d",
            &data,
            "/f",
        ])
        .map(|_| ())
    }

    fn remove(&self, name: &str) -> Result<(), String> {
        match run(&["delete", REG_KEY, "/v", name, "/f"]) {
            Ok(_) => Ok(()),
            // `reg delete` одинаково падает на «нет значения» и «нет доступа»
            // (текст ошибки зависит от языка ОС): различаем повторным чтением.
            Err(e) if self.read()?.contains_key(name) => Err(e),
            Err(_) => Ok(()),
        }
    }
}

/// Уведомить WinINET об изменении (без этого Chrome видит старый прокси).
fn notify() {
    use windows_sys::Win32::Networking::WinInet::{
        InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
    };
    // SAFETY: вызов без параметров (hInternet = null), документирован
    // WinINet: уведомляет систему о смене настроек прокси в реестре.
    unsafe {
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            std::ptr::null_mut(),
            0,
        );
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_REFRESH,
            std::ptr::null_mut(),
            0,
        );
    }
}

pub fn capture() -> Result<ProxySnapshot, String> {
    values::capture_with(&RegExe)
}

pub fn apply(host: &str, port: u16) -> Result<(), String> {
    values::apply_with(&RegExe, host, port)?;
    notify();
    Ok(())
}

pub fn restore(snap: &ProxySnapshot) -> Result<(), String> {
    values::restore_with(&RegExe, snap)?;
    notify();
    Ok(())
}

pub fn clear() -> Result<(), String> {
    RegExe.write("ProxyEnable", &RegValue::dword(0))?;
    notify();
    Ok(())
}
