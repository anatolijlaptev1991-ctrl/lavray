// SPDX-License-Identifier: GPL-3.0-only

//! Запуск внешней программы с ограничением по времени. Нужен Linux-коду
//! (gsettings, gdbus, zenity, pkexec): зависший вызов не должен подвешивать
//! оболочку. Новых крейтов нет — опрос `try_wait` и потоки чтения пайпов.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Сколько вывода программы читаем, байт: больше законному ответу не нужно.
const MAX_OUTPUT: u64 = 1 << 20;
/// Сколько ждать конец потока вывода после выхода процесса: пайп мог
/// унаследовать внук, и тогда конца не будет.
const DRAIN: Duration = Duration::from_millis(300);
/// Период опроса завершения процесса.
const POLL: Duration = Duration::from_millis(10);

/// Итог запуска: код возврата и вывод (UTF-8 с заменой нечитаемых байт).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    /// Код выхода; `None` — процесс убит сигналом.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl Output {
    #[must_use]
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }
}

/// Читатель пайпа: накопленное лежит в общем буфере, поэтому его можно забрать,
/// не дожидаясь конца потока (внук мог унаследовать пайп и держать его).
struct Reader {
    buf: Arc<Mutex<Vec<u8>>>,
    thread: std::thread::JoinHandle<()>,
}

fn reader<R: Read + Send + 'static>(pipe: Option<R>) -> Option<Reader> {
    let mut pipe = pipe?.take(MAX_OUTPUT);
    let buf = Arc::new(Mutex::new(Vec::new()));
    let shared = Arc::clone(&buf);
    let thread = std::thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        while let Ok(n @ 1..) = pipe.read(&mut chunk) {
            let mut guard = shared
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            guard.extend_from_slice(&chunk[..n]);
        }
    });
    Some(Reader { buf, thread })
}

/// Забрать прочитанное; конца потока ждём не дольше [`DRAIN`] после выхода процесса.
fn collect(reader: Option<Reader>) -> String {
    let Some(reader) = reader else {
        return String::new();
    };
    let deadline = Instant::now() + DRAIN;
    while !reader.thread.is_finished() && Instant::now() < deadline {
        std::thread::sleep(POLL);
    }
    let bytes = reader
        .buf
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Запустить `cmd` (stdin закрыт) и дождаться выхода не дольше `limit`. По
/// истечении процесс убивается, ответ — `Err`.
pub fn run_timeout(cmd: &mut Command, limit: Duration) -> Result<Output, String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let (out, err) = (reader(child.stdout.take()), reader(child.stderr.take()));
    let deadline = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("нет ответа за {} с", limit.as_secs_f32()));
            }
            Ok(None) => std::thread::sleep(POLL),
            Err(e) => return Err(e.to_string()),
        }
    };
    Ok(Output {
        code: status.code(),
        stdout: collect(out),
        stderr: collect(err),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Команда оболочки ОС: `sh -c` / `cmd /C`.
    fn shell(script: &str) -> Command {
        let (program, flag) = if cfg!(windows) {
            ("cmd", "/C")
        } else {
            ("sh", "-c")
        };
        let mut cmd = Command::new(program);
        cmd.args([flag, script]);
        cmd
    }

    #[test]
    fn collects_output_and_code() {
        let out = run_timeout(&mut shell("echo hello"), Duration::from_secs(10)).unwrap();
        assert!(out.success());
        assert_eq!(out.stdout.trim(), "hello");
    }

    #[test]
    fn non_zero_code_is_reported() {
        let out = run_timeout(&mut shell("exit 3"), Duration::from_secs(10)).unwrap();
        assert_eq!(out.code, Some(3));
        assert!(!out.success());
    }

    #[test]
    fn slow_process_is_killed_on_timeout() {
        let script = if cfg!(windows) {
            "ping -n 20 127.0.0.1 >nul"
        } else {
            "sleep 20"
        };
        let started = Instant::now();
        let result = run_timeout(&mut shell(script), Duration::from_millis(200));
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    /// Внук держит пайп после выхода родителя: вернуть прочитанное, а не висеть.
    #[test]
    fn a_grandchild_holding_the_pipe_does_not_hang_the_call() {
        let script = if cfg!(windows) {
            "echo first & start /b ping -n 20 127.0.0.1 >nul"
        } else {
            "echo first; sleep 20 &"
        };
        let started = Instant::now();
        let out = run_timeout(&mut shell(script), Duration::from_secs(10)).unwrap();
        assert!(out.stdout.contains("first"));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn missing_program_is_an_error() {
        let mut cmd = Command::new("lavray-no-such-program-xyz");
        assert!(run_timeout(&mut cmd, Duration::from_secs(1)).is_err());
    }
}
