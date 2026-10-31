// SPDX-License-Identifier: GPL-3.0-only

//! Подставные подключения WinINET и перечисление RAS для тестов.

use super::conn::{ConnChange, ConnSettings, Connections};
use super::ras::RasEntries;
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};

/// Настройки подключений в памяти: LAN и записи RAS по именам.
pub(super) struct MemConns {
    lan: RefCell<ConnSettings>,
    entries: RefCell<BTreeMap<String, ConnSettings>>,
    /// Имена, на которых чтение / запись падают.
    pub broken_get: RefCell<BTreeSet<String>>,
    pub broken_set: RefCell<BTreeSet<String>>,
    /// Сколько раз система была уведомлена об изменении.
    pub refreshes: Cell<u32>,
}

impl MemConns {
    pub fn new(lan_flags: u32) -> Self {
        let lan = ConnSettings {
            flags: lan_flags,
            ..ConnSettings::default()
        };
        Self {
            lan: RefCell::new(lan),
            entries: RefCell::default(),
            broken_get: RefCell::default(),
            broken_set: RefCell::default(),
            refreshes: Cell::new(0),
        }
    }

    pub fn add(&self, name: &str, settings: ConnSettings) {
        self.entries.borrow_mut().insert(name.into(), settings);
    }

    pub fn remove(&self, name: &str) {
        self.entries.borrow_mut().remove(name);
    }

    pub fn lan(&self) -> ConnSettings {
        self.lan.borrow().clone()
    }

    pub fn entry(&self, name: &str) -> ConnSettings {
        self.entries.borrow()[name].clone()
    }
}

/// Новое значение строки: `Some("")` очищает, `None` оставляет прежнее.
fn merged_text(new: &Option<String>, old: &Option<String>) -> Option<String> {
    match new {
        Some(new) => Some(new.clone()).filter(|t| !t.is_empty()),
        None => old.clone(),
    }
}

impl Connections for MemConns {
    fn get(&self, conn: Option<&str>) -> Result<ConnSettings, String> {
        let Some(name) = conn else {
            return Ok(self.lan());
        };
        if self.broken_get.borrow().contains(name) {
            return Err("InternetQueryOptionW: код 5".into());
        }
        let found = self.entries.borrow().get(name).cloned();
        found.ok_or_else(|| format!("нет подключения {name}"))
    }

    fn set(&self, conn: Option<&str>, change: &ConnChange) -> Result<(), String> {
        if conn.is_some_and(|name| self.broken_set.borrow().contains(name)) {
            return Err("InternetSetOptionW: код 5".into());
        }
        let mut entries = self.entries.borrow_mut();
        let mut lan = self.lan.borrow_mut();
        let target = match conn {
            None => &mut *lan,
            Some(name) => entries.get_mut(name).ok_or("нет подключения")?,
        };
        *target = ConnSettings {
            flags: change.flags.unwrap_or(target.flags),
            server: merged_text(&change.server, &target.server),
            bypass: merged_text(&change.bypass, &target.bypass),
            pac_url: merged_text(&change.pac_url, &target.pac_url),
        };
        Ok(())
    }

    fn refresh(&self) {
        self.refreshes.set(self.refreshes.get() + 1);
    }
}

/// Перечисление RAS: список имён или ошибка.
pub(super) struct FakeRas(pub RefCell<Result<Vec<String>, String>>);

impl RasEntries for FakeRas {
    fn names(&self) -> Result<Vec<String>, String> {
        self.0.borrow().clone()
    }
}
