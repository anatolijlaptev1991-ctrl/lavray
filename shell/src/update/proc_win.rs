// SPDX-License-Identifier: GPL-3.0-only

//! Ожидание выхода процесса установщика в Windows с кодом возврата. Если
//! хэндл повышенного процесса открыть не удалось (другой уровень целостности),
//! процесс ищется в списке процессов (`ToolHelp`) без открытия: код возврата
//! тогда неизвестен. Настоящие процессы тесты не трогают; файл только собирается.

use super::watchdog::{InstallerWaiter, WaitResult};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// Право ждать на хэндле процесса (`SYNCHRONIZE`).
const SYNCHRONIZE: u32 = 0x0010_0000;
/// Период опроса, когда ждать на хэндле нельзя.
const POLL: Duration = Duration::from_millis(500);

/// Ожидание процесса по pid.
pub struct ProcessWaiter;

impl InstallerWaiter for ProcessWaiter {
    fn wait_exit(&self, pid: u32, timeout: Duration) -> WaitResult {
        // SAFETY: вызов без указателей; нулевой хэндл означает ошибку и
        // проверяется ниже.
        let handle =
            unsafe { OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return poll_snapshot(pid, timeout);
        }
        let ms = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX - 1);
        // SAFETY: `handle` открыт выше с правом SYNCHRONIZE.
        let waited = unsafe { WaitForSingleObject(handle, ms) };
        let result = if waited == WAIT_OBJECT_0 {
            let mut code = 0u32;
            // SAFETY: `handle` открыт с правом QUERY_LIMITED; `code` — валидный
            // указатель на локальную переменную.
            let known = unsafe { GetExitCodeProcess(handle, &raw mut code) } != 0;
            WaitResult::Exited(known.then_some(code))
        } else {
            WaitResult::TimedOut
        };
        // SAFETY: `handle` открыт выше и закрывается ровно один раз.
        unsafe { CloseHandle(handle) };
        result
    }
}

/// Опрос списка процессов, пока `pid` не исчезнет или не выйдет время.
fn poll_snapshot(pid: u32, timeout: Duration) -> WaitResult {
    let deadline = Instant::now() + timeout;
    while process_listed(pid) {
        if Instant::now() >= deadline {
            return WaitResult::TimedOut;
        }
        std::thread::sleep(POLL);
    }
    WaitResult::Exited(None)
}

/// Есть ли процесс с таким pid в системном списке (без его открытия).
fn process_listed(pid: u32) -> bool {
    // SAFETY: снимок процессов — вызов без указателей; хэндл закрывается ниже.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot.is_null() || snapshot as isize == -1 {
        return true; // не смогли посмотреть — считаем, что процесс жив
    }
    // SAFETY: структура из нулей допустима; `dwSize` обязателен для API.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut found = false;
    // SAFETY: `snapshot` валиден, `entry` — валидный указатель с заполненным размером.
    let mut more = unsafe { Process32FirstW(snapshot, &raw mut entry) } != 0;
    while more && !found {
        found = entry.th32ProcessID == pid;
        // SAFETY: те же условия, что для `Process32FirstW`.
        more = unsafe { Process32NextW(snapshot, &raw mut entry) } != 0;
    }
    // SAFETY: `snapshot` создан выше и закрывается ровно один раз.
    unsafe { CloseHandle(snapshot) };
    found
}
