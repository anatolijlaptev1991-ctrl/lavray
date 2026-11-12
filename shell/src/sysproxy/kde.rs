// SPDX-License-Identifier: GPL-3.0-only

//! KDE Plasma: системный прокси через `~/.config/kioslaverc` (KIO slave).
//! INI, секция `[Proxy Settings]`, `ProxyType`: 0=нет, 1=ручной, 2=PAC, 3=WPAD.
//! После записи — D-Bus сигнал `reparseConfiguration` (kded5/6); без D-Bus
//! изменения подхватятся при следующем входе. Путь передаётся явно (тесты).

use super::ProxySnapshot;
use std::path::{Path, PathBuf};

/// Путь к kioslaverc текущего пользователя.
pub fn config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".config").join("kioslaverc"))
}

/// KDE-сеанс активен: `KDE_SESSION_VERSION` или `KDE_FULL_SESSION`.
pub fn is_kde() -> bool {
    std::env::var_os("KDE_SESSION_VERSION").is_some()
        || std::env::var_os("KDE_FULL_SESSION").is_some()
}

/// Разобранная секция `[Proxy Settings]`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KdeProxy {
    pub proxy_type: u8,
    pub http: String,
    pub https: String,
    pub no_proxy: String,
}

/// Разобрать kioslaverc: только секция `[Proxy Settings]`.
pub fn parse(text: &str) -> KdeProxy {
    let mut out = KdeProxy::default();
    let mut in_section = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_section = line.eq_ignore_ascii_case("[Proxy Settings]");
            continue;
        }
        if !in_section || line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, val)) = line.split_once('=') else {
            continue;
        };
        match key.trim() {
            "ProxyType" => out.proxy_type = val.trim().parse().unwrap_or(0),
            "httpProxy" => out.http = val.trim().to_owned(),
            "httpsProxy" => out.https = val.trim().to_owned(),
            "NoProxyFor" => out.no_proxy = val.trim().to_owned(),
            _ => {}
        }
    }
    out
}

/// Сериализовать в INI: `[Proxy Settings]` перезаписывается, остальные секции сохраняются.
pub fn render(original: &str, proxy: &KdeProxy) -> String {
    let mut out = String::with_capacity(original.len() + 128);
    let mut in_section = false;
    let mut written = false;
    for line in original.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if in_section && !written {
                write_proxy_keys(&mut out, proxy);
                written = true;
            }
            in_section = trimmed.eq_ignore_ascii_case("[Proxy Settings]");
            out.push_str(line);
            out.push('\n');
            if in_section {
                write_proxy_keys(&mut out, proxy);
                written = true;
            }
            continue;
        }
        if in_section {
            let key = trimmed.split('=').next().unwrap_or("").trim();
            if matches!(key, "ProxyType" | "httpProxy" | "httpsProxy" | "NoProxyFor") {
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    if !written {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str("[Proxy Settings]\n");
        write_proxy_keys(&mut out, proxy);
    }
    out
}

fn write_proxy_keys(out: &mut String, p: &KdeProxy) {
    use std::fmt::Write;
    let _ = write!(
        out,
        "ProxyType={}\nhttpProxy={}\nhttpsProxy={}\nNoProxyFor={}\n",
        p.proxy_type, p.http, p.https, p.no_proxy
    );
}

fn json_str(d: &serde_json::Value, key: &str) -> String {
    d.get(key).and_then(|v| v.as_str()).unwrap_or("").to_owned()
}

/// Снимок текущего состояния KDE-прокси.
pub fn capture_at(path: &Path) -> Result<ProxySnapshot, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let p = parse(&text);
    Ok(ProxySnapshot {
        version: 1,
        os: "linux".into(),
        data: serde_json::json!({
            "backend": "kde", "proxy_type": p.proxy_type,
            "http": p.http, "https": p.https, "no_proxy": p.no_proxy,
        }),
    })
}

/// Применить ручной прокси (ProxyType=1).
pub fn apply_at(path: &Path, host: &str, port: u16) -> Result<(), String> {
    let original = std::fs::read_to_string(path).unwrap_or_default();
    let mut p = parse(&original);
    p.proxy_type = 1;
    p.http = format!("http://{host}:{port}");
    p.https = format!("http://{host}:{port}");
    write_rendered(path, &original, &p)
}

/// Восстановить снимок.
pub fn restore_at(path: &Path, snap: &ProxySnapshot) -> Result<(), String> {
    let d = &snap.data;
    if d.get("backend").and_then(|v| v.as_str()) != Some("kde") {
        return clear_at(path);
    }
    let original = std::fs::read_to_string(path).unwrap_or_default();
    let p = KdeProxy {
        proxy_type: d.get("proxy_type").and_then(|v| v.as_u64()).unwrap_or(0) as u8,
        http: json_str(d, "http"),
        https: json_str(d, "https"),
        no_proxy: json_str(d, "no_proxy"),
    };
    write_rendered(path, &original, &p)
}

/// Снять прокси (ProxyType=0).
pub fn clear_at(path: &Path) -> Result<(), String> {
    let original = std::fs::read_to_string(path).unwrap_or_default();
    let mut p = parse(&original);
    p.proxy_type = 0;
    p.http.clear();
    p.https.clear();
    write_rendered(path, &original, &p)
}

fn write_rendered(path: &Path, original: &str, p: &KdeProxy) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(path, render(original, p)).map_err(|e| format!("{}: {e}", path.display()))
}

/// Уведомить KDE (D-Bus → kded). Best-effort: без D-Bus — при следующем входе.
pub fn notify_kde() {
    for ver in ["6", "5"] {
        let dest = format!("org.kde.kded{ver}");
        let _ = std::process::Command::new("dbus-send")
            .args([
                "--type=signal",
                "--dest",
                &dest,
                "/kded",
                &format!("{dest}.reparseConfiguration"),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

#[cfg(test)]
#[path = "kde_tests.rs"]
mod tests;
