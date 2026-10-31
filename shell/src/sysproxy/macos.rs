// SPDX-License-Identifier: GPL-3.0-only

//! macOS: `networksetup`.

use super::ProxySnapshot;

fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("{cmd}: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "{cmd}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn active_service() -> Result<String, String> {
    let out = run("networksetup", &["-listallnetworkservices"])?;
    // Первая строка — заголовок; берём первый реальный сервис.
    out.lines()
        .skip(1)
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('*'))
        .map(str::to_string)
        .ok_or_else(|| "macOS: не найден сетевой сервис".to_string())
}

pub fn capture() -> Result<ProxySnapshot, String> {
    let svc = active_service()?;
    let web = run("networksetup", &["-getwebproxy", &svc]).unwrap_or_default();
    let secure = run("networksetup", &["-getsecurewebproxy", &svc]).unwrap_or_default();
    Ok(ProxySnapshot {
        version: 1,
        os: "macos".into(),
        data: serde_json::json!({
            "service": svc,
            "web": web,
            "secure": secure,
        }),
    })
}

pub fn apply(host: &str, port: u16) -> Result<(), String> {
    let svc = active_service()?;
    let p = port.to_string();
    run("networksetup", &["-setwebproxy", &svc, host, &p])?;
    run("networksetup", &["-setsecurewebproxy", &svc, host, &p])?;
    Ok(())
}

pub fn restore(snap: &ProxySnapshot) -> Result<(), String> {
    let svc = snap
        .data
        .get("service")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "снимок: нет service".to_string())?
        .to_string();
    for (key, on_flag, off_flag) in [
        ("web", "-setwebproxy", "-setwebproxystate"),
        ("secure", "-setsecurewebproxy", "-setsecurewebproxystate"),
    ] {
        let block = snap
            .data
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        // networksetup -getwebproxy: "Enabled: Yes\nServer: x\nPort: y"
        let get = |k: &str| {
            block
                .lines()
                .find_map(|l| l.trim().strip_prefix(k))
                .map(|v| v.trim().to_string())
        };
        match (get("Server:"), get("Port:")) {
            (Some(server), Some(port)) if !server.is_empty() => {
                run("networksetup", &[on_flag, &svc, &server, &port])?;
                let enabled = get("Enabled:").is_some_and(|v| v.eq_ignore_ascii_case("yes"));
                run(
                    "networksetup",
                    &[off_flag, &svc, if enabled { "on" } else { "off" }],
                )?;
            }
            _ => run("networksetup", &[off_flag, &svc, "off"])?,
        }
    }
    Ok(())
}

pub fn clear() -> Result<(), String> {
    let svc = active_service()?;
    run("networksetup", &["-setwebproxystate", &svc, "off"])?;
    run("networksetup", &["-setsecurewebproxystate", &svc, "off"])?;
    Ok(())
}
