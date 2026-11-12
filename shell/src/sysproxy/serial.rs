// SPDX-License-Identifier: GPL-3.0-only

//! Одновременно с системным прокси работает одна операция.

use std::sync::{Mutex, MutexGuard};

/// Операции с прокси идут по одной: ими пользуются и команды UI, и поток
/// надзирателя (снятие прокси при смерти ядра, T-03).
static OPERATIONS: Mutex<()> = Mutex::new(());

pub(super) fn exclusive() -> MutexGuard<'static, ()> {
    OPERATIONS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
