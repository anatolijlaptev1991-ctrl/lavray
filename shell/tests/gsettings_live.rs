// SPDX-License-Identifier: GPL-3.0-only
#![cfg(target_os = "linux")]

//! Живая проверка системного прокси GNOME настоящим `gsettings`: включить,
//! прочитать значения, вернуть снимок, сверить. Тест `#[ignore]`: ему нужны
//! `gsettings`, схема `org.gnome.system.proxy` и сеансовая шина D-Bus. В CI он
//! идёт под `dbus-run-session` с временным `XDG_CONFIG_HOME`:
//!
//! ```text
//! dbus-run-session -- cargo test --test gsettings_live -- --ignored
//! ```
//!
//! На своей машине запускать его нельзя без изоляции: он меняет настройки
//! прокси текущего сеанса (и возвращает их).

use lavray_shell::sysproxy::SysProxy;
use std::process::Command;

const PROXY: &str = "org.gnome.system.proxy";
const HTTP: &str = "org.gnome.system.proxy.http";
const HTTPS: &str = "org.gnome.system.proxy.https";

fn gsettings(args: &[&str]) -> String {
    let out = Command::new("gsettings")
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("gsettings {args:?}: {e}"));
    assert!(
        out.status.success(),
        "gsettings {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn get(schema: &str, key: &str) -> String {
    gsettings(&["get", schema, key])
}

fn set(schema: &str, key: &str, value: &str) {
    gsettings(&["set", schema, key, value]);
}

/// Все ключи, которые трогает оболочка.
fn read_all() -> Vec<String> {
    [
        (PROXY, "mode"),
        (PROXY, "ignore-hosts"),
        (HTTP, "host"),
        (HTTP, "port"),
        (HTTPS, "host"),
        (HTTPS, "port"),
    ]
    .iter()
    .map(|(schema, key)| get(schema, key))
    .collect()
}

#[test]
#[ignore = "нужны gsettings и сеансовая шина D-Bus (в CI: dbus-run-session)"]
fn system_proxy_round_trips_through_real_gsettings() {
    assert!(
        std::env::var_os("KDE_SESSION_VERSION").is_none()
            && std::env::var_os("KDE_FULL_SESSION").is_none(),
        "в KDE-сеансе выбирается kioslaverc, а не gsettings"
    );
    // Нестандартное начальное состояние: возврат должен быть настоящим.
    set(HTTP, "host", "'previous.example'");
    set(HTTP, "port", "3128");
    set(PROXY, "mode", "'none'");
    let before = read_all();

    let dir = std::env::temp_dir().join(format!("lavray-gsettings-live-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let proxy = SysProxy::new(&dir);
    proxy.enable("127.0.0.1", 18080).expect("enable");

    assert_eq!(get(PROXY, "mode"), "'manual'");
    for schema in [HTTP, HTTPS] {
        assert_eq!(get(schema, "host"), "'127.0.0.1'", "{schema}");
        assert_eq!(get(schema, "port"), "18080", "{schema}");
    }
    let ignore = get(PROXY, "ignore-hosts");
    for local in ["'localhost'", "'127.0.0.0/8'", "'::1'", "'192.168.0.0/16'"] {
        assert!(ignore.contains(local), "{local} нет в {ignore}");
    }

    proxy.disable().expect("disable");
    assert_eq!(read_all(), before, "настройки вернулись не полностью");
    let _ = std::fs::remove_dir_all(&dir);
}
