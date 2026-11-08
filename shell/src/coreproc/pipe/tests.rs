// SPDX-License-Identifier: GPL-3.0-only

//! Тесты читателей пайпов ядра (§4): предел строки, антифлуд, ready.

use std::io::{BufReader, Cursor};
use std::sync::mpsc::channel;

use super::*;

/// Прогнать байты пайпа через читатель до EOF: тексты ring и принятые
/// ready-адреса.
fn run_pipe(bytes: Vec<u8>, rate: usize) -> (Vec<String>, Vec<String>) {
    let ring = Arc::new(Mutex::new(LogRing::with_default_capacity()));
    let (tx, rx) = channel();
    let handle = spawn_pipe_reader(
        Some(Cursor::new(bytes)),
        Arc::clone(&ring),
        rate,
        Some(tx),
        "t",
    )
    .unwrap();
    handle.join().unwrap();
    let texts = ring
        .lock()
        .unwrap()
        .lines()
        .map(|l| l.text.clone())
        .collect();
    (texts, rx.try_iter().collect())
}

const READY: &str = "LAVRAY_CORE_READY ";

/// 1 МБ без перевода строки: в ring одна усечённая строка, не 1 МБ.
#[test]
fn a_megabyte_line_without_newline_is_truncated_not_accumulated() {
    let mut bytes = vec![b'a'; 1 << 20];
    bytes.extend_from_slice(b"\nnext\n");
    let (texts, _) = run_pipe(bytes, 1000);
    assert_eq!(texts.len(), 2);
    assert!(
        texts[0].len() <= MAX_LINE_BYTES + TRUNCATED_MARK.len(),
        "{}",
        texts[0].len()
    );
    assert!(texts[0].ends_with(TRUNCATED_MARK));
    assert_eq!(texts[1], "next", "следующая строка обрабатывается обычно");
}

/// Усечённая ready-строка не принимается; следующая валидная — принимается.
#[test]
fn a_truncated_ready_line_is_not_accepted() {
    let mut bytes = READY.as_bytes().to_vec();
    bytes.extend(std::iter::repeat_n(b'x', 100_000));
    bytes.extend_from_slice(b"\nLAVRAY_CORE_READY ok\n");
    let (texts, ready) = run_pipe(bytes, 1000);
    assert_eq!(ready, ["ok"], "принята только цельная ready-строка");
    assert!(texts[0].ends_with(TRUNCATED_MARK));
}

/// Обрыв ESC/OSC на границе лимита: пометка не «съедается» автоматом.
#[test]
fn a_truncated_osc_keeps_the_mark_and_drops_the_escape() {
    let mut bytes = b"head \x1b]0;".to_vec();
    bytes.extend(std::iter::repeat_n(b'z', 100_000));
    bytes.push(b'\n');
    let (texts, _) = run_pipe(bytes, 1000);
    assert!(texts[0].starts_with("head "));
    assert!(texts[0].ends_with(TRUNCATED_MARK), "{:?}", &texts[0][..20]);
    assert!(!texts[0].contains('\x1b'));
}

/// Invalid UTF-8 и EOF без `\n` не ломают чтение: последняя строка не теряется.
#[test]
fn invalid_utf8_and_eof_without_newline_are_kept() {
    let (texts, _) = run_pipe(b"bad \xff line\r\nlast".to_vec(), 1000);
    assert_eq!(texts, ["bad \u{fffd} line", "last"]);
}

/// Тысячи повторных READY: адрес отдан один раз, в ring они не обходят лимит.
#[test]
fn repeated_ready_lines_do_not_bypass_the_flood_gate() {
    let line = format!("{READY}http://127.0.0.1:1\n");
    let (texts, ready) = run_pipe(line.repeat(5000).into_bytes(), 10);
    assert_eq!(ready.len(), 1, "endpoint отправляется один раз");
    assert!(
        texts.len() < 100,
        "в ring {} строк вместо лимита",
        texts.len()
    );
    assert!(texts[0].starts_with(READY), "первая READY в ring");
}

/// Первая READY проходит даже при заполненном окне антифлуда.
#[test]
fn the_first_ready_passes_even_when_the_window_is_full() {
    let mut bytes = "noise\n".repeat(50).into_bytes();
    bytes.extend_from_slice(format!("{READY}up\n").as_bytes());
    let (texts, ready) = run_pipe(bytes, 5);
    assert_eq!(ready, ["up"]);
    assert_eq!(
        texts.last().map(String::as_str),
        Some("LAVRAY_CORE_READY up")
    );
}

/// Прочитать все строки через `read_bounded_line` с лимитом `max`.
fn read_all(bytes: &[u8], max: usize) -> Vec<(Vec<u8>, bool)> {
    let mut reader = BufReader::with_capacity(16, Cursor::new(bytes.to_vec()));
    let mut out = Vec::new();
    loop {
        let mut buf = Vec::new();
        match read_bounded_line(&mut reader, &mut buf, max).unwrap() {
            LineRead::Eof => return out,
            LineRead::Line { truncated } => {
                assert!(buf.len() <= max, "предел памяти строки: {}", buf.len());
                out.push((buf, truncated));
            }
        }
    }
}

/// Граница: ровно `max` байт — не усечено, `max + 1` — усечено; хвост до `\n`
/// отброшен, следующая строка цела; буфер читателя мал (16 Б) — чанки склеены.
#[test]
fn the_limit_boundary_is_exact() {
    let exact = [vec![b'a'; 100], b"\n".to_vec(), b"tail\n".to_vec()].concat();
    assert_eq!(
        read_all(&exact, 100),
        [(vec![b'a'; 100], false), (b"tail".to_vec(), false)]
    );
    let over = [vec![b'a'; 101], b"\n".to_vec(), b"tail\n".to_vec()].concat();
    assert_eq!(
        read_all(&over, 100),
        [(vec![b'a'; 100], true), (b"tail".to_vec(), false)]
    );
}

#[test]
fn eof_without_newline_returns_the_partial_line_then_eof() {
    assert_eq!(
        read_all(b"one\ntwo", 100),
        [(b"one".to_vec(), false), (b"two".to_vec(), false)]
    );
    assert!(read_all(b"", 100).is_empty());
    assert_eq!(read_all(b"\n\n", 100), [(vec![], false), (vec![], false)]);
}

/// 64 КиБ — боевой лимит: границы тоже точные.
#[test]
fn the_production_limit_is_64_kib() {
    assert_eq!(MAX_LINE_BYTES, 64 * 1024);
    let line = vec![b'q'; MAX_LINE_BYTES + 1];
    let got = read_all(&[line, b"\nx\n".to_vec()].concat(), MAX_LINE_BYTES);
    assert_eq!(got.len(), 2);
    assert!(got[0].1 && got[0].0.len() == MAX_LINE_BYTES);
    assert_eq!(got[1], (b"x".to_vec(), false));
}
