// SPDX-License-Identifier: GPL-3.0-only

//! Linux: системный прокси — GNOME (gsettings) и KDE Plasma (kioslaverc).
//! Приоритет: KDE-сеанс → kioslaverc; иначе gsettings; иначе не применяется.
//! В остальных средах (XFCE, Sway…) системный прокси не управляется —
//! используйте TUN.

use super::ProxySnapshot;

fn gsettings() -> bool {
    std::process::Command::new("gsettings")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success())
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

/// Активный бэкенд: KDE (kioslaverc) или GNOME (gsettings).
fn backend() -> Option<&'static str> {
    if super::kde::is_kde() {
        return Some("kde");
    }
    if gsettings() {
        return Some("gnome");
    }
    None
}

pub fn capture() -> Result<ProxySnapshot, String> {
    match backend() {
        Some("kde") => {
            let path = super::kde::config_path().ok_or("HOME не задан: kioslaverc недоступен")?;
            super::kde::capture_at(&path)
        }
        Some("gnome") => Ok(ProxySnapshot {
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
        }),
        _ => Ok(ProxySnapshot {
            version: 1,
            os: "linux".into(),
            data: serde_json::json!({"backend": "unsupported"}),
        }),
    }
}

pub fn apply(host: &str, port: u16) -> Result<(), String> {
    match backend() {
        Some("kde") => {
            let path = super::kde::config_path().ok_or("HOME не задан: kioslaverc недоступен")?;
            super::kde::apply_at(&path, host, port)?;
            super::kde::notify_kde();
            Ok(())
        }
        Some("gnome") => {
            set_gnome("mode", "'manual'")?;
            set_gnome("http.host", &format!("'{host}'"))?;
            set_gnome("http.port", &port.to_string())?;
            set_gnome("https.host", &format!("'{host}'"))?;
            set_gnome("https.port", &port.to_string())
        }
        _ => Err(
            "системный прокси: поддерживаются GNOME (gsettings) и KDE (kioslaverc); \
                  в этой среде используйте TUN"
                .to_string(),
        ),
    }
}

pub fn restore(snap: &ProxySnapshot) -> Result<(), String> {
    let snap_backend = snap.data.get("backend").and_then(|v| v.as_str());
    match snap_backend {
        Some("kde") => {
            if let Some(path) = super::kde::config_path() {
                super::kde::restore_at(&path, snap)?;
                super::kde::notify_kde();
            }
            Ok(())
        }
        Some("gnome") => {
            if !gsettings() {
                return Ok(());
            }
            let d = &snap.data;
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
        _ => clear(),
    }
}

pub fn clear() -> Result<(), String> {
    match backend() {
        Some("kde") => {
            if let Some(path) = super::kde::config_path() {
                super::kde::clear_at(&path)?;
                super::kde::notify_kde();
            }
            Ok(())
        }
        Some("gnome") => set_gnome("mode", "'none'"),
        _ => Ok(()),
    }
}
