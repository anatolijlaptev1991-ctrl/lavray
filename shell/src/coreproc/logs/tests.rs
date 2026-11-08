// SPDX-License-Identifier: GPL-3.0-only

//! Тесты пайпа логов ядра (§4).

use super::*;

#[test]
fn ring_keeps_last_capacity_lines_and_monotonic_seq() {
    let mut ring = LogRing::new(3);
    for i in 0..5 {
        ring.push(&format!("line-{i}"));
    }
    assert_eq!(ring.len(), 3);
    let texts: Vec<&str> = ring.lines().map(|l| l.text.as_str()).collect();
    assert_eq!(texts, vec!["line-2", "line-3", "line-4"]);
    let seqs: Vec<u64> = ring.lines().map(|l| l.seq).collect();
    assert_eq!(seqs, vec![2, 3, 4], "seq не сбрасывается при вытеснении");
    assert_eq!(ring.last().unwrap().text, "line-4");
    assert!(!ring.is_empty());
    assert_eq!(ring.capacity(), 3);
}

#[test]
fn default_capacity_is_two_hundred() {
    let mut ring = LogRing::with_default_capacity();
    for i in 0..(RING_CAPACITY + 50) {
        ring.push(&format!("p{i}"));
    }
    assert_eq!(ring.len(), RING_CAPACITY);
    assert_eq!(
        ring.lines().next().unwrap().seq,
        50,
        "старейшая строка вытеснена"
    );
}

#[test]
fn tail_returns_last_n_in_order() {
    let mut ring = LogRing::new(10);
    for i in 0..10 {
        ring.push(&format!("l{i}"));
    }
    let tail: Vec<&str> = ring.tail(3).map(|l| l.text.as_str()).collect();
    assert_eq!(tail, vec!["l7", "l8", "l9"]);
}

#[test]
fn push_strips_ansi() {
    let mut ring = LogRing::with_default_capacity();
    ring.push("\x1b[31mERR\x1b[0m proxy \x1b[1;32mup\x1b[0m");
    assert_eq!(ring.last().unwrap().text, "ERR proxy up");
}

#[test]
fn strip_ansi_variants() {
    // CSI с параметрами.
    assert_eq!(strip_ansi("\x1b[2Kdone"), "done");
    // OSC с BEL (заголовок терминала).
    assert_eq!(strip_ansi("a\x1b]0;title\x07b"), "ab");
    // OSC со ST (ESC \).
    assert_eq!(
        strip_ansi("a\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\b"),
        "alinkb"
    );
    // Двухсимвольная ESC-последовательность.
    assert_eq!(strip_ansi("x\x1bMy"), "xy");
    // Трёхсимвольные ECMA-48 c промежуточным байтом 0x20–0x2F:
    // финальный байт съедается.
    assert_eq!(strip_ansi("x\x1b(By"), "xy", "ESC ( B — выбор charset");
    assert_eq!(strip_ansi("x\x1b#8y"), "xy", "ESC # 8 — DECALN");
    assert_eq!(strip_ansi("x\x1b%Gy"), "xy", "ESC % G — выбор кодировки");
    // Несколько промежуточных байтов — тоже валидная последовательность.
    assert_eq!(strip_ansi("x\x1b(0\x1b(By"), "xy");
    // Незакрытая последовательность не теряет данные молча — её нет.
    assert_eq!(strip_ansi("ok"), "ok");
}

#[test]
fn flood_gate_limits_sliding_window() {
    let mut gate = FloodGate::new(3);
    assert!(gate.allow(0));
    assert!(gate.allow(100));
    assert!(gate.allow(200));
    assert!(!gate.allow(300), "лимит 3 в скользящую секунду превышен");
    assert!(!gate.allow(999));
    // Метка t=0 покидает окно (1000−0 ≥ 1000) — снова можно.
    assert!(gate.allow(1000));
    assert_eq!(gate.max_per_second(), 3);
}

/// Стык секунд: 6 строк на границе (3 + 3) при max 3/с — tumbling-окно
/// пропустило бы все шесть, скользящее режет лишние и отпускает по мере
/// вытеснения старых меток.
#[test]
fn flood_gate_sliding_window_at_second_boundary() {
    let mut gate = FloodGate::new(3);
    // Три строки в конце первой секунды.
    assert!(gate.allow(700));
    assert!(gate.allow(800));
    assert!(gate.allow(900));
    // Три строки в начале второй секунды: 700/800/900 всё ещё в окне
    // (в скользящей секунде уже есть 3 строки) — режем.
    assert!(!gate.allow(1000));
    assert!(!gate.allow(1100));
    assert!(!gate.allow(1200));
    // К t=1700 метка 700 вытеснена (1700−700 ≥ 1000) — окно освободилось.
    assert!(gate.allow(1700));
    assert!(!gate.allow(1750), "снова 3 строки в окне (800/900/1700)");
}

/// Эталон: прежняя реализация (посимвольный автомат без быстрого пути),
/// скопированная дословно, — новая обязана давать тот же результат.
fn strip_ansi_old(input: &str) -> String {
    #[derive(Clone, Copy, PartialEq)]
    enum S {
        Ground,
        Esc,
        EscInter,
        Csi,
        Osc,
        OscEsc,
    }
    let mut state = S::Ground;
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match state {
            S::Ground if ch == '\x1b' => state = S::Esc,
            S::Ground => out.push(ch),
            S::Esc => {
                state = match ch {
                    '[' => S::Csi,
                    ']' => S::Osc,
                    '\x20'..='\x2f' => S::EscInter,
                    _ => S::Ground,
                }
            }
            S::EscInter => {
                if !matches!(ch, '\x20'..='\x2f') {
                    state = S::Ground;
                }
            }
            S::Csi => {
                if matches!(ch, '\x40'..='\x7e') {
                    state = S::Ground;
                }
            }
            S::Osc => match ch {
                '\x07' => state = S::Ground,
                '\x1b' => state = S::OscEsc,
                _ => {}
            },
            S::OscEsc => state = if ch == '\\' { S::Ground } else { S::Osc },
        }
    }
    out
}

/// Набор строк: обычный текст, Unicode, CSI/OSC/ECMA-48, обрезанные
/// последовательности, invalid UTF-8 (после `from_utf8_lossy`, как в читателе).
fn corpus() -> Vec<String> {
    let mut lines: Vec<String> = [
        "",
        "plain text",
        "юникод: привет, мир ✓ 日本語 🦀",
        "\x1b[31mred\x1b[0m и \x1b[1;32mзелёный\x1b[0m",
        "a\x1b]0;заголовок\x07b",
        "a\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\b",
        "x\x1b(By\x1b#8z\x1b%Gw\x1b(0\x1b(Bq",
        "x\x1bMy",
        "обрыв CSI \x1b[31",
        "обрыв OSC \x1b]0;title",
        "обрыв ESC \x1b",
        "ESC в конце OSC \x1b]0;t\x1b",
        "\x1b\x1b[2Kдвойной ESC",
        "🦀\x1b[0m🦀\x1b[K🦀",
    ]
    .map(str::to_owned)
    .to_vec();
    for raw in [&b"bad \xff\xfe utf8"[..], b"\x1b[3\xffmx", b"tail \xe2\x82"] {
        lines.push(String::from_utf8_lossy(raw).into_owned());
    }
    lines
}

#[test]
fn strip_ansi_into_matches_the_old_implementation() {
    for line in corpus() {
        assert_eq!(strip_ansi_old(&line), strip_ansi(&line), "{line:?}");
        let mut out = String::from("префикс|");
        strip_ansi_into(&line, &mut out);
        assert_eq!(
            out,
            format!("префикс|{}", strip_ansi_old(&line)),
            "{line:?}"
        );
    }
}

/// Тот же набор строк, много кругов (вытеснение): seq, порядок, тексты и
/// `tail(n)` совпадают с прежней моделью `push` (новая `String` на строку).
#[test]
fn push_reusing_matches_the_old_ring_model() {
    let cap = 7;
    let mut ring = LogRing::new(cap);
    let mut model: std::collections::VecDeque<(u64, String)> = Default::default();
    let mut work = String::new();
    let mut seq = 0u64;
    for round in 0..40 {
        for line in corpus() {
            work.clear();
            strip_ansi_into(&line, &mut work);
            assert_eq!(ring.push_reusing(&mut work), seq, "раунд {round}");
            if model.len() == cap {
                model.pop_front();
            }
            model.push_back((seq, strip_ansi_old(&line)));
            seq += 1;
        }
    }
    let got: Vec<(u64, &str)> = ring.lines().map(|l| (l.seq, l.text.as_str())).collect();
    let want: Vec<(u64, &str)> = model.iter().map(|(s, t)| (*s, t.as_str())).collect();
    assert_eq!(got, want);
    for n in [0, 1, 3, cap, cap + 5] {
        let tail: Vec<u64> = ring.tail(n).map(|l| l.seq).collect();
        let expected: Vec<u64> = model.iter().rev().take(n).rev().map(|(s, _)| *s).collect();
        assert_eq!(tail, expected, "tail({n})");
    }
}

/// Устоявшийся режим не растит буферы, пока строки помещаются в уже
/// выделенное.
#[test]
fn push_reusing_keeps_buffers_in_steady_state() {
    let mut ring = LogRing::new(4);
    let mut work = String::new();
    let long = "x".repeat(300);
    for _ in 0..(2 * 4 + 2) {
        work.clear();
        work.push_str(&long);
        ring.push_reusing(&mut work);
    }
    for i in 0..50 {
        work.clear();
        work.push_str(&long[..(i * 5) % 300]);
        ring.push_reusing(&mut work);
    }
    let caps: Vec<usize> = ring.lines().map(|l| l.text.capacity()).collect();
    assert!(caps.iter().all(|&c| c >= 300), "{caps:?}");
    assert!(work.capacity() >= 300, "рабочий буфер тоже не потерян");
}

/// Контракт лимита — на пайп: два независимых FloodGate пропускают до
/// `2 × max` за секунду, один пайп — ровно `max`.
#[test]
fn flood_gate_limit_is_per_pipe() {
    let (mut stdout, mut stderr) = (FloodGate::new(5), FloodGate::new(5));
    let out = (0..20).filter(|_| stdout.allow(10)).count();
    assert_eq!(out, 5, "один активный пайп ограничен max_per_second");
    let both = out + (0..20).filter(|_| stderr.allow(10)).count();
    assert_eq!(both, 10, "два пайпа: до 2 × max_per_second суммарно");
}

#[test]
fn flood_gate_preallocates_window_with_a_ceiling() {
    let mut gate = FloodGate::new(1000);
    let cap = gate.window.capacity();
    assert!(cap >= 1000);
    for t in 0..1000 {
        assert!(gate.allow(t));
    }
    assert_eq!(gate.window.capacity(), cap, "без realloc на полном окне");
    let huge = FloodGate::new(usize::MAX);
    assert!(huge.window.capacity() <= 8192, "потолок предвыделения");
}
