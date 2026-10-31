// SPDX-License-Identifier: GPL-3.0-only

//! Операции над настройками прокси ОС: трейт [`Backend`] и настоящая ОС.

#[cfg(all(unix, not(target_os = "macos")))]
use super::linux as imp;
#[cfg(target_os = "macos")]
use super::macos as imp;
#[cfg(windows)]
use super::registry as imp;
use super::ProxySnapshot;

/// Операции над настройками прокси ОС: в приложении — [`System`], в тестах —
/// подставной реестр.
pub trait Backend {
    /// Прочитать текущие настройки.
    fn capture(&self) -> Result<ProxySnapshot, String>;
    /// Включить прокси `host:port`.
    fn apply(&self, host: &str, port: u16) -> Result<(), String>;
    /// Записать настройки из снимка.
    fn restore(&self, snap: &ProxySnapshot) -> Result<(), String>;
}

/// Настоящая ОС.
pub struct System;

impl Backend for System {
    fn capture(&self) -> Result<ProxySnapshot, String> {
        imp::capture()
    }

    fn apply(&self, host: &str, port: u16) -> Result<(), String> {
        imp::apply(host, port)
    }

    fn restore(&self, snap: &ProxySnapshot) -> Result<(), String> {
        imp::restore(snap)
    }
}

pub use imp::{apply, capture, clear, restore};
