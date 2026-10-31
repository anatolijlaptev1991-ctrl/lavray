// SPDX-License-Identifier: GPL-3.0-only

//! Регистрация единственного глобального сочетания (T-82): замена и снятие.
//!
//! Старое сочетание снимается до регистрации нового: иначе замена на то же
//! сочетание в другой записи упала бы как «занято». Не удалось
//! зарегистрировать новое (его держит другая программа) — возвращаем старое,
//! чтобы пользователь не остался без работающего сочетания.

use super::accel::Accel;
use std::sync::Mutex;

/// Регистрация в ОС (в тестах — подставная).
pub trait HotkeyBackend {
    fn register(&self, accel: &Accel) -> Result<(), String>;
    fn unregister(&self, accel: &Accel) -> Result<(), String>;
}

/// Почему не получилось; строка — код ошибки для UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlotError {
    /// Сочетание занято другой программой или ОС не дала его зарегистрировать.
    Conflict(String),
}

impl SlotError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Conflict(_) => "conflict",
        }
    }
}

/// Текущее сочетание «подключить/отключить».
#[derive(Default)]
pub struct HotkeySlot {
    current: Mutex<Option<Accel>>,
}

impl HotkeySlot {
    /// Заменить сочетание (`None` — снять). Под замком: две замены подряд из
    /// разных потоков не перепутают порядок снятия и регистрации.
    pub fn set<B: HotkeyBackend>(&self, backend: &B, next: Option<Accel>) -> Result<(), SlotError> {
        let mut current = self.current.lock().unwrap_or_else(|e| e.into_inner());
        if *current == next {
            return Ok(());
        }
        let old = current.take();
        if let Some(old) = &old {
            if let Err(e) = backend.unregister(old) {
                // Не сняли — значит, оно и не держится: продолжаем замену.
                eprintln!("LAVRay: не удалось снять сочетание {old}: {e}");
            }
        }
        let Some(new) = next else {
            return Ok(());
        };
        if let Err(reason) = backend.register(&new) {
            // Возвращаем прежнее; не вышло и это — сочетания нет, так и скажет `current`.
            *current = old.filter(|old| backend.register(old).is_ok());
            return Err(SlotError::Conflict(reason));
        }
        *current = Some(new);
        Ok(())
    }

    /// Текущее сочетание.
    pub fn current(&self) -> Option<Accel> {
        *self.current.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
#[path = "register_tests.rs"]
mod tests;
