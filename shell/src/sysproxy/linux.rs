// SPDX-License-Identifier: GPL-3.0-only

//! Linux: gsettings (GNOME). KDE — вручную (kwriteconfig+D-Bus — цель,
//! см. PLATFORM-MATRIX); в остальных средах системный прокси не применяется.

use super::ProxySnapshot;

fn gsettings() -> bool {
    std::process::Command::new("gsettings")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn get_gnome(key: &str) -> Option<String> {
    let out = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.system.proxy", key])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn set_gnome(schema_key: &str, value: &str) -> Result<(), String> {
    let out = std::process::Command::new("gsettings")
        .args(["set", "org.gnome.system.proxy", schema_key, value])
        .output()
        .map_err(|e| format!("gsettings: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "gsettings set {schema_key}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

pub fn capture() -> Result<ProxySnapshot, String> {
    if gsettings() {
        return Ok(ProxySnapshot {
            version: 1,
            os: "linux".into(),
            data: serde_json::json!({
                "backend": "gnome",
                "mode": get_gnome("mode"),
                "http_host": get_gnome("http.host"),
                "http_port": get_gnome("http.port"),
                "https_host": get_gnome("https.host"),
                "https_port": get_gnome("https.port"),
            }),
        });
    }
    Ok(ProxySnapshot {
        version: 1,
        os: "linux".into(),
        data: serde_json::json!({"backend": "unsupported"}),
    })
}

pub fn apply(host: &str, port: u16) -> Result<(), String> {
    if !gsettings() {
        return Err("системный прокси: поддерживается GNOME/gsettings; \
                    для KDE включите прокси вручную"
            .to_string());
    }
    set_gnome("mode", "'manual'")?;
    set_gnome("http.host", &format!("'{host}'"))?;
    set_gnome("http.port", &port.to_string())?;
    set_gnome("https.host", &format!("'{host}'"))?;
    set_gnome("https.port", &port.to_string())?;
    Ok(())
}

pub fn restore(snap: &ProxySnapshot) -> Result<(), String> {
    if !gsettings() {
        return Ok(());
    }
    let d = &snap.data;
    if d.get("backend").and_then(|v| v.as_str()) != Some("gnome") {
        return clear();
    }
    for (key, dv) in [
        ("mode", "mode"),
        ("http.host", "http_host"),
        ("http.port", "http_port"),
        ("https.host", "https_host"),
        ("https.port", "https_port"),
    ] {
        if let Some(v) = d.get(dv).and_then(|v| v.as_str()) {
            let _ = set_gnome(key, v);
        }
    }
    Ok(())
}

pub fn clear() -> Result<(), String> {
    if !gsettings() {
        return Ok(());
    }
    set_gnome("mode", "'none'")
}
