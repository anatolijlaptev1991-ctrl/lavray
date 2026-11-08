// SPDX-License-Identifier: GPL-3.0-only

//! Потоки-читатели stdout/stderr ядра (§4).

use std::io::{self, BufRead, BufReader, Read};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use super::driver::parse_ready_line;
use super::logs::{FloodGate, LogRing};

/// Поток пайпа §4: построчное чтение → антифлуд → ring (ANSI-стриппинг —
/// внутри [`LogRing::push`]); ready-строка §3.4 (только stdout) — в канал.
/// Не-UTF-8 байты заменяются (from_utf8_lossy) — бинарный мусор в пайпе не
/// убивает чтение.
pub fn spawn_pipe_reader<R: Read + Send + 'static>(
    pipe: Option<R>,
    ring: Arc<Mutex<LogRing>>,
    max_per_second: usize,
    mut ready_tx: Option<Sender<String>>,
    thread_name: &'static str,
) -> io::Result<thread::JoinHandle<()>> {
    thread::Builder::new()
        .name(thread_name.to_owned())
        .spawn(move || {
            let Some(pipe) = pipe else { return };
            let mut reader = BufReader::new(pipe);
            let mut gate = FloodGate::new(max_per_second);
            let mut buf = Vec::with_capacity(512);
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) | Err(_) => break, // EOF или разрыв пайпа
                    Ok(_) => {
                        let raw = String::from_utf8_lossy(&buf);
                        let line = raw.trim_end_matches(['\n', '\r']);
                        if line.is_empty() {
                            continue;
                        }
                        // Ready-строка идёт в канал ВСЕГДА — антифлуд её не
                        // касается (иначе шумный лог проглотил бы готовность).
                        let is_ready = parse_ready_line(line).is_some();
                        // D6 (ревью): сначала пуш в ring, потом send — иначе
                        // log_tail может не увидеть ready-строку (гонка).
                        let now_ms = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map_or(0, |d| d.as_millis());
                        if gate.allow(now_ms) || is_ready {
                            match ring.lock() {
                                Ok(mut ring) => {
                                    ring.push(line);
                                }
                                Err(poisoned) => {
                                    poisoned.into_inner().push(line);
                                }
                            }
                        }
                        if is_ready {
                            if let (Some(url), Some(tx)) = (parse_ready_line(line), ready_tx.take())
                            {
                                let _ = tx.send(url.to_owned());
                            }
                        }
                    }
                }
            }
        })
}
