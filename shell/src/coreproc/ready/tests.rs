// SPDX-License-Identifier: GPL-3.0-only

//! Тесты ожидания ready-строки: отмена, закрытый канал, задержка доставки.

use std::process::ExitStatus;
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::*;

#[cfg(unix)]
fn exit_status() -> ExitStatus {
    std::os::unix::process::ExitStatusExt::from_raw(0)
}

#[cfg(windows)]
fn exit_status() -> ExitStatus {
    std::os::windows::process::ExitStatusExt::from_raw(0)
}

/// Фейковый ребёнок: выходит в заданный момент либо не выходит никогда.
struct FakeChild(Option<Instant>);

impl ChildHandle for FakeChild {
    fn poll_exit(&mut self) -> io::Result<Option<ExitStatus>> {
        Ok(self
            .0
            .filter(|at| Instant::now() >= *at)
            .map(|_| exit_status()))
    }

    fn wait_exit(&mut self) -> io::Result<ExitStatus> {
        Ok(exit_status())
    }
}

const SLOW_POLL: Duration = Duration::from_secs(5);
const BIG_BUDGET: Duration = Duration::from_secs(30);

fn wait(rx: &Receiver<String>, child: &mut FakeChild, flag: &AtomicBool) -> WaitOutcome {
    wait_ready_loop(rx, child, BIG_BUDGET, SLOW_POLL, flag)
}

/// Stop через 50–100 мс после spawn прерывает ожидание сразу, а не на
/// очередном опросе (здесь опрос — 5 с, бюджет — 30 с).
#[test]
fn cancel_interrupts_the_wait_promptly() {
    let (_tx, rx) = channel();
    let flag = Arc::new(AtomicBool::new(false));
    let setter = Arc::clone(&flag);
    let started = Instant::now();
    let t = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        setter.store(true, Ordering::SeqCst);
    });
    // Ожидание на recv_timeout(min(poll, remaining)) спит до 5 с: отмена
    // обязана будить его — проверяем верхнюю границу задержки реакции.
    let outcome = wait_ready_loop(
        &rx,
        &mut FakeChild(None),
        BIG_BUDGET,
        Duration::from_millis(20),
        &flag,
    );
    t.join().unwrap();
    assert!(matches!(outcome, WaitOutcome::Cancelled));
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn an_already_set_flag_cancels_immediately() {
    let (_tx, rx) = channel();
    let started = Instant::now();
    let outcome = wait(&rx, &mut FakeChild(None), &AtomicBool::new(true));
    assert!(matches!(outcome, WaitOutcome::Cancelled));
    assert!(started.elapsed() < Duration::from_millis(500));
}

/// Ready-строка доставляется сразу, без ожидания очередного опроса.
#[test]
fn ready_is_delivered_without_waiting_for_the_next_poll() {
    let (tx, rx) = channel();
    let t = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(30));
        tx.send("url".to_owned()).unwrap();
    });
    let started = Instant::now();
    let outcome = wait(&rx, &mut FakeChild(None), &AtomicBool::new(false));
    t.join().unwrap();
    assert!(matches!(outcome, WaitOutcome::Ready(ref u) if u == "url"));
    assert!(started.elapsed() < Duration::from_secs(2));
}

/// Закрытый stdout без ready (процесс жив) — отдельный исход, не таймаут.
#[test]
fn a_closed_channel_is_reported_without_waiting_for_the_budget() {
    let (tx, rx) = channel::<String>();
    drop(tx);
    let started = Instant::now();
    let outcome = wait(&rx, &mut FakeChild(None), &AtomicBool::new(false));
    assert!(matches!(outcome, WaitOutcome::ChannelClosed));
    assert!(started.elapsed() < Duration::from_secs(3));
}

/// Сообщение в очереди важнее закрытия канала (отправитель уже отдан).
#[test]
fn a_queued_ready_wins_over_the_closed_channel() {
    let (tx, rx) = channel();
    tx.send("queued".to_owned()).unwrap();
    drop(tx);
    let outcome = wait(&rx, &mut FakeChild(None), &AtomicBool::new(false));
    assert!(matches!(outcome, WaitOutcome::Ready(ref u) if u == "queued"));
}

/// Закрытый канал + выход процесса — это выход, а не «закрытый канал».
#[test]
fn a_closed_channel_with_an_exited_child_reports_the_exit() {
    let (tx, rx) = channel::<String>();
    drop(tx);
    let mut child = FakeChild(Some(Instant::now()));
    let outcome = wait(&rx, &mut child, &AtomicBool::new(false));
    assert!(matches!(outcome, WaitOutcome::Exited(_)));
}

/// «Напечатал ready и сразу вышел»: ready не теряется.
#[test]
fn ready_then_immediate_exit_still_reports_ready() {
    let (tx, rx) = channel();
    tx.send("fast".to_owned()).unwrap();
    let mut child = FakeChild(Some(Instant::now()));
    let outcome = wait(&rx, &mut child, &AtomicBool::new(false));
    assert!(matches!(outcome, WaitOutcome::Ready(ref u) if u == "fast"));
}

#[test]
fn silence_ends_with_the_deadline() {
    let (_tx, rx) = channel::<String>();
    let outcome = wait_ready_loop(
        &rx,
        &mut FakeChild(None),
        Duration::from_millis(80),
        SLOW_POLL,
        &AtomicBool::new(false),
    );
    assert!(matches!(outcome, WaitOutcome::Deadline));
}
