// SPDX-License-Identifier: GPL-3.0-only

//! Ожидание ready-строки ядра (§3.4).

use std::io;
use std::process::ExitStatus;
use std::sync::mpsc::{Receiver, TryRecvError};
use std::thread;
use std::time::{Duration, Instant};

use super::reap::ChildHandle;

/// Grace после обнаружения раннего exit: дать потоку-читателю допрочитать
/// хвост stdout — ядро могло напечатать ready-строку и тут же умереть.
pub const READY_FLUSH_GRACE: Duration = Duration::from_millis(200);

/// Исход ожидания ready (внутренний, чтобы обойти заимствования `running`).
pub enum WaitOutcome {
    Ready(String),
    Exited(ExitStatus),
    Deadline,
    Poll(io::Error),
}

/// Цикл §3.4: канал ready-строки + ранний exit + дедлайн.
pub fn wait_ready_loop<C: ChildHandle>(
    ready_rx: &Receiver<String>,
    child: &mut C,
    budget: Duration,
    poll: Duration,
) -> WaitOutcome {
    let deadline = Instant::now() + budget;
    loop {
        // Ready-строка первая: она могла прийти раньше, чем заметен exit.
        match ready_rx.try_recv() {
            Ok(url) => return WaitOutcome::Ready(url),
            Err(TryRecvError::Empty) => {}
            // stdout закрыт без ready-строки: ниже поймаем exit либо таймаут.
            Err(TryRecvError::Disconnected) => {}
        }
        match child.poll_exit() {
            Ok(Some(status)) => {
                // Гонка «ready напечатан и сразу exit»: даём читателю
                // допрочитать хвост пайпа перед вердиктом.
                let grace = deadline
                    .saturating_duration_since(Instant::now())
                    .min(READY_FLUSH_GRACE);
                if let Ok(url) = ready_rx.recv_timeout(grace) {
                    return WaitOutcome::Ready(url);
                }
                return WaitOutcome::Exited(status);
            }
            Ok(None) => {}
            Err(err) => return WaitOutcome::Poll(err),
        }
        if Instant::now() >= deadline {
            return WaitOutcome::Deadline;
        }
        thread::sleep(poll);
    }
}
