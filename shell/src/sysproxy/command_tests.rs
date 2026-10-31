// SPDX-License-Identifier: GPL-3.0-only

//! Асинхронная команда `set_system_proxy` (T-82): работа идёт не в потоке
//! команд. Настоящую ОС тесты не трогают.

use super::command::run_blocking;
use std::future::Future;
use std::task::{Context, Poll, Waker};
use std::time::{Duration, Instant};

/// Работа команды идёт в рабочем потоке: вызывающий поток не ждёт её, а
/// первый опрос будущего возвращается сразу, хотя задание ещё спит.
#[test]
fn set_system_proxy_does_not_block_main_thread() {
    let caller = std::thread::current().id();
    let nap = Duration::from_millis(400);
    let mut job = Box::pin(run_blocking(move || {
        std::thread::sleep(nap);
        Ok(std::thread::current().id())
    }));
    let started = Instant::now();
    let first = job.as_mut().poll(&mut Context::from_waker(Waker::noop()));
    assert!(matches!(first, Poll::Pending), "работа ещё идёт");
    assert!(
        started.elapsed() < nap / 2,
        "опрос ждал {:?}",
        started.elapsed()
    );
    let worker = tauri::async_runtime::block_on(job).unwrap();
    assert_ne!(worker, caller, "задание выполнено не в вызывающем потоке");
}

#[test]
fn a_panic_in_the_blocking_job_is_an_error_not_a_crash() {
    let result: Result<(), String> =
        tauri::async_runtime::block_on(run_blocking(|| panic!("тестовая паника")));
    assert!(result.unwrap_err().contains("рабочий поток"));
}
