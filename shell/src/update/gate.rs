// SPDX-License-Identifier: GPL-3.0-only

//! Замок «установка уже идёт»: вторая параллельная `update_apply` получает `busy`.

use super::error::ApplyError;
use std::sync::atomic::{AtomicBool, Ordering};

/// Замок «установка уже идёт».
#[derive(Default)]
pub struct ApplyGate(AtomicBool);

/// Замок удерживается, пока жив этот объект.
pub struct GateGuard<'a>(&'a AtomicBool);

impl ApplyGate {
    /// Занять замок или вернуть [`ApplyError::Busy`].
    pub fn try_enter(&self) -> Result<GateGuard<'_>, ApplyError> {
        match self
            .0
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        {
            Ok(_) => Ok(GateGuard(&self.0)),
            Err(_) => Err(ApplyError::Busy),
        }
    }
}

impl Drop for GateGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
