//! sysproxy — системный прокси ОС (FR-UI-221/222/259).
//!
//! Принцип: перед изменением — снимок текущих настроек в файл рядом с
//! данными; при отключении/падении — восстановление снимка (не «выключить
//! прокси», а «вернуть как было»). Если приложение упало, следующий старт
//! находит незакрытый снимок и восстанавливает настройки (teardown-verify).
//!
//! Windows: WinINET через реестр (Internet Settings) + InternetSetOption
//! (WM_SETTINGCHANGE) — то, что видят Chrome/Edge/системные приложения.
//! Linux: gsettings (GNOME); KDE — kioslaverc (через `kwriteconfig5/6`).
//! macOS: `networksetup -setwebproxy/-setsecurewebproxy`.

use std::path::{Path, PathBuf};

/// Снимок предыдущих настроек прокси.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProxySnapshot {
    /// Версия формата (для будущих миграций).
    pub version: u32,
    /// ОС, где сделан снимок (`windows`/`linux`/`macos`).
    pub os: String,
    /// Параметры, которые надо восстановить (ОС-специфично).
    pub data: serde_json::Value,
}

/// Итог применения.
#[derive(Debug, Clone)]
pub struct Applied {
    /// Точка выхода прокси, которую увидит система.
    pub host: String,
    pub port: u16,
}

/// Менеджер системного прокси: снимок + применение + восстановление.
pub struct SysProxy {
    snapshot_path: PathBuf,
}

impl SysProxy {
    /// Менеджер с файлом снимка в каталоге данных.
    pub fn new(data_dir: &Path) -> Self {
        Self {
            snapshot_path: data_dir.join("sysproxy.snapshot.json"),
        }
    }

    /// Незакрытый снимок от прошлого запуска (приложение упало, не успев
    /// восстановить настройки) — надо откатить ДО нового применения.
    pub fn pending_snapshot(&self) -> Option<ProxySnapshot> {
        let raw = std::fs::read_to_string(&self.snapshot_path).ok()?;
        serde_json::from_str(&raw).ok()
    }

    /// Восстановить настройки из незакрытого снимка (idempotent).
    pub fn recover_if_needed(&self) -> Result<bool, String> {
        let Some(snap) = self.pending_snapshot() else {
            return Ok(false);
        };
        restore(&snap)?;
        let _ = std::fs::remove_file(&self.snapshot_path);
        Ok(true)
    }

    /// Включить системный прокси `host:port`, сохранив предыдущее состояние.
    pub fn enable(&self, host: &str, port: u16) -> Result<Applied, String> {
        // Повторное включение при живом снимке: сначала откатываем прошлое,
        // чтобы не затереть «настоящие» настройки пользователя нашими.
        let _ = self.recover_if_needed();
        let snap = capture()?;
        let raw = serde_json::to_string_pretty(&snap).map_err(|e| e.to_string())?;
        std::fs::write(&self.snapshot_path, raw).map_err(|e| format!("snapshot: {e}"))?;
        if let Err(e) = apply(host, port) {
            let _ = restore(&snap);
            let _ = std::fs::remove_file(&self.snapshot_path);
            return Err(e);
        }
        Ok(Applied {
            host: host.to_string(),
            port,
        })
    }

    /// Выключить: вернуть снимок (а не просто «очистить прокси»).
    ///
    /// Без снимка — no-op: значит, прокси включали не мы (или он уже снят),
    /// и стирать настройки пользователя (`clear()`) нельзя. Раньше здесь
    /// стоял `clear()`, из-за чего «Отключить» в приложении выключал
    /// собственный прокси пользователя, выставленный вручную.
    pub fn disable(&self) -> Result<(), String> {
        match self.pending_snapshot() {
            Some(snap) => {
                restore(&snap)?;
                let _ = std::fs::remove_file(&self.snapshot_path);
                Ok(())
            }
            None => Ok(()),
        }
    }

    /// Снять прокси при выходе приложения: восстановить снимок, если он есть.
    /// Отдельный метод, чтобы вызывать его и из команды выхода, и из трея.
    pub fn release_on_quit(&self) -> Result<(), String> {
        self.disable()
    }
}

// ============================================================================
// Windows: WinINET через реестр
// ============================================================================

#[cfg(windows)]
mod imp {
    use super::ProxySnapshot;
    use std::os::windows::process::CommandExt;

    const REG_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn reg(args: &[&str]) -> Result<String, String> {
        let out = std::process::Command::new("reg")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("reg: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "reg {}: {}",
                args.first().unwrap_or(&""),
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn query(name: &str) -> Option<String> {
        let out = reg(&["query", REG_KEY, "/v", name]).ok()?;
        // Формат: "    ProxyEnable    REG_DWORD    0x1"
        let line = out.lines().find(|l| l.contains(name))?;
        let mut parts = line.split_whitespace();
        let _ = parts.next()?; // имя
        let _ = parts.next()?; // тип
        parts.next().map(str::to_string)
    }

    pub fn capture() -> Result<ProxySnapshot, String> {
        Ok(ProxySnapshot {
            version: 1,
            os: "windows".into(),
            data: serde_json::json!({
                "ProxyEnable": query("ProxyEnable"),
                "ProxyServer": query("ProxyServer"),
                "ProxyOverride": query("ProxyOverride"),
                "AutoConfigURL": query("AutoConfigURL"),
            }),
        })
    }

    fn set_dword(name: &str, value: u32) -> Result<(), String> {
        reg(&[
            "add",
            REG_KEY,
            "/v",
            name,
            "/t",
            "REG_DWORD",
            "/d",
            &format!("{value}"),
            "/f",
        ])
        .map(|_| ())
    }

    fn set_sz(name: &str, value: &str) -> Result<(), String> {
        reg(&[
            "add", REG_KEY, "/v", name, "/t", "REG_SZ", "/d", value, "/f",
        ])
        .map(|_| ())
    }

    fn delete(name: &str) -> Result<(), String> {
        // Удаление отсутствующего значения — не ошибка для нас.
        let _ = reg(&["delete", REG_KEY, "/v", name, "/f"]);
        Ok(())
    }

    /// Уведомить WinINET об изменении (без этого Chrome видит старый прокси).
    fn notify() {
        use windows_sys::Win32::Networking::WinInet::{
            InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
        };
        // SAFETY: вызов без параметров (hInternet = null), документирован
        // WinINet: уведомляет систему о смене настроек прокси в реестре.
        unsafe {
            InternetSetOptionW(
                std::ptr::null_mut(),
                INTERNET_OPTION_SETTINGS_CHANGED,
                std::ptr::null_mut(),
                0,
            );
            InternetSetOptionW(
                std::ptr::null_mut(),
                INTERNET_OPTION_REFRESH,
                std::ptr::null_mut(),
                0,
            );
        }
    }

    pub fn apply(host: &str, port: u16) -> Result<(), String> {
        set_sz("ProxyServer", &format!("{host}:{port}"))?;
        // Локальные адреса и типичные внутренние сети — мимо прокси.
        set_sz(
            "ProxyOverride",
            "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;\
             172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;\
             172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>",
        )?;
        // PAC-скрипт несовместим с ручным прокси — убираем на время сессии
        // (значение сохранено в снимке и вернётся при выключении).
        delete("AutoConfigURL")?;
        set_dword("ProxyEnable", 1)?;
        notify();
        Ok(())
    }

    pub fn restore(snap: &ProxySnapshot) -> Result<(), String> {
        let d = &snap.data;
        let str_of = |k: &str| d.get(k).and_then(|v| v.as_str()).map(str::to_string);
        let dword_of = |k: &str| {
            d.get(k)
                .and_then(|v| v.as_str())
                .and_then(|s| s.trim_start_matches("0x").parse::<u32>().ok())
                .or_else(|| d.get(k).and_then(|v| v.as_u64()).map(|n| n as u32))
        };
        match str_of("ProxyServer") {
            Some(v) if !v.is_empty() => set_sz("ProxyServer", &v)?,
            _ => delete("ProxyServer")?,
        }
        match str_of("ProxyOverride") {
            Some(v) if !v.is_empty() => set_sz("ProxyOverride", &v)?,
            _ => delete("ProxyOverride")?,
        }
        match str_of("AutoConfigURL") {
            Some(v) if !v.is_empty() => set_sz("AutoConfigURL", &v)?,
            _ => delete("AutoConfigURL")?,
        }
        set_dword("ProxyEnable", dword_of("ProxyEnable").unwrap_or(0))?;
        notify();
        Ok(())
    }

    pub fn clear() -> Result<(), String> {
        set_dword("ProxyEnable", 0)?;
        notify();
        Ok(())
    }
}

// ============================================================================
// macOS: networksetup
// ============================================================================

#[cfg(target_os = "macos")]
mod imp {
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
}

// ============================================================================
// Linux: gsettings (GNOME) / kwriteconfig (KDE)
// ============================================================================

#[cfg(all(unix, not(target_os = "macos")))]
mod imp {
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
}

pub use imp::{apply, capture, clear, restore};

#[cfg(test)]
mod tests {
    use super::*;

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
}
