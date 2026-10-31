// SPDX-License-Identifier: GPL-3.0-only

//! Операции над настройками прокси ОС: трейт [`Backend`] и настоящая ОС.

#[cfg(all(unix, not(target_os = "macos")))]
use super::linux as imp;
#[cfg(target_os = "macos")]
use super::macos as imp;
#[cfg(windows)]
use super::windows as imp;
use super::ProxySnapshot;

/// Операции над настройками прокси ОС: в приложении — [`System`], в тестах —
/// подставные реестр и подключения.
pub trait Backend {
    /// Прочитать текущие настройки.
    fn capture(&self) -> Result<ProxySnapshot, String>;
    /// Включить прокси `host:port`. `original` — снимок, снятый перед
    /// включением: по нему бэкенд знает, какие подключения (RAS) он трогает.
    /// Предупреждения — необязательные части, которые не удались: прокси
    /// включён, но не везде.
    fn apply(&self, host: &str, port: u16, original: &ProxySnapshot)
        -> Result<Vec<String>, String>;
    /// Записать настройки из снимка; предупреждения — как у `apply`.
    fn restore(&self, snap: &ProxySnapshot) -> Result<Vec<String>, String>;
}

/// Настоящая ОС.
pub struct System;

#[cfg(windows)]
impl Backend for System {
    fn capture(&self) -> Result<ProxySnapshot, String> {
        imp::system().capture()
    }

    fn apply(
        &self,
        host: &str,
        port: u16,
        original: &ProxySnapshot,
    ) -> Result<Vec<String>, String> {
        imp::system().apply(host, port, original)
    }

    fn restore(&self, snap: &ProxySnapshot) -> Result<Vec<String>, String> {
        imp::system().restore(snap)
    }
}

/// macOS и Linux: прокси один на систему, ни RAS, ни WPAD, ни предупреждений.
#[cfg(not(windows))]
impl Backend for System {
    fn capture(&self) -> Result<ProxySnapshot, String> {
        imp::capture()
    }

    fn apply(&self, host: &str, port: u16, _: &ProxySnapshot) -> Result<Vec<String>, String> {
        imp::apply(host, port).map(|()| Vec::new())
    }

    fn restore(&self, snap: &ProxySnapshot) -> Result<Vec<String>, String> {
        imp::restore(snap).map(|()| Vec::new())
    }
}

pub use imp::{apply, capture, clear, restore};
