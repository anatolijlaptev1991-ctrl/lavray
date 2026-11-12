// SPDX-License-Identifier: GPL-3.0-only

//! Потоки-читатели stdout/stderr ядра (§4).
//!
//! Физическая строка пайпа ограничена [`MAX_LINE_BYTES`]: ядро без `\n` не
//! может раздуть память оболочки. Слишком длинная строка кладётся в ring
//! усечённой (с пометкой [`TRUNCATED_MARK`]), хвост до `\n` отбрасывается без
//! накопления. Усечённая ready-строка не принимается.

use std::io::{self, BufRead, BufReader, Read};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::Instant;

use super::driver::parse_ready_line;
use super::logs::{strip_ansi_into, FloodGate, LogRing};

/// Верхняя граница физической строки stdout/stderr ядра, байт.
pub const MAX_LINE_BYTES: usize = 64 * 1024;
/// Пометка усечённой строки в ring (дописывается ПОСЛЕ очистки ANSI).
pub const TRUNCATED_MARK: &str = " …[строка усечена]";

/// Результат чтения одной физической строки.
#[derive(Debug, PartialEq, Eq)]
pub enum LineRead {
    /// Конец потока, ни одного нового байта.
    Eof,
    /// Строка прочитана (без `\n`); `truncated` — хвост свыше лимита отброшен.
    Line { truncated: bool },
}

/// Прочитать физическую строку в `buf` (дописывает; не больше `max` байт),
/// остаток до `\n` пропустить без накопления. EOF без `\n` отдаёт
/// накопленное как последнюю строку.
pub fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    buf: &mut Vec<u8>,
    max: usize,
) -> io::Result<LineRead> {
    let (mut seen, mut truncated) = (false, false);
    loop {
        let chunk = match reader.fill_buf() {
            Ok(chunk) => chunk,
            Err(err) if err.kind() == io::ErrorKind::Interrupted => continue,
            Err(err) => return Err(err),
        };
        if chunk.is_empty() {
            return Ok(if seen {
                LineRead::Line { truncated }
            } else {
                LineRead::Eof
            });
        }
        seen = true;
        let newline = memchr::memchr(b'\n', chunk);
        let body = newline.unwrap_or(chunk.len());
        let take = body.min(max.saturating_sub(buf.len()));
        buf.extend_from_slice(&chunk[..take]);
        truncated |= take < body;
        reader.consume(body + usize::from(newline.is_some()));
        if newline.is_some() {
            return Ok(LineRead::Line { truncated });
        }
    }
}

/// Состояние одного читателя: свой антифлуд, монотонные часы, канал ready и
/// рабочий буфер очистки ANSI (читатели им не делятся).
struct PipeState {
    gate: FloodGate,
    started: Instant,
    ready_tx: Option<Sender<String>>,
    work: String,
}

impl PipeState {
    /// Одна строка пайпа: антифлуд → ring; первая ready-строка — в канал.
    fn handle(&mut self, ring: &Mutex<LogRing>, raw: &[u8], truncated: bool) {
        let text = String::from_utf8_lossy(raw);
        let line = text.trim_end_matches('\r');
        if line.is_empty() && !truncated {
            return;
        }
        let ready_url = if truncated {
            None
        } else {
            parse_ready_line(line)
        };
        // Антифлуд обходит только ПЕРВАЯ ready-строка (пока канал не отдан):
        // повторные — обычные логи, иначе они забили бы ring мимо лимита.
        let first_ready = ready_url.is_some() && self.ready_tx.is_some();
        let allowed = self.gate.allow(self.started.elapsed().as_millis() as u64);
        if allowed || first_ready {
            self.push(ring, line, truncated);
        }
        // D6 (ревью): сначала пуш в ring, потом send — иначе log_tail может
        // не увидеть ready-строку (гонка).
        if let (true, Some(url)) = (first_ready, ready_url) {
            if let Some(tx) = self.ready_tx.take() {
                let _ = tx.send(url.to_owned());
            }
        }
    }

    /// Очистка ANSI в рабочем буфере вне мьютекса, под замком — только swap.
    fn push(&mut self, ring: &Mutex<LogRing>, line: &str, truncated: bool) {
        self.work.clear();
        strip_ansi_into(line, &mut self.work);
        if truncated {
            self.work.push_str(TRUNCATED_MARK);
        }
        let mut ring = ring.lock().unwrap_or_else(PoisonError::into_inner);
        ring.push_reusing(&mut self.work);
    }
}

/// Поток пайпа §4: построчное чтение (строка ≤ [`MAX_LINE_BYTES`]) →
/// антифлуд → ring; ready-строка §3.4 (только stdout) — в канал. Не-UTF-8
/// байты заменяются (`from_utf8_lossy`) — бинарный мусор в пайпе не убивает
/// чтение. Лимит антифлуда действует НА ПАЙП (см. [`FloodGate`]).
pub fn spawn_pipe_reader<R: Read + Send + 'static>(
    pipe: Option<R>,
    ring: Arc<Mutex<LogRing>>,
    max_per_second: usize,
    ready_tx: Option<Sender<String>>,
    thread_name: &'static str,
) -> io::Result<thread::JoinHandle<()>> {
    thread::Builder::new()
        .name(thread_name.to_owned())
        .spawn(move || {
            let Some(pipe) = pipe else { return };
            let mut reader = BufReader::new(pipe);
            let mut state = PipeState {
                gate: FloodGate::new(max_per_second),
                started: Instant::now(),
                ready_tx,
                work: String::with_capacity(512),
            };
            let mut buf = Vec::with_capacity(512);
            loop {
                buf.clear();
                match read_bounded_line(&mut reader, &mut buf, MAX_LINE_BYTES) {
                    Ok(LineRead::Line { truncated }) => state.handle(&ring, &buf, truncated),
                    Ok(LineRead::Eof) | Err(_) => break, // EOF или разрыв пайпа
                }
            }
        })
}

#[cfg(test)]
mod tests;
