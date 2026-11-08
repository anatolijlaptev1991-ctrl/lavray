// SPDX-License-Identifier: GPL-3.0-only

//! Запуск внешней программы с ограничением на время и на объём stdout.
//!
//! Stdout читается сразу, в отдельном потоке, через [`Read::take`] на
//! `предел + 1` байт: процесс, который пишет больше размера канала, не
//! зависает на полном пайпе, а бесконечный вывод не раздувает память.
//! Превышение предела — неверный ответ (`success = false`, пустой stdout),
//! процесс при этом убивается. По таймауту: kill, wait и join потока чтения.

use super::core_verify::RunOutput;
use std::io::{self, Read};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Шаг опроса завершения процесса.
const POLL: Duration = Duration::from_millis(50);

/// Поток чтения stdout: байты (не больше предела) и признак превышения.
struct Reader {
    handle: JoinHandle<io::Result<Vec<u8>>>,
    overflow: Arc<AtomicBool>,
}

fn spawn_reader(mut pipe: impl Read + Send + 'static, max: u64) -> Reader {
    let overflow = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&overflow);
    let handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        (&mut pipe)
            .take(max.saturating_add(1))
            .read_to_end(&mut buf)?;
        if buf.len() as u64 > max {
            flag.store(true, Ordering::SeqCst);
        }
        Ok(buf)
    });
    Reader { handle, overflow }
}

/// Остановить процесс и дождаться потока чтения.
fn abort(child: &mut Child, reader: Reader) {
    let _ = child.kill();
    let _ = child.wait();
    let _ = reader.handle.join();
}

/// Неверный ответ: код «неуспех» и пустой stdout.
fn invalid() -> RunOutput {
    RunOutput {
        success: false,
        stdout: Vec::new(),
    }
}

/// Запустить `command` (stdin и stderr закрыты), ждать не дольше `timeout`,
/// stdout — не больше `max_stdout` байт.
pub fn run_bounded(
    mut command: Command,
    timeout: Duration,
    max_stdout: u64,
) -> io::Result<RunOutput> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn()?;
    let Some(pipe) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(io::Error::other("нет канала stdout"));
    };
    let reader = spawn_reader(pipe, max_stdout);
    let deadline = Instant::now() + timeout;
    loop {
        if reader.overflow.load(Ordering::SeqCst) {
            abort(&mut child, reader);
            return Ok(invalid());
        }
        match child.try_wait() {
            Ok(Some(status)) => return finish(status.success(), reader),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(POLL),
            Ok(None) => {
                abort(&mut child, reader);
                return Err(io::Error::from(io::ErrorKind::TimedOut));
            }
            Err(e) => {
                abort(&mut child, reader);
                return Err(e);
            }
        }
    }
}

/// Процесс вышел: забрать прочитанное; превышение предела — неверный ответ.
fn finish(success: bool, reader: Reader) -> io::Result<RunOutput> {
    let overflow = Arc::clone(&reader.overflow);
    let stdout = reader
        .handle
        .join()
        .map_err(|_| io::Error::other("поток чтения упал"))??;
    if overflow.load(Ordering::SeqCst) {
        return Ok(invalid());
    }
    Ok(RunOutput { success, stdout })
}

#[cfg(test)]
mod tests;
