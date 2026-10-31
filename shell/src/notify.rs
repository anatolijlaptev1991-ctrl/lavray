// SPDX-License-Identifier: GPL-3.0-only

//! Системные уведомления (T-82).
//!
//! Тексты присылает UI из словарей (без имени сервера и адресов). Оболочка
//! решает, показывать ли: настройка «Уведомления» выключена — нет; одно
//! уведомление одного вида не чаще раза в 2 с (дребезг состояния при
//! переподключении); длина заголовка и текста ограничена.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Не чаще одного уведомления одного вида за этот интервал.
pub const MIN_INTERVAL: Duration = Duration::from_secs(2);
/// Наибольшая длина заголовка, символов.
pub const MAX_TITLE_CHARS: usize = 120;
/// Наибольшая длина текста, символов.
pub const MAX_BODY_CHARS: usize = 240;

/// Вид уведомления: от него зависит только ограничение частоты.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NotifyKind {
    Connected,
    Disconnected,
    Error,
}

impl NotifyKind {
    /// Вид из строки UI; неизвестный — `None`.
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "connected" => Some(Self::Connected),
            "disconnected" => Some(Self::Disconnected),
            "error" => Some(Self::Error),
            _ => None,
        }
    }
}

/// Показ уведомления ОС (в тестах — подставной).
pub trait Notifier {
    fn show(&self, title: &str, body: &str) -> Result<(), String>;
}

/// Решение «показывать ли»: настройка и частота по видам.
#[derive(Default)]
pub struct NotifyGate {
    last: Mutex<HashMap<NotifyKind, Instant>>,
}

impl NotifyGate {
    /// Показать уведомление, если разрешено; `Ok(false)` — подавлено.
    pub fn show<N: Notifier>(
        &self,
        notifier: &N,
        enabled: bool,
        kind: NotifyKind,
        title: &str,
        body: &str,
        now: Instant,
    ) -> Result<bool, String> {
        if !enabled || !self.admit(kind, now) {
            return Ok(false);
        }
        notifier.show(&clamp(title, MAX_TITLE_CHARS), &clamp(body, MAX_BODY_CHARS))?;
        Ok(true)
    }

    fn admit(&self, kind: NotifyKind, now: Instant) -> bool {
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        let recent = last
            .get(&kind)
            .is_some_and(|at| now.saturating_duration_since(*at) < MIN_INTERVAL);
        if !recent {
            last.insert(kind, now);
        }
        !recent
    }
}

/// Обрезать до `max` символов (не байт: кириллица и иероглифы — несколько байт).
pub fn clamp(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests;
