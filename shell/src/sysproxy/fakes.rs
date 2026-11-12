// SPDX-License-Identifier: GPL-3.0-only

//! Подставные реестр, подключения `WinINET` и список RAS для тестов: настоящие
//! `reg.exe`, `WinINET` и RAS тесты не трогают.

use super::conn::{ConnChange, ConnSettings, Connections, AUTO_DETECT, DIRECT, PROXY};
use super::memconns::{FakeRas, MemConns};
use super::ras::RasEntries;
use super::values::{RegValue, Registry};
use super::windows::Windows;
use super::SysProxy;
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Реестр в памяти.
#[derive(Default)]
pub(super) struct MemRegistry {
    values: RefCell<BTreeMap<String, RegValue>>,
    /// Сколько ближайших записей завершатся ошибкой «Access is denied».
    pub fail_writes: Cell<u32>,
}

impl MemRegistry {
    pub fn with(rows: &[(&str, &str, &str)]) -> Self {
        let mem = Self::default();
        for (name, kind, data) in rows {
            mem.set(name, kind, data);
        }
        mem
    }

    pub fn dump(&self) -> BTreeMap<String, RegValue> {
        self.values.borrow().clone()
    }

    pub fn set(&self, name: &str, kind: &str, data: &str) {
        let value = RegValue {
            kind: kind.into(),
            data: data.into(),
        };
        self.values.borrow_mut().insert(name.into(), value);
    }
}

impl Registry for MemRegistry {
    fn read(&self) -> Result<BTreeMap<String, RegValue>, String> {
        Ok(self.dump())
    }

    fn write(&self, name: &str, value: &RegValue) -> Result<(), String> {
        if self.fail_writes.get() > 0 {
            self.fail_writes.set(self.fail_writes.get() - 1);
            return Err("reg add: Access is denied".into());
        }
        self.values.borrow_mut().insert(name.into(), value.clone());
        Ok(())
    }

    fn remove(&self, name: &str) -> Result<(), String> {
        self.values.borrow_mut().remove(name);
        Ok(())
    }
}

pub(super) fn fresh_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lavray-sysproxy-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

impl<T: Registry + ?Sized> Registry for &T {
    fn read(&self) -> Result<BTreeMap<String, RegValue>, String> {
        (**self).read()
    }

    fn write(&self, name: &str, value: &RegValue) -> Result<(), String> {
        (**self).write(name, value)
    }

    fn remove(&self, name: &str) -> Result<(), String> {
        (**self).remove(name)
    }
}

impl<T: Connections + ?Sized> Connections for &T {
    fn get(&self, conn: Option<&str>) -> Result<ConnSettings, String> {
        (**self).get(conn)
    }

    fn set(&self, conn: Option<&str>, change: &ConnChange) -> Result<(), String> {
        (**self).set(conn, change)
    }

    fn refresh(&self) {
        (**self).refresh();
    }
}

impl<T: RasEntries + ?Sized> RasEntries for &T {
    fn names(&self) -> Result<Vec<String>, String> {
        (**self).names()
    }
}

pub(super) type MemWindows<'a> = Windows<&'a MemRegistry, &'a MemConns, &'a FakeRas>;

/// Весь Windows в памяти: реестр, подключения `WinINET` и список RAS.
pub(super) struct Env {
    pub reg: MemRegistry,
    pub conns: MemConns,
    pub ras: FakeRas,
}

impl Env {
    /// LAN с флагами `lan_flags` и записи RAS `(имя, настройки)`.
    pub fn new(lan_flags: u32, entries: &[(&str, ConnSettings)]) -> Self {
        let conns = MemConns::new(lan_flags);
        for (name, settings) in entries {
            conns.add(name, settings.clone());
        }
        let names = entries.iter().map(|(name, _)| name.to_string()).collect();
        Self {
            reg: MemRegistry::default(),
            conns,
            ras: FakeRas(RefCell::new(Ok(names))),
        }
    }

    pub fn backend(&self) -> MemWindows<'_> {
        Windows {
            reg: &self.reg,
            conns: &self.conns,
            ras: &self.ras,
        }
    }

    /// Менеджер с файлом снимка в каталоге `dir`.
    pub fn manager(&self, dir: &Path) -> SysProxy<MemWindows<'_>> {
        SysProxy::with_backend(dir, self.backend())
    }
}

/// Запись RAS: флаги (бит `DIRECT` добавляется), прокси и PAC.
pub(super) fn conn(flags: u32, server: Option<&str>, pac: Option<&str>) -> ConnSettings {
    ConnSettings {
        flags: flags | DIRECT,
        server: server.map(str::to_string),
        bypass: None,
        pac_url: pac.map(str::to_string),
    }
}

pub(super) const OFFICE: &str = "Office VPN";
pub(super) const HOME: &str = "Home VPN";

/// Всё, что тесты сравнивают до и после: реестр, LAN, офисная и домашняя
/// записи RAS.
pub(super) type State = (
    BTreeMap<String, RegValue>,
    ConnSettings,
    ConnSettings,
    ConnSettings,
);

/// LAN с автоопределением, офисная запись (WPAD) и домашняя (свой прокси).
pub(super) fn vpn_env() -> Env {
    let env = Env::new(
        DIRECT | AUTO_DETECT,
        &[
            (OFFICE, conn(AUTO_DETECT, None, None)),
            (HOME, conn(PROXY, Some("corp.proxy:8080"), None)),
        ],
    );
    env.reg.set("ProxyEnable", "REG_DWORD", "0x0");
    env
}

pub(super) fn state(env: &Env) -> State {
    let (office, home) = (env.conns.entry(OFFICE), env.conns.entry(HOME));
    (env.reg.dump(), env.conns.lan(), office, home)
}
