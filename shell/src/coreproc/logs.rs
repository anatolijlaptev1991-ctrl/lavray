//! Пайп логов ядра (§4).
//!
//! stdout/stderr ядра читаются построчно → ring на 200 строк (пост-мортем
//! диагностика Crashed, LNB-21/U-04); VT100/ANSI вырезается; антифлуд —
//! окно в `max_per_second` строк/с (значение — конфигурируемое, спеком не
//! зафиксировано). Рабочий журнал идёт через LogService ядра (§4), строки
//! оболочки в ядро НЕ форвардятся (Р2-43).

use std::collections::VecDeque;

/// Ёмкость ring-буфера диагностических строк (§4: «ring 200 строк»).
pub const RING_CAPACITY: usize = 200;

/// Одна строка пайпа ядра с порядковым номером.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogLine {
    /// Монотонный номер строки (не сбрасывается при вытеснении).
    pub seq: u64,
    /// Текст без ANSI/VT100-управляющих последовательностей.
    pub text: String,
}

/// Ring-буфер последних строк stdout/stderr ядра.
#[derive(Debug)]
pub struct LogRing {
    capacity: usize,
    lines: VecDeque<LogLine>,
    next_seq: u64,
}

impl LogRing {
    /// Новый ring на `capacity` строк (`capacity ≥ 1`).
    ///
    /// # Panics
    /// Паникует при `capacity == 0`.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "LogRing capacity must be positive");
        Self {
            capacity,
            lines: VecDeque::with_capacity(capacity),
            next_seq: 0,
        }
    }

    /// Ring на [`RING_CAPACITY`] строк (стандартная ёмкость §4).
    pub fn with_default_capacity() -> Self {
        Self::new(RING_CAPACITY)
    }

    /// Добавить сырую строку: ANSI вырезается, seq растёт, старейшая строка
    /// вытесняется при переполнении. Возвращает seq строки.
    pub fn push(&mut self, raw: &str) -> u64 {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        if self.lines.len() == self.capacity {
            self.lines.pop_front();
        }
        self.lines.push_back(LogLine {
            seq,
            text: strip_ansi(raw),
        });
        seq
    }

    /// Все строки буфера (от старых к новым).
    pub fn lines(&self) -> impl Iterator<Item = &LogLine> {
        self.lines.iter()
    }

    /// Последние `n` строк (для посмертного диффа Crashed).
    pub fn tail(&self, n: usize) -> impl Iterator<Item = &LogLine> {
        self.lines.iter().rev().take(n).rev()
    }

    /// Самая свежая строка.
    pub fn last(&self) -> Option<&LogLine> {
        self.lines.back()
    }

    /// Текущее число строк.
    pub fn len(&self) -> usize {
        self.lines.len()
    }

    /// Пуст ли буфер.
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }

    /// Ёмкость буфера.
    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

/// Вырезать VT100/ANSI-последовательности: CSI `ESC [ … <final @..~>`,
/// OSC `ESC ] … (BEL | ESC \)`, escape-последовательности ECMA-48 с
/// промежуточными байтами 0x20–0x2F (`ESC ( B`, `ESC # 8`, `ESC % G` … —
/// финальный байт съедается) и прочие двухсимвольные ESC-коды.
pub fn strip_ansi(input: &str) -> String {
    #[derive(Clone, Copy, PartialEq)]
    enum St {
        Ground,
        Esc,
        EscInter,
        Csi,
        Osc,
        OscEsc,
    }

    let mut state = St::Ground;
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match state {
            St::Ground => {
                if ch == '\x1b' {
                    state = St::Esc;
                } else {
                    out.push(ch);
                }
            }
            St::Esc => match ch {
                '[' => state = St::Csi,
                ']' => state = St::Osc,
                // Промежуточные байты 0x20–0x2F ( '(' , '#' , '%' … ):
                // последовательность продолжается, финал придёт позже.
                '\x20'..='\x2f' => state = St::EscInter,
                _ => state = St::Ground,
            },
            St::EscInter => {
                // Промежуточные байты накапливаются; любой другой байт —
                // финальный, съедаем его и выходим в Ground.
                if !matches!(ch, '\x20'..='\x2f') {
                    state = St::Ground;
                }
            }
            St::Csi => {
                if matches!(ch, '\x40'..='\x7e') {
                    state = St::Ground;
                }
            }
            St::Osc => match ch {
                '\x07' => state = St::Ground,
                '\x1b' => state = St::OscEsc,
                _ => {}
            },
            St::OscEsc => {
                state = if ch == '\\' { St::Ground } else { St::Osc };
            }
        }
    }
    out
}

/// Антифлуд-фильтр: не более `max_per_second` строк в СКОЛЬЗЯЩУЮ секунду
/// (окно `(now−1000, now]`, а не тумблинг-окно: всплеск на стыке секунд не
/// проходит удвоенный лимит; §4 «антифлуд max_log_line строк/с», значение
/// задаётся конфигом).
#[derive(Debug, Clone)]
pub struct FloodGate {
    max_per_second: usize,
    /// Метки времени пропущенных строк (только allowed) — скользящее окно.
    window: VecDeque<u128>,
}

impl FloodGate {
    /// Новый фильтр с лимитом `max_per_second` строк в скользящую секунду.
    pub fn new(max_per_second: usize) -> Self {
        Self {
            max_per_second,
            window: VecDeque::new(),
        }
    }

    /// Пропустить строку с меткой времени `now_ms`? `false` = дроп (флуд).
    /// Из окна вытесняются метки старше секунды (`now − t ≥ 1000`).
    pub fn allow(&mut self, now_ms: u128) -> bool {
        while self
            .window
            .front()
            .is_some_and(|&t| now_ms.saturating_sub(t) >= 1000)
        {
            self.window.pop_front();
        }
        if self.window.len() < self.max_per_second {
            self.window.push_back(now_ms);
            true
        } else {
            false
        }
    }

    /// Лимит строк в скользящую секунду.
    pub fn max_per_second(&self) -> usize {
        self.max_per_second
    }
}

#[cfg(test)]
mod tests {
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
}
