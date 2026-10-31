// SPDX-License-Identifier: GPL-3.0-only

use super::values::{
    apply_with, capture_with, parse_query, restore_with, RegValue, Registry, BYPASS,
};
use super::*;
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;

/// Реестр в памяти: настоящий реестр и `reg.exe` тесты не трогают.
#[derive(Default)]
struct MemRegistry {
    values: RefCell<BTreeMap<String, RegValue>>,
    /// Сколько ближайших записей завершатся ошибкой «Access is denied».
    fail_writes: Cell<u32>,
}

impl MemRegistry {
    fn with(rows: &[(&str, &str, &str)]) -> Self {
        let mem = Self::default();
        for (name, kind, data) in rows {
            let value = RegValue {
                kind: (*kind).into(),
                data: (*data).into(),
            };
            mem.values.borrow_mut().insert((*name).into(), value);
        }
        mem
    }

    fn dump(&self) -> BTreeMap<String, RegValue> {
        self.values.borrow().clone()
    }

    fn set(&self, name: &str, kind: &str, data: &str) {
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

/// Бэкенд поверх реестра в памяти: та же логика, что у настоящего.
struct Mem<'a>(&'a MemRegistry);

impl Backend for Mem<'_> {
    fn capture(&self) -> Result<ProxySnapshot, String> {
        capture_with(self.0)
    }

    fn apply(&self, host: &str, port: u16) -> Result<(), String> {
        apply_with(self.0, host, port)
    }

    fn restore(&self, snap: &ProxySnapshot) -> Result<(), String> {
        restore_with(self.0, snap)
    }
}

fn fresh_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lavray-sysproxy-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn proxy<'a>(tag: &str, mem: &'a MemRegistry) -> SysProxy<Mem<'a>> {
    SysProxy::with_backend(&fresh_dir(tag), Mem(mem))
}

#[test]
fn snapshot_roundtrip() {
    let snap = ProxySnapshot {
        version: 1,
        os: "test".into(),
        data: serde_json::json!({"ProxyEnable": "0x0", "ProxyServer": "1.2.3.4:8080"}),
    };
    let raw = serde_json::to_string(&snap).unwrap();
    let back: ProxySnapshot = serde_json::from_str(&raw).unwrap();
    assert_eq!(back.data["ProxyServer"], "1.2.3.4:8080");
}

#[test]
fn pending_snapshot_absent_on_clean_dir() {
    let dir = std::env::temp_dir().join(format!("lavray-sysproxy-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let sp = SysProxy::new(&dir);
    assert!(sp.pending_snapshot().is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn parse_query_keeps_values_with_spaces() {
    let output = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\r\n\
        \x20   ProxyEnable    REG_DWORD    0x1\r\n\
        \x20   ProxyOverride    REG_SZ    *.corp.local; 10.*;<local>\r\n\
        \x20   Wide    REG_SZ    a    b\r\n\
        \x20   Empty    REG_SZ    \r\n\
        \x20   Path    REG_EXPAND_SZ    %SystemRoot%\\x\r\n\
        \r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Connections\r\n";
    let found = parse_query(output);
    assert_eq!(
        found["ProxyOverride"],
        RegValue::sz("*.corp.local; 10.*;<local>")
    );
    assert_eq!(found["ProxyEnable"], RegValue::dword(1));
    assert_eq!(found["Wide"].data, "a    b");
    assert_eq!(found["Empty"].data, "");
    assert_eq!(found["Path"].kind, "REG_EXPAND_SZ");
    assert_eq!(found.len(), 5, "заголовки ключей не значения");
}

/// S-02: `reg query` на русской Windows пишет в CP866. `*.рф` - байты
/// `2A 2E E0 E4`; прочитанные как UTF-8 они давали `*.??` (реестр не нужен).
#[cfg(windows)]
#[test]
fn reg_query_output_in_cp866_keeps_cyrillic_exceptions() {
    let mut raw = Vec::new();
    raw.extend_from_slice(
        b"\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\r\n\
          \x20   ProxyOverride    REG_SZ    *.corp.local; ",
    );
    raw.extend_from_slice(&[0x2A, 0x2E, 0xE0, 0xE4]);
    raw.extend_from_slice(b";<local>\r\n    ProxyEnable    REG_DWORD    0x1\r\n");
    let found = parse_query(&crate::oemtext::decode_output(&raw, 866));
    assert_eq!(
        found["ProxyOverride"],
        RegValue::sz("*.corp.local; *.рф;<local>")
    );
    assert_eq!(found["ProxyEnable"], RegValue::dword(1));
    // Как было: UTF-8 с заменой портит те же байты.
    let broken = parse_query(&String::from_utf8_lossy(&raw));
    assert_ne!(broken["ProxyOverride"], found["ProxyOverride"]);
}

/// Снимок на диске и откат не портят не-ASCII значения.
#[test]
fn cyrillic_bypass_list_survives_enable_then_disable() {
    let mem = MemRegistry::with(&[
        ("ProxyEnable", "REG_DWORD", "0x1"),
        ("ProxyServer", "REG_SZ", "corp.proxy:8080"),
        ("ProxyOverride", "REG_SZ", "*.рф;*.москва; 10.*;<local>"),
    ]);
    let before = mem.dump();
    let sp = proxy("cyrillic", &mem);
    sp.enable("127.0.0.1", 2080).unwrap();
    sp.disable().unwrap();
    assert_eq!(mem.dump(), before);
}

#[cfg(windows)]
#[test]
fn reg_program_is_the_absolute_system_reg_exe() {
    let program = super::registry::reg_exe();
    assert!(program.is_absolute(), "{program:?}");
    assert!(program.ends_with(r"System32\reg.exe"), "{program:?}");
    assert!(program.is_file(), "{program:?}");
}

fn initial_corp() -> MemRegistry {
    MemRegistry::with(&[
        ("ProxyEnable", "REG_DWORD", "0x1"),
        ("ProxyServer", "REG_SZ", "corp.proxy:8080"),
        ("ProxyOverride", "REG_SZ", "*.corp.local; 10.*;<local>"),
    ])
}

/// A2-04: включить и выключить = ровно прежние настройки, включая пробелы.
#[test]
fn enable_then_disable_gives_back_exact_settings() {
    let mem = initial_corp();
    let before = mem.dump();
    let sp = proxy("roundtrip", &mem);
    sp.enable("127.0.0.1", 2080).unwrap();
    assert_eq!(mem.dump()["ProxyServer"], RegValue::sz("127.0.0.1:2080"));
    assert_eq!(mem.dump()["ProxyOverride"], RegValue::sz(BYPASS));
    sp.disable().unwrap();
    assert_eq!(mem.dump(), before);
    assert!(sp.pending_snapshot().is_none());
}

/// A2-05: другая программа заняла системный прокси — наш откат её не стирает.
#[test]
fn foreign_proxy_set_during_session_is_not_rolled_back() {
    let mem = MemRegistry::with(&[("ProxyEnable", "REG_DWORD", "0x0")]);
    let sp = proxy("foreign", &mem);
    sp.enable("127.0.0.1", 2080).unwrap();
    mem.set("ProxyServer", "REG_SZ", "10.9.9.9:3128");
    sp.disable().unwrap();
    let after = mem.dump();
    assert_eq!(after["ProxyServer"], RegValue::sz("10.9.9.9:3128"));
    assert_eq!(
        after["ProxyEnable"],
        RegValue::dword(1),
        "чужой прокси остался включённым"
    );
}

/// Пользователь поправил только список исключений: свой адрес снимаем,
/// его список оставляем.
#[test]
fn user_edit_of_bypass_list_survives_while_our_proxy_is_removed() {
    let mem = MemRegistry::with(&[("ProxyEnable", "REG_DWORD", "0x0")]);
    let sp = proxy("bypass", &mem);
    sp.enable("127.0.0.1", 2080).unwrap();
    mem.set("ProxyOverride", "REG_SZ", "mine.local");
    sp.disable().unwrap();
    let after = mem.dump();
    assert_eq!(after["ProxyOverride"], RegValue::sz("mine.local"));
    assert_eq!(after["ProxyEnable"], RegValue::dword(0));
    assert!(!after.contains_key("ProxyServer"));
}

/// Падение приложения с включённым прокси: следующий запуск возвращает
/// и PAC, и ручной прокси.
#[test]
fn crash_then_recover_restores_pac_and_manual_proxy() {
    let mem = MemRegistry::with(&[
        ("ProxyEnable", "REG_DWORD", "0x0"),
        ("AutoConfigURL", "REG_SZ", "http://pac.corp/wpad.dat"),
    ]);
    let before = mem.dump();
    let dir = fresh_dir("crash");
    let first_run = SysProxy::with_backend(&dir, Mem(&mem));
    first_run.enable("127.0.0.1", 2080).unwrap();
    assert!(!mem.dump().contains_key("AutoConfigURL"));
    // «Процесс упал»: disable() не вызывался, новый менеджер видит снимок.
    let second_run = SysProxy::with_backend(&dir, Mem(&mem));
    assert!(second_run.recover_if_needed().unwrap());
    assert_eq!(mem.dump(), before);
}

#[test]
fn double_enable_keeps_the_original_settings() {
    let mem = initial_corp();
    let before = mem.dump();
    let sp = proxy("double", &mem);
    sp.enable("127.0.0.1", 2080).unwrap();
    sp.enable("127.0.0.1", 2081).unwrap();
    sp.disable().unwrap();
    assert_eq!(mem.dump(), before);
}

/// A2-15: сбой отката внутри `enable()` не должен ни затирать исходный
/// снимок, ни продолжать включение.
#[test]
fn failed_recovery_inside_enable_keeps_the_original_snapshot() {
    let mem = initial_corp();
    let before = mem.dump();
    let sp = proxy("failed-recovery", &mem);
    sp.enable("127.0.0.1", 2080).unwrap();
    mem.fail_writes.set(1); // первая же запись отката упадёт
    assert!(sp.enable("127.0.0.1", 2080).is_err());
    let kept = sp.pending_snapshot().expect("снимок цел");
    assert_eq!(kept.data["proxy"]["ProxyServer"]["data"], "corp.proxy:8080");
    sp.disable().unwrap();
    assert_eq!(mem.dump(), before);
}

/// Снимок прошлой версии (плоский, без `applied`) откатывается безусловно.
#[test]
fn snapshot_file_of_the_previous_version_is_restored() {
    let mem = MemRegistry::with(&[
        ("ProxyEnable", "REG_DWORD", "0x1"),
        ("ProxyServer", "REG_SZ", "127.0.0.1:2080"),
    ]);
    let sp = proxy("legacy", &mem);
    let legacy = serde_json::json!({
        "version": 1, "os": "windows",
        "data": {"ProxyEnable": "0x0", "ProxyServer": null, "ProxyOverride": null, "AutoConfigURL": "http://pac.corp/wpad.dat"}
    });
    std::fs::write(&sp.snapshot_path, legacy.to_string()).unwrap();
    assert!(sp.recover_if_needed().unwrap());
    let after = mem.dump();
    assert_eq!(after["ProxyEnable"], RegValue::dword(0));
    assert_eq!(
        after["AutoConfigURL"],
        RegValue::sz("http://pac.corp/wpad.dat")
    );
    assert!(!after.contains_key("ProxyServer"));
}

/// A2-18: порт - только 1..=65535; 0 и всё за пределами отвергаются.
#[test]
fn port_must_be_within_1_to_65535() {
    for ok in [1, 2080, 65535] {
        assert_eq!(validate_port(ok), Ok(ok as u16), "{ok}");
    }
    for bad in [
        0,
        -1,
        65536,
        70_000,
        i64::from(u32::MAX),
        i64::MAX,
        i64::MIN,
    ] {
        assert!(validate_port(bad).is_err(), "{bad} принят");
    }
}

/// A2-18: системный прокси может смотреть только на loopback.
#[test]
fn host_must_be_an_ipv4_loopback_address() {
    for ok in ["127.0.0.1", "127.0.0.2", "127.255.255.254"] {
        assert!(validate_host(ok).is_ok(), "{ok} отвергнут");
    }
    for bad in [
        "",
        "0.0.0.0",
        "8.8.8.8",
        "192.168.1.10",
        "10.0.0.1",
        "localhost",
        "evil.example",
        "::1",
        "[::1]",
        "127.0.0.1:80",
        " 127.0.0.1",
        "127.0.0.1 ",
        "127.0.0.1;https=8.8.8.8:80",
        "127.0.0.1
",
        "'127.0.0.1'",
    ] {
        assert!(validate_host(bad).is_err(), "{bad:?} принят");
    }
}

/// Неверный адрес отвергается до любых действий: реестр цел, снимка нет.
#[test]
fn enable_rejects_a_bad_endpoint_before_touching_anything() {
    let mem = initial_corp();
    let before = mem.dump();
    let sp = proxy("bad-endpoint", &mem);
    assert!(sp.enable("127.0.0.1", 0).is_err());
    assert!(sp.enable("8.8.8.8", 2080).is_err());
    assert!(sp.enable("127.0.0.1;http=8.8.8.8:80", 2080).is_err());
    assert_eq!(mem.dump(), before);
    assert!(sp.pending_snapshot().is_none());
}

/// Отказ из-за адреса не откатывает уже включённый нами прокси:
/// проверка идёт раньше отката прошлого снимка.
#[test]
fn rejected_enable_leaves_a_running_session_alone() {
    let mem = initial_corp();
    let before = mem.dump();
    let sp = proxy("bad-while-on", &mem);
    sp.enable("127.0.0.1", 2080).unwrap();
    let during = mem.dump();
    assert!(sp.enable("127.0.0.1", 0).is_err());
    assert_eq!(mem.dump(), during);
    assert!(sp.pending_snapshot().is_some());
    sp.disable().unwrap();
    assert_eq!(mem.dump(), before);
}
