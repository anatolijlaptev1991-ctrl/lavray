// SPDX-License-Identifier: GPL-3.0-only

//! Ожидание выхода процесса ядра и его reap (§5).
//!
//! Общие примитивы драйвера: неблокирующее ожидание до дедлайна, добивание
//! процесса на пути ошибки spawn. Процесс сведён к трейту [`ChildHandle`],
//! чтобы дедлайны лестницы проверялись без реального ребёнка.

use std::io;
use std::process::{Child, ExitStatus};
use std::thread;
use std::time::{Duration, Instant};

/// Минимум, который драйверу нужен от процесса: опрос и (блокирующий) reap.
pub trait ChildHandle {
    /// Неблокирующий опрос: `Some` — процесс завершён.
    fn poll_exit(&mut self) -> io::Result<Option<ExitStatus>>;
    /// Блокирующее ожидание выхода (reap).
    fn wait_exit(&mut self) -> io::Result<ExitStatus>;
}

impl ChildHandle for Child {
    fn poll_exit(&mut self) -> io::Result<Option<ExitStatus>> {
        self.try_wait()
    }

    fn wait_exit(&mut self) -> io::Result<ExitStatus> {
        self.wait()
    }
}

/// Ждать выхода до `deadline` (неблокирующе, шагами `poll`); `None` — жив.
pub fn wait_exit_until<C: ChildHandle>(
    child: &mut C,
    deadline: Instant,
    poll: Duration,
) -> Option<ExitStatus> {
    loop {
        match child.poll_exit() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => {}
            // Статус не читается — шансов дождаться нет (ошибка waitpid).
            Err(_) => return None,
        }
        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(poll);
    }
}

/// Ликвидация уже созданного процесса на пути ошибки spawn: kill + reap,
/// чтобы неудавшийся spawn не оставлял сироту (§1 — сироты невозможны).
/// `kill()` здесь — разовый сигнал лидеру (Unix SIGKILL / Windows
/// TerminateProcess); при уже завершившемся процессе ошибка игнорируется.
pub fn abort_child(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait_exit();
}

/// Исход финального ожидания после force-kill.
#[derive(Debug, PartialEq, Eq)]
pub enum Reaped {
    /// Процесс завершился в срок, статус получен.
    Exited(ExitStatus),
    /// Срок вышел: reap передан отдельному потоку, supervisor не ждёт.
    HandedOff,
}

/// Дождаться выхода до `deadline`; по истечении срока НЕ блокироваться на
/// `wait()` вечно, но и не оставлять zombie: процесс уходит в отдельный
/// поток-reaper (`wait_exit` там блокирует только его). Если поток создать
/// не удалось, `child` дропается (std не ждёт на drop; зомби-запись живёт до
/// выхода оболочки — лучше, чем вечный стоп), результат тот же — `HandedOff`.
pub fn reap_or_hand_off<C: ChildHandle + Send + 'static>(
    mut child: C,
    deadline: Instant,
    poll: Duration,
) -> Reaped {
    if let Some(status) = wait_exit_until(&mut child, deadline, poll) {
        return Reaped::Exited(status);
    }
    let _ = thread::Builder::new()
        .name("lavray-core-reaper".to_owned())
        .spawn(move || {
            let _ = child.wait_exit();
        });
    Reaped::HandedOff
}

#[cfg(test)]
mod tests;
