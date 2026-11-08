// SPDX-License-Identifier: GPL-3.0-only

//! Ожидание ready-строки ядра (§3.4).
//!
//! Цикл спит на `recv_timeout(min(poll, остаток))`: ready-строка доставляется
//! сразу, а не на очередном опросе; каждые `poll` проверяются отмена (флаг
//! общий с `SupervisorHandle`, Stop не ждёт весь бюджет) и состояние процесса.

use std::io;
use std::process::ExitStatus;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use super::reap::{wait_exit_until, ChildHandle};

/// Grace после обнаружения раннего exit: дать потоку-читателю допрочитать
/// хвост stdout — ядро могло напечатать ready-строку и тут же умереть.
pub const READY_FLUSH_GRACE: Duration = Duration::from_millis(200);

/// Исход ожидания ready (внутренний, чтобы обойти заимствования `running`).
#[derive(Debug)]
pub enum WaitOutcome {
    Ready(String),
    Exited(ExitStatus),
    Deadline,
    Poll(io::Error),
    /// stdout закрыт без ready-строки, а процесс ещё жив (очередь выбрана).
    ChannelClosed,
    /// Пришёл Stop: ожидание прервано до готовности.
    Cancelled,
}

/// Цикл §3.4: канал ready-строки + отмена + ранний exit + дедлайн.
pub fn wait_ready_loop<C: ChildHandle>(
    ready_rx: &Receiver<String>,
    child: &mut C,
    budget: Duration,
    poll: Duration,
    cancel: &AtomicBool,
) -> WaitOutcome {
    let deadline = Instant::now() + budget;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return WaitOutcome::Cancelled;
        }
        match child.poll_exit() {
            Ok(Some(status)) => return after_exit(ready_rx, status, deadline),
            Ok(None) => {}
            Err(err) => return WaitOutcome::Poll(err),
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return WaitOutcome::Deadline;
        }
        match ready_rx.recv_timeout(poll.min(remaining)) {
            Ok(url) => return WaitOutcome::Ready(url),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                return after_close(child, deadline, poll);
            }
        }
    }
}

/// Гонка «ready напечатан и сразу exit»: даём читателю допрочитать хвост
/// пайпа перед вердиктом.
fn after_exit(ready_rx: &Receiver<String>, status: ExitStatus, deadline: Instant) -> WaitOutcome {
    let grace = deadline
        .saturating_duration_since(Instant::now())
        .min(READY_FLUSH_GRACE);
    match ready_rx.recv_timeout(grace) {
        Ok(url) => WaitOutcome::Ready(url),
        Err(_) => WaitOutcome::Exited(status),
    }
}

/// stdout закрылся без ready: коротко ждём статус выхода (закрытие пайпа
/// обычно и есть смерть процесса), иначе — отдельный исход без ожидания
/// всего бюджета.
fn after_close<C: ChildHandle>(child: &mut C, deadline: Instant, poll: Duration) -> WaitOutcome {
    let until = deadline.min(Instant::now() + READY_FLUSH_GRACE);
    match wait_exit_until(child, until, poll.min(Duration::from_millis(10))) {
        Some(status) => WaitOutcome::Exited(status),
        None => WaitOutcome::ChannelClosed,
    }
}

#[cfg(test)]
mod tests;
