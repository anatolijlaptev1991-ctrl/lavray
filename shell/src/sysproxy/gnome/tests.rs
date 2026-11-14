// SPDX-License-Identifier: GPL-3.0-only

use super::*;

fn line(s: &Setting) -> String {
    format!("{} {} {}", s.schema, s.key, s.value)
}

#[test]
fn enable_uses_the_real_schemas_and_keys() {
    let lines: Vec<String> = enable_settings("127.0.0.1", 8080)
        .iter()
        .map(line)
        .collect();
    assert_eq!(
        lines,
        [
            "org.gnome.system.proxy.http host '127.0.0.1'",
            "org.gnome.system.proxy.http port 8080",
            "org.gnome.system.proxy.https host '127.0.0.1'",
            "org.gnome.system.proxy.https port 8080",
            "org.gnome.system.proxy ignore-hosts ['localhost', '127.0.0.0/8', '::1', \
             '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']",
            "org.gnome.system.proxy mode 'manual'",
        ]
    );
}

#[test]
fn mode_is_switched_last() {
    let settings = enable_settings("h", 1);
    assert_eq!(settings.last().map(|s| s.key), Some("mode"));
    assert_eq!(KEYS.last().map(|k| k.2), Some("mode"));
}

#[test]
fn no_setting_uses_a_dotted_key() {
    for s in enable_settings("h", 1) {
        assert!(!s.key.contains('.'), "{}", s.key);
    }
    for (_, _, key) in KEYS {
        assert!(!key.contains('.'), "{key}");
    }
}

#[test]
fn quotes_are_escaped() {
    assert_eq!(quote("a'b\\c"), "'a\\'b\\\\c'");
}

#[test]
fn disable_sets_mode_none() {
    let lines: Vec<String> = disable_settings().iter().map(line).collect();
    assert_eq!(lines, ["org.gnome.system.proxy mode 'none'"]);
}

fn fake_value(schema: &str, key: &str) -> String {
    format!("<{schema}|{key}>")
}

#[test]
fn snapshot_holds_every_changed_key() {
    let snap = capture_with(|schema, key| Ok(fake_value(schema, key))).unwrap();
    assert_eq!(snap.version, SNAPSHOT_VERSION);
    assert_eq!(snap.data["backend"], "gnome");
    for (field, schema, key) in KEYS {
        assert_eq!(snap.data[field], format!("<{schema}|{key}>"));
    }
    assert!(snap.data.get("ignore_hosts").is_some());
}

#[test]
fn a_failed_read_aborts_the_snapshot() {
    let result = capture_with(|_, key| {
        if key == "port" {
            Err("нет ключа".to_string())
        } else {
            Ok("x".to_string())
        }
    });
    assert_eq!(result.unwrap_err(), "нет ключа");
}

#[test]
fn snapshot_round_trips_through_restore() {
    let snap = capture_with(|schema, key| Ok(fake_value(schema, key))).unwrap();
    let restored = restore_settings(&snap.data);
    assert_eq!(restored.len(), KEYS.len());
    for (set, (_, schema, key)) in restored.iter().zip(KEYS) {
        assert_eq!((set.schema, set.key), (schema, key));
        assert_eq!(set.value, format!("<{schema}|{key}>"));
    }
    assert_eq!(restored.last().map(|s| s.key), Some("mode"));
}

#[test]
fn a_version_1_snapshot_restores_without_panic() {
    let old = serde_json::json!({
        "backend": "gnome",
        "mode": "'none'",
        "http_host": null,
        "http_port": null,
        "https_host": null,
        "https_port": null,
    });
    let restored = restore_settings(&old);
    assert_eq!(restored.len(), 1);
    assert_eq!(line(&restored[0]), "org.gnome.system.proxy mode 'none'");
    assert!(restore_settings(&serde_json::json!({"backend": "gnome"})).is_empty());
    assert!(restore_settings(&serde_json::Value::Null).is_empty());
}
