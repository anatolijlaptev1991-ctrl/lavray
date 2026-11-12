// SPDX-License-Identifier: GPL-3.0-only

//! Тестовый дочерний процесс — сам тестовый бинарник: тест `child_main`
//! без переменной окружения ничего не делает, с ней — ведёт себя как
//! запрошено. Ядро `LAVRay` не запускается. К stdout примешивается заголовок
//! тестового harness, поэтому ответ ищется как подстрока.

use super::*;

const MODE: &str = "LAVRAY_PROC_RUN_MODE";
const MARK: &[u8] = b"{\"version\":\"1.2.3\"}";

/// Роль дочернего процесса; в обычном прогоне не делает ничего.
#[test]
fn child_main() {
    use std::io::Write;
    let Ok(mode) = std::env::var(MODE) else {
        return;
    };
    let mut out = std::io::stdout();
    match mode.as_str() {
        "short" => out.write_all(MARK).unwrap(),
        "big" => {
            // заведомо больше буфера пайпа (64 КиБ на Linux, 4 КиБ на Windows)
            out.write_all(&vec![b'x'; 1 << 20]).unwrap();
            out.write_all(MARK).unwrap();
        }
        "endless" => loop {
            if out.write_all(&[b'y'; 4096]).is_err() {
                return;
            }
        },
        "hang" => std::thread::sleep(Duration::from_mins(1)),
        other => panic!("неизвестный режим {other}"),
    }
    out.flush().unwrap();
}

fn child(mode: &str) -> Command {
    let mut c = Command::new(std::env::current_exe().unwrap());
    c.args([
        "update::proc_run::tests::child_main",
        "--exact",
        "--nocapture",
        "--test-threads=1",
    ])
    .env(MODE, mode);
    c
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

#[test]
fn short_reply_is_returned_in_full() {
    let out = run_bounded(child("short"), Duration::from_secs(30), 4096).unwrap();
    assert!(out.success);
    assert!(contains(&out.stdout, MARK));
}

#[test]
fn output_larger_than_the_pipe_buffer_does_not_hang() {
    let started = Instant::now();
    let out = run_bounded(child("big"), Duration::from_secs(30), 4 << 20).unwrap();
    assert!(out.success);
    assert!(out.stdout.len() > 1 << 20);
    assert!(contains(&out.stdout, MARK));
    assert!(
        started.elapsed() < Duration::from_secs(25),
        "не ждали таймаут"
    );
}

#[test]
fn output_over_the_limit_is_an_invalid_reply() {
    let out = run_bounded(child("big"), Duration::from_secs(30), 4096).unwrap();
    assert!(!out.success, "превышение — неверный ответ");
    assert!(out.stdout.is_empty());
}

#[test]
fn endless_output_is_cut_off_and_the_child_killed() {
    let started = Instant::now();
    let out = run_bounded(child("endless"), Duration::from_secs(30), 4096).unwrap();
    assert!(!out.success && out.stdout.is_empty());
    assert!(started.elapsed() < Duration::from_secs(25));
}

#[test]
fn a_hung_child_is_killed_on_timeout() {
    let started = Instant::now();
    let err = run_bounded(child("hang"), Duration::from_millis(500), 4096)
        .err()
        .expect("таймаут");
    assert_eq!(err.kind(), io::ErrorKind::TimedOut);
    assert!(started.elapsed() < Duration::from_secs(20));
}
