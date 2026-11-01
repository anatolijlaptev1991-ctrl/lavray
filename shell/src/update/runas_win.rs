// SPDX-License-Identifier: GPL-3.0-only

//! Запуск установщика с повышением: `ShellExecuteExW` с глаголом `runas`
//! (система сама показывает UAC). В отличие от `elevation::Runas`, возвращает
//! pid запущенного процесса (`SEE_MASK_NOCLOSEPROCESS`): по нему watchdog ждёт
//! конца установки. Настоящий UAC тесты не вызывают; файл только собирается.

use super::install::{join_args, system32_dir, ElevateError, ElevatedHandle, Elevator};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_CANCELLED};
use windows_sys::Win32::System::Com::{
    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
};
use windows_sys::Win32::System::Threading::GetProcessId;
use windows_sys::Win32::UI::Shell::{
    ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

/// Системный повышенный запуск.
pub struct Runas;

fn wide(text: &OsStr) -> Vec<u16> {
    text.encode_wide().chain(std::iter::once(0)).collect()
}

impl Elevator for Runas {
    fn run_elevated(&self, exe: &Path, args: &[&str]) -> Result<ElevatedHandle, ElevateError> {
        let verb = wide(OsStr::new("runas"));
        let file = wide(exe.as_os_str());
        let params = wide(OsStr::new(&join_args(args)));
        // рабочий каталог — System32, а не staging, куда пользователь может писать
        let dir = wide(system32_dir(std::env::var_os("SystemRoot")).as_os_str());

        // SAFETY: структура из нулей — допустимое начальное состояние
        // SHELLEXECUTEINFOW; обязательные поля заполняются ниже.
        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOASYNC | SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        info.lpDirectory = dir.as_ptr();
        info.nShow = SW_SHOWNORMAL;
        execute(&mut info)
    }
}

/// Вызов `ShellExecuteExW` и разбор исхода; хэндл процесса закрывается здесь.
fn execute(info: &mut SHELLEXECUTEINFOW) -> Result<ElevatedHandle, ElevateError> {
    // SAFETY: COM нужен оболочке Windows для ShellExecute вне потока окна;
    // успешный вызов (>= 0) закрывается парным `CoUninitialize`.
    let com = unsafe {
        CoInitializeEx(
            std::ptr::null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        )
    };
    // SAFETY: `info` и все строки, на которые он ссылается, живут до конца
    // вызова (их держит `run_elevated`); `cbSize` указан.
    let launched = unsafe { ShellExecuteExW(info) } != 0;
    // SAFETY: читает код последней ошибки потока сразу после вызова.
    let code = if launched {
        0
    } else {
        unsafe { GetLastError() }
    };
    let pid = if launched && !info.hProcess.is_null() {
        // SAFETY: `hProcess` вернул успешный вызов с NOCLOSEPROCESS; закрываем
        // ровно один раз после чтения pid.
        let pid = unsafe { GetProcessId(info.hProcess) };
        unsafe { CloseHandle(info.hProcess) };
        pid
    } else {
        0
    };
    if com >= 0 {
        // SAFETY: парный вызов к успешному `CoInitializeEx` выше.
        unsafe { CoUninitialize() };
    }
    match code {
        _ if launched => Ok(ElevatedHandle { pid }),
        ERROR_CANCELLED => Err(ElevateError::UacCancelled),
        other => Err(ElevateError::Failed(format!(
            "ShellExecuteEx: код ошибки Windows {other}"
        ))),
    }
}
