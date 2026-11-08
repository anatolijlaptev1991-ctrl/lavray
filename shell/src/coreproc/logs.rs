// SPDX-License-Identifier: GPL-3.0-only

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

/// Потолок предварительной ёмкости окна [`FloodGate`] (меток времени).
const WINDOW_PREALLOC_MAX: usize = 4096;

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
    /// вытесняется при переполнении. Возвращает seq строки. Удобная форма для
    /// тестов и холодных путей; горячий путь читателей — [`LogRing::push_reusing`].
    pub fn push(&mut self, raw: &str) -> u64 {
        let mut text = String::with_capacity(raw.len());
        strip_ansi_into(raw, &mut text);
        self.push_reusing(&mut text)
    }

    /// Добавить уже очищенную от ANSI строку, обменяв её буфер на буфер
    /// вытесняемой записи (0 аллокаций в устоявшемся режиме).
    ///
    /// Очистку (`strip_ansi_into`) вызывающий делает ВНЕ мьютекса ring в своём
    /// рабочем буфере; под замком остаются только seq, `mem::swap` и
    /// `VecDeque`. После вызова `text` содержит прежний текст вытесненной
    /// строки (или пуст, пока ring не заполнен) — его нужно `clear()` перед
    /// следующим использованием. Ёмкость растёт один раз на новой максимальной
    /// длине строки и сохраняется.
    pub fn push_reusing(&mut self, text: &mut String) -> u64 {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        if self.lines.len() == self.capacity {
            if let Some(mut slot) = self.lines.pop_front() {
                std::mem::swap(&mut slot.text, text);
                slot.seq = seq;
                self.lines.push_back(slot);
                return seq;
            }
        }
        self.lines.push_back(LogLine {
            seq,
            text: std::mem::take(text),
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

/// Состояние автомата разбора VT100/ANSI.
#[derive(Clone, Copy, PartialEq)]
enum St {
    Ground,
    Esc,
    EscInter,
    Csi,
    Osc,
    OscEsc,
}

/// Переход автомата по символу `ch`.
fn advance(state: St, ch: char) -> St {
    match state {
        St::Ground if ch == '\x1b' => St::Esc,
        St::Ground => St::Ground,
        St::Esc => match ch {
            '[' => St::Csi,
            ']' => St::Osc,
            // Промежуточные байты 0x20–0x2F ( '(' , '#' , '%' … ):
            // последовательность продолжается, финал придёт позже.
            '\x20'..='\x2f' => St::EscInter,
            _ => St::Ground,
        },
        // Промежуточные байты накапливаются; любой другой байт — финальный,
        // съедаем его и выходим в Ground.
        St::EscInter if matches!(ch, '\x20'..='\x2f') => St::EscInter,
        St::EscInter => St::Ground,
        St::Csi if matches!(ch, '\x40'..='\x7e') => St::Ground,
        St::Csi => St::Csi,
        St::Osc => match ch {
            '\x07' => St::Ground,
            '\x1b' => St::OscEsc,
            _ => St::Osc,
        },
        St::OscEsc if ch == '\\' => St::Ground,
        St::OscEsc => St::Osc,
    }
}

/// Вырезать VT100/ANSI-последовательности: CSI `ESC [ … <final @..~>`,
/// OSC `ESC ] … (BEL | ESC \)`, escape-последовательности ECMA-48 с
/// промежуточными байтами 0x20–0x2F (`ESC ( B`, `ESC # 8`, `ESC % G` … —
/// финальный байт съедается) и прочие двухсимвольные ESC-коды.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    strip_ansi_into(input, &mut out);
    out
}

/// То же, что [`strip_ansi`], но ДОПИСЫВАЕТ результат в `out` (буфер читателя
/// переиспользуется; перед вызовом его очищает вызывающий). Строка без ESC —
/// быстрый путь: `memchr` и одно копирование.
pub fn strip_ansi_into(input: &str, out: &mut String) {
    let Some(first_esc) = memchr::memchr(0x1b, input.as_bytes()) else {
        out.push_str(input);
        return;
    };
    // ESC — ASCII, поэтому `first_esc` лежит на границе символа.
    out.push_str(&input[..first_esc]);
    let mut state = St::Ground;
    for ch in input[first_esc..].chars() {
        if state == St::Ground && ch != '\x1b' {
            out.push(ch);
        }
        state = advance(state, ch);
    }
}

/// Антифлуд-фильтр: не более `max_per_second` строк в СКОЛЬЗЯЩУЮ секунду
/// (окно `(now−1000, now]`, а не тумблинг-окно: всплеск на стыке секунд не
/// проходит удвоенный лимит; §4 «антифлуд max_log_line строк/с», значение
/// задаётся конфигом).
///
/// Контракт лимита — НА ПАЙП: у stdout и у stderr свой `FloodGate`, поэтому
/// суммарно ядро может провести в ring до `2 × max_per_second` строк в
/// секунду (оба пайпа шумят одновременно); один активный пайп ограничен
/// ровно `max_per_second`. Часы — монотонные (миллисекунды от старта
/// читателя), не `SystemTime`: скачок системного времени окно не ломает.
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
            // Предвыделение под полный лимит; потолок защищает от
            // чрезмерного конфигурируемого значения.
            window: VecDeque::with_capacity(max_per_second.min(WINDOW_PREALLOC_MAX)),
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
mod tests;
