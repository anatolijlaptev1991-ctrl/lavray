// SPDX-License-Identifier: GPL-3.0-only

//! Фоновый опрос трея. На GNOME расширение значков при автозапуске занимает имя
//! на шине позже приложения, поэтому один ответ «нет» ничего не значит: опрос
//! повторяется (шаг 0,5 с, до 5 с), а запомнить навсегда можно только «да».
//! Состояние опроса — [`Watch`] (в тестах свой экземпляр); процесс держит один.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;

/// Период повторного опроса.
#[cfg(target_os = "linux")]
pub const POLL_STEP: Duration = Duration::from_millis(500);
/// Сколько опросов делает фон (≈5 с).
#[cfg(target_os = "linux")]
pub const POLL_TRIES: u32 = 10;

/// Результат фонового опроса.
#[derive(Debug, Default)]
pub struct Watch {
    seen: AtomicBool,
    started: AtomicBool,
    done: Mutex<bool>,
    changed: Condvar,
}

impl Watch {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            seen: AtomicBool::new(false),
            started: AtomicBool::new(false),
            done: Mutex::new(false),
            changed: Condvar::new(),
        }
    }

    /// Фон запущен: ответ «пока неизвестно» имеет смысл ждать.
    pub fn mark_started(&self) {
        self.started.store(true, Ordering::SeqCst);
    }

    /// Трей замечен: запоминается навсегда, ожидающие просыпаются.
    pub fn mark_seen(&self) {
        self.seen.store(true, Ordering::SeqCst);
        self.finish();
    }

    /// Опрос закончен (трея не дождались или нашли).
    pub fn finish(&self) {
        *self
            .done
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
        self.changed.notify_all();
    }

    #[must_use]
    pub fn seen(&self) -> bool {
        self.seen.load(Ordering::SeqCst)
    }

    /// Дождаться итога не дольше `limit`: `Some(true)` — трей есть, `Some(false)`
    /// — опрос кончился ни с чем, `None` — ещё идёт (или фон не запускался).
    #[must_use]
    pub fn wait(&self, limit: Duration) -> Option<bool> {
        if self.seen() {
            return Some(true);
        }
        if !self.started.load(Ordering::SeqCst) {
            return None;
        }
        let guard = self
            .done
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (done, _) = self
            .changed
            .wait_timeout_while(guard, limit, |done| !*done)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if self.seen() {
            Some(true)
        } else {
            (*done).then_some(false)
        }
    }
}
