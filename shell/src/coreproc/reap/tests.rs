// SPDX-License-Identifier: GPL-3.0-only

//! Тесты дедлайнов ожидания и передачи reap отдельному потоку.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::*;

#[cfg(unix)]
fn exit_status() -> ExitStatus {
    std::os::unix::process::ExitStatusExt::from_raw(0)
}

#[cfg(windows)]
fn exit_status() -> ExitStatus {
    std::os::windows::process::ExitStatusExt::from_raw(0)
}

/// Фейк: `poll_exit` выхода не видит; `wait_exit` блокируется, пока тест не
/// «убьёт» процесс, и тогда ставит флаг reaped.
struct Stubborn {
    release: Arc<AtomicBool>,
    reaped: Arc<AtomicBool>,
}

impl ChildHandle for Stubborn {
    fn poll_exit(&mut self) -> io::Result<Option<ExitStatus>> {
        Ok(None)
    }

    fn wait_exit(&mut self) -> io::Result<ExitStatus> {
        while !self.release.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(5));
        }
        self.reaped.store(true, Ordering::SeqCst);
        Ok(exit_status())
    }
}

/// Процесс не отдаёт выход: срок реально ограничивает ожидание, supervisor не
/// блокируется на `wait()`, а reap уходит отдельному потоку и завершается,
/// когда процесс всё же умирает (zombie не остаётся).
#[test]
fn a_stubborn_child_is_handed_off_after_the_deadline() {
    let (release, reaped) = (
        Arc::new(AtomicBool::new(false)),
        Arc::new(AtomicBool::new(false)),
    );
    let child = Stubborn {
        release: Arc::clone(&release),
        reaped: Arc::clone(&reaped),
    };
    let started = Instant::now();
    let outcome = reap_or_hand_off(
        child,
        Instant::now() + Duration::from_millis(80),
        Duration::from_millis(10),
    );
    assert_eq!(outcome, Reaped::HandedOff);
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "без вечной блокировки"
    );
    assert!(!reaped.load(Ordering::SeqCst), "reap идёт в другом потоке");
    release.store(true, Ordering::SeqCst);
    let until = Instant::now() + Duration::from_secs(5);
    while !reaped.load(Ordering::SeqCst) && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    assert!(
        reaped.load(Ordering::SeqCst),
        "reaper дождался и собрал процесс"
    );
}

struct Quick;

impl ChildHandle for Quick {
    fn poll_exit(&mut self) -> io::Result<Option<ExitStatus>> {
        Ok(Some(exit_status()))
    }

    fn wait_exit(&mut self) -> io::Result<ExitStatus> {
        Ok(exit_status())
    }
}

#[test]
fn a_child_that_exits_in_time_is_reaped_inline() {
    let outcome = reap_or_hand_off(
        Quick,
        Instant::now() + Duration::from_secs(1),
        Duration::from_millis(5),
    );
    assert_eq!(outcome, Reaped::Exited(exit_status()));
}

#[test]
fn wait_exit_until_respects_its_deadline() {
    let flag = Arc::new(AtomicBool::new(true));
    let mut child = Stubborn {
        release: Arc::clone(&flag),
        reaped: flag,
    };
    let started = Instant::now();
    let got = wait_exit_until(
        &mut child,
        Instant::now() + Duration::from_millis(60),
        Duration::from_millis(10),
    );
    assert!(got.is_none());
    assert!(started.elapsed() >= Duration::from_millis(60));
    assert!(started.elapsed() < Duration::from_secs(2));
}
