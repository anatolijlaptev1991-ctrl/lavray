// SPDX-License-Identifier: GPL-3.0-only

//! Прокси на подключениях RAS/VPN (T-82). Реестр, WinINET и список RAS —
//! подставные (`fakes.rs`), настоящую ОС тесты не трогают.

use super::conn::{ConnChange, ConnSettings, Connections, AUTO_DETECT, DIRECT, PROXY};
use super::fakes::{conn, fresh_dir, state, vpn_env, Env, HOME, OFFICE};
use super::values::{RegValue, BYPASS};
use super::{windows::Windows, SysProxy};
use serde_json::json;

#[test]
fn ras_connections_receive_proxy() {
    let env = vpn_env();
    let sp = env.manager(&fresh_dir("ras-receive"));
    let applied = sp.enable("127.0.0.1", 2080).unwrap();
    assert!(applied.warnings.is_empty(), "{:?}", applied.warnings);
    for name in [OFFICE, HOME] {
        let entry = env.conns.entry(name);
        assert_eq!(entry.flags, DIRECT | PROXY, "{name}");
        assert_eq!(entry.server.as_deref(), Some("127.0.0.1:2080"), "{name}");
        assert_eq!(entry.bypass.as_deref(), Some(BYPASS), "{name}");
    }
    // LAN - как и раньше, через реестр.
    assert_eq!(
        env.reg.dump()["ProxyServer"],
        RegValue::sz("127.0.0.1:2080")
    );
    assert!(env.conns.refreshes.get() > 0, "система уведомлена");
}

#[test]
fn snapshot_includes_ras() {
    let env = vpn_env();
    let dir = fresh_dir("ras-snapshot");
    let sp = env.manager(&dir);
    sp.enable("127.0.0.1", 2080).unwrap();
    let snap = sp.pending_snapshot().unwrap();
    assert_eq!(snap.version, 3);
    assert_eq!(snap.data["wpad"], true);
    assert_eq!(snap.data["ras"][OFFICE]["wpad"], true);
    assert_eq!(snap.data["ras"][OFFICE]["proxy"]["on"], false);
    let home = json!({"on": true, "server": "corp.proxy:8080"});
    assert_eq!(snap.data["ras"][HOME]["proxy"], home);
    // В файле рядом с исходным лежит то, что поставили мы.
    let raw = std::fs::read_to_string(dir.join("sysproxy.snapshot.json")).unwrap();
    let file: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let ours = &file["applied"]["data"]["ras"][HOME];
    assert_eq!(ours["proxy"]["server"], "127.0.0.1:2080");
    assert_eq!(ours["wpad"], false);
}

#[test]
fn crash_recovery_restores_ras() {
    let env = vpn_env();
    let before = state(&env);
    let dir = fresh_dir("ras-crash");
    env.manager(&dir).enable("127.0.0.1", 2080).unwrap();
    assert_ne!(state(&env), before);
    // «Процесс упал»: disable() не вызывался, новый менеджер видит снимок.
    assert!(env.manager(&dir).recover_if_needed().unwrap());
    assert_eq!(state(&env), before);
}

#[test]
fn double_enable_keeps_the_ras_and_wpad_originals() {
    let env = vpn_env();
    let before = state(&env);
    let sp = env.manager(&fresh_dir("ras-double"));
    sp.enable("127.0.0.1", 2080).unwrap();
    sp.enable("127.0.0.1", 2081).unwrap();
    assert_eq!(
        env.conns.entry(HOME).server.as_deref(),
        Some("127.0.0.1:2081")
    );
    sp.disable().unwrap();
    assert_eq!(state(&env), before);
}

#[test]
fn three_way_respects_user_change_on_ras() {
    let env = vpn_env();
    let before = state(&env);
    let sp = env.manager(&fresh_dir("ras-user-change"));
    sp.enable("127.0.0.1", 2080).unwrap();
    // Пока LAVRay подключён, пользователь сам задал прокси домашнего VPN.
    let user = conn(PROXY, Some("10.9.9.9:3128"), None);
    env.conns.add(HOME, user.clone());
    sp.disable().unwrap();
    assert_eq!(env.conns.entry(HOME), user, "правка пользователя осталась");
    assert_eq!(env.conns.entry(OFFICE), before.2, "остальное возвращено");
    assert_eq!(env.conns.lan(), before.1);
}

#[test]
fn user_toggle_of_one_ras_slot_keeps_only_that_slot() {
    let env = vpn_env();
    let sp = env.manager(&fresh_dir("ras-slot"));
    sp.enable("127.0.0.1", 2080).unwrap();
    // Пользователь включил «Автоопределение» у домашнего VPN: наш прокси из
    // записи всё равно уходит, его галочка остаётся.
    let toggled = ConnSettings {
        flags: DIRECT | PROXY | AUTO_DETECT,
        ..env.conns.entry(HOME)
    };
    env.conns.add(HOME, toggled);
    sp.disable().unwrap();
    let home = env.conns.entry(HOME);
    assert_eq!(home.flags, DIRECT | PROXY | AUTO_DETECT);
    assert_eq!(home.server.as_deref(), Some("corp.proxy:8080"));
    assert_eq!(home.bypass, None);
}

#[test]
fn no_ras_entries_ok() {
    let env = Env::new(DIRECT, &[]);
    env.reg.set("ProxyEnable", "REG_DWORD", "0x0");
    let before = env.reg.dump();
    let sp = env.manager(&fresh_dir("ras-none"));
    let applied = sp.enable("127.0.0.1", 2080).unwrap();
    assert!(applied.warnings.is_empty());
    assert_eq!(sp.pending_snapshot().unwrap().data["ras"], json!({}));
    assert_eq!(
        env.reg.dump()["ProxyServer"],
        RegValue::sz("127.0.0.1:2080")
    );
    sp.disable().unwrap();
    assert_eq!(env.reg.dump(), before);
}

#[test]
fn connection_record_roundtrips_through_the_snapshot_format() {
    let rich = ConnSettings {
        flags: DIRECT | PROXY | AUTO_DETECT | super::conn::AUTO_PROXY_URL,
        server: Some("p:1".into()),
        bypass: Some("<local>".into()),
        pac_url: Some("http://pac/wpad.dat".into()),
    };
    let back = ConnSettings::from_record(&rich.to_record()).unwrap();
    assert_eq!(back, rich);
    assert!(ConnSettings::from_record(&json!("строка")).is_err());
}

/// WinINET, каким его увидел прогон 0.9.0 (D-1): запись подключения RAS
/// переписывает и общие значения LAN в реестре.
struct LanEcho<'a>(&'a Env);

impl Connections for LanEcho<'_> {
    fn get(&self, conn: Option<&str>) -> Result<ConnSettings, String> {
        self.0.conns.get(conn)
    }

    fn set(&self, conn: Option<&str>, change: &ConnChange) -> Result<(), String> {
        self.0.conns.set(conn, change)?;
        if conn.is_some() {
            let on = change.flags.is_some_and(|f| f & PROXY != 0);
            let reg = &self.0.reg;
            reg.set("ProxyEnable", "REG_DWORD", if on { "0x1" } else { "0x0" });
            if let Some(server) = &change.server {
                reg.set("ProxyServer", "REG_SZ", server);
            }
            if let Some(bypass) = &change.bypass {
                reg.set("ProxyOverride", "REG_SZ", bypass);
            }
        }
        Ok(())
    }
}

#[test]
fn lan_values_survive_wininet_echo_of_ras_writes() {
    let env = vpn_env();
    // Как на ПК прогона: прокси выключен, но адрес сервера в реестре задан.
    env.reg.set("ProxyServer", "REG_SZ", "127.0.0.1:2080");
    let before = state(&env);
    let backend = Windows {
        reg: &env.reg,
        conns: LanEcho(&env),
        ras: &env.ras,
    };
    let sp = SysProxy::with_backend(&fresh_dir("ras-echo"), backend);
    sp.enable("127.0.0.1", 9).unwrap();
    let on = env.reg.dump();
    assert_eq!(on["ProxyServer"], RegValue::sz("127.0.0.1:9"));
    assert_eq!(on["ProxyOverride"], RegValue::sz(BYPASS));
    assert_eq!(on["ProxyEnable"], RegValue::dword(1));
    sp.disable().unwrap();
    assert_eq!(state(&env), before);
}
