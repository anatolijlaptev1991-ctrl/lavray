// SPDX-License-Identifier: GPL-3.0-only

//! Backoff-стратегия рестартов ядра.
//!
//! Спек: `docs/stage3/shell-lifecycle.md` §2.2 — «backoff 1/2/4/8/15 с
//! (+джиттер 20 %)». Джиттер инжектируется через [`JitterSource`], чтобы
//! расписание было детерминированно тестируемым (без RNG-зависимостей).

use std::time::Duration;

/// Шаги backoff: 1/2/4/8/15 с (экспоненциальный рост с потолком 15 с).
pub const BACKOFF_STEPS_MS: [u64; 5] = [1000, 2000, 4000, 8000, 15000];
/// Доля джиттера ±20 % (§2.2).
pub const JITTER_FRACTION: f64 = 0.20;

/// Расписание backoff: индексируется числом неудач, потолок — последний шаг.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BackoffSchedule {
    failures: usize,
}

impl BackoffSchedule {
    /// Новое расписание без неудач.
    pub fn new() -> Self {
        Self::default()
    }

    /// Зарегистрировать неудачу (следующая задержка вырастет).
    pub fn record_failure(&mut self) {
        self.failures = self.failures.saturating_add(1);
    }

    /// Сброс после успеха/ручного перезапуска.
    pub fn reset(&mut self) {
        self.failures = 0;
    }

    /// Число зарегистрированных неудач.
    pub fn failures(&self) -> usize {
        self.failures
    }

    /// Базовая задержка (без джиттера): `ZERO` при нуле неудач; после N
    /// неудач — `BACKOFF_STEPS_MS[min(N-1, len-1)]`, т.е. 1,2,4,8,15,15,… с.
    pub fn delay(&self) -> Duration {
        if self.failures == 0 {
            return Duration::ZERO;
        }
        let idx = (self.failures - 1).min(BACKOFF_STEPS_MS.len() - 1);
        Duration::from_millis(BACKOFF_STEPS_MS[idx])
    }

    /// Задержка с джиттером ±[`JITTER_FRACTION`] (§2.2), источник случайности
    /// передаётся снаружи.
    pub fn delay_with<J: JitterSource>(&self, jitter: &mut J) -> Duration {
        apply_jitter(self.delay(), jitter.unit())
    }
}

/// Применить к базовой задержке множитель `1 ± JITTER_FRACTION`;
/// `unit ∈ [0, 1)` равномерно отображается на диапазон множителя.
pub fn apply_jitter(base: Duration, unit: f64) -> Duration {
    let unit = unit.clamp(0.0, 1.0);
    let factor = 1.0 + JITTER_FRACTION * (2.0 * unit - 1.0);
    let ms = (base.as_millis() as f64 * factor).round() as u64;
    Duration::from_millis(ms)
}

/// Источник равномерного `unit ∈ [0, 1)` для джиттера (CSPRNG-реализация —
/// при врезке реального рестартера; в тестах — детерминированный мок).
pub trait JitterSource {
    /// Следующее значение в `[0, 1)`.
    fn unit(&mut self) -> f64;
}

/// Детерминированный джиттер для тестов: всегда возвращает `value`
/// (клампится в `[0, 1)`).
#[derive(Debug, Clone, Copy)]
pub struct FixedJitter {
    /// Фиксированное значение unit.
    pub value: f64,
}

impl JitterSource for FixedJitter {
    fn unit(&mut self) -> f64 {
        self.value.clamp(0.0, 0.999_999)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Базовое расписание: 1, 2, 4, 8, 15 с, дальше — потолок 15 с (§2.2).
    #[test]
    fn base_schedule_matches_spec() {
        let mut schedule = BackoffSchedule::new();
        assert_eq!(
            schedule.delay(),
            Duration::from_millis(0),
            "до неудач нет задержки"
        );

        let expected = [1000, 2000, 4000, 8000, 15000, 15000, 15000];
        for want in expected {
            schedule.record_failure();
            assert_eq!(schedule.delay(), Duration::from_millis(want));
        }
        assert_eq!(schedule.failures(), expected.len());
    }

    /// Reset возвращает расписание к нулю.
    #[test]
    fn reset_returns_to_start() {
        let mut schedule = BackoffSchedule::new();
        for _ in 0..6 {
            schedule.record_failure();
        }
        assert_eq!(schedule.delay(), Duration::from_secs(15));
        schedule.reset();
        assert_eq!(schedule.delay(), Duration::from_millis(0));
        assert_eq!(schedule.failures(), 0);
    }

    /// Джиттер: границы ±20 % и середина (unit=0.5 → без изменения).
    #[test]
    fn jitter_bounds_are_twenty_percent() {
        let base = Duration::from_secs(4);
        assert_eq!(apply_jitter(base, 0.0), Duration::from_millis(3200));
        assert_eq!(apply_jitter(base, 0.5), Duration::from_millis(4000));
        assert_eq!(apply_jitter(base, 0.999_999), Duration::from_millis(4800));
        // Выходы за [0,1) клампятся.
        assert_eq!(apply_jitter(base, -3.0), Duration::from_millis(3200));
        assert_eq!(apply_jitter(base, 7.0), Duration::from_millis(4800));
    }

    /// delay_with использует инжектированный источник джиттера.
    #[test]
    fn delay_with_uses_jitter_source() {
        let mut schedule = BackoffSchedule::new();
        schedule.record_failure(); // база 1 с
        let mut low = FixedJitter { value: 0.0 };
        let mut mid = FixedJitter { value: 0.5 };
        assert_eq!(schedule.delay_with(&mut low), Duration::from_millis(800));
        assert_eq!(schedule.delay_with(&mut mid), Duration::from_millis(1000));
    }
}
