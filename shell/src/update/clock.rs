// SPDX-License-Identifier: GPL-3.0-only

//! Часы и пауза: внедряются, чтобы ожидание heartbeat в тестах не занимало
//! минуту настоящего времени.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Время в миллисекундах Unix и сон.
pub trait Clock {
    /// Миллисекунды с начала эпохи Unix.
    fn now_ms(&self) -> u64;
    /// Заснуть на `duration`.
    fn sleep(&self, duration: Duration);
}

/// Системные часы.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}
