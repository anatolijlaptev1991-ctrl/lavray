// SPDX-License-Identifier: GPL-3.0-only

//! WPAD («Автоматическое определение настроек») и снимки прежних версий
//! (T-82). Реестр, WinINET и RAS — подставные.

use super::conn::{ConnChange, Connections, AUTO_DETECT, AUTO_PROXY_URL, DIRECT, PROXY};
use super::fakes::{conn, fresh_dir, Env};
use super::values::RegValue;
use serde_json::json;

#[test]
fn wpad_flag_cleared_and_restored() {
    let env = Env::new(
        DIRECT | AUTO_DETECT,
        &[("Office VPN", conn(AUTO_DETECT, None, None))],
    );
    env.reg.set("ProxyEnable", "REG_DWORD", "0x0");
    let sp = env.manager(&fresh_dir("wpad-cycle"));
    sp.enable("127.0.0.1", 2080).unwrap();
    assert_eq!(env.conns.lan().flags, DIRECT | PROXY, "WPAD у LAN снят");
    assert_eq!(env.conns.entry("Office VPN").flags, DIRECT | PROXY);
    sp.disable().unwrap();
    assert_eq!(env.conns.lan().flags, DIRECT | AUTO_DETECT);
    assert_eq!(env.conns.entry("Office VPN"), conn(AUTO_DETECT, None, None));
}

#[test]
fn lan_flags_are_rebuilt_from_the_restored_registry() {
    // Корпоративный прокси и PAC рядом с автоопределением: после отката флаги
    // LAN совпадают с реестром, который откат только что записал.
    let env = Env::new(DIRECT | PROXY | AUTO_PROXY_URL | AUTO_DETECT, &[]);
    env.reg.set("ProxyEnable", "REG_DWORD", "0x1");
    env.reg.set("ProxyServer", "REG_SZ", "corp.proxy:8080");
    env.reg
        .set("AutoConfigURL", "REG_SZ", "http://pac.corp/wpad.dat");
    let sp = env.manager(&fresh_dir("wpad-rebuild"));
    sp.enable("127.0.0.1", 2080).unwrap();
    assert_eq!(env.conns.lan().flags, DIRECT | PROXY);
    sp.disable().unwrap();
    assert_eq!(
        env.conns.lan().flags,
        DIRECT | PROXY | AUTO_PROXY_URL | AUTO_DETECT
    );
    assert_eq!(
        env.reg.dump()["ProxyServer"],
        RegValue::sz("corp.proxy:8080")
    );
}

#[test]
fn lan_without_wpad_is_not_written_at_all() {
    let env = Env::new(DIRECT, &[]);
    env.reg.set("ProxyEnable", "REG_DWORD", "0x0");
    let sp = env.manager(&fresh_dir("wpad-off"));
    sp.enable("127.0.0.1", 2080).unwrap();
    assert_eq!(env.conns.lan().flags, DIRECT);
    sp.disable().unwrap();
    assert_eq!(env.conns.lan().flags, DIRECT);
}

#[test]
fn wpad_switched_on_by_the_user_during_the_session_stays_on() {
    let env = Env::new(DIRECT | AUTO_DETECT, &[]);
    env.reg.set("ProxyEnable", "REG_DWORD", "0x0");
    let sp = env.manager(&fresh_dir("wpad-user"));
    sp.enable("127.0.0.1", 2080).unwrap();
    // Пользователь сам включил автоопределение обратно (и оно не наше).
    let user_flags = DIRECT | PROXY | AUTO_DETECT;
    let change = ConnChange {
        flags: Some(user_flags),
        ..ConnChange::default()
    };
    env.conns.set(None, &change).unwrap();
    sp.disable().unwrap();
    assert_eq!(
        env.conns.lan().flags,
        user_flags,
        "правка пользователя цела"
    );
}

/// Снимок 0.3.0 (формат 2: `original` + `applied`, без `wpad` и `ras`)
/// восстанавливается: LAN возвращается, подключения RAS и флаги не трогаются.
#[test]
fn old_snapshot_without_ras_and_wpad_still_recovers() {
    let office = conn(AUTO_DETECT, Some("kept:1"), None);
    let env = Env::new(DIRECT | AUTO_DETECT, &[("Office VPN", office.clone())]);
    env.reg.set("ProxyEnable", "REG_DWORD", "0x1");
    env.reg.set("ProxyServer", "REG_SZ", "127.0.0.1:2080");
    let dir = fresh_dir("old-snapshot");
    let original = json!({"version": 2, "os": "windows", "data": {
        "proxy": {
            "ProxyEnable": {"type": "REG_DWORD", "data": "0x0"},
            "ProxyServer": null,
        },
        "ProxyOverride": null,
        "AutoConfigURL": {"type": "REG_SZ", "data": "http://pac.corp/wpad.dat"},
    }});
    let applied = json!({"version": 2, "os": "windows", "data": {
        "proxy": {
            "ProxyEnable": {"type": "REG_DWORD", "data": "0x1"},
            "ProxyServer": {"type": "REG_SZ", "data": "127.0.0.1:2080"},
        },
        "ProxyOverride": null,
        "AutoConfigURL": null,
    }});
    let stored = json!({"original": original, "applied": applied});
    std::fs::write(dir.join("sysproxy.snapshot.json"), stored.to_string()).unwrap();
    let sp = env.manager(&dir);
    assert!(sp.recover_if_needed().unwrap());
    let reg = env.reg.dump();
    assert_eq!(reg["ProxyEnable"], RegValue::dword(0));
    assert_eq!(
        reg["AutoConfigURL"],
        RegValue::sz("http://pac.corp/wpad.dat")
    );
    assert!(!reg.contains_key("ProxyServer"));
    assert_eq!(
        env.conns.lan().flags,
        DIRECT | AUTO_DETECT,
        "LAN-флаги целы"
    );
    assert_eq!(env.conns.entry("Office VPN"), office, "RAS не тронут");
    assert!(sp.pending_snapshot().is_none());
}
