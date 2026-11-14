// SPDX-License-Identifier: GPL-3.0-only

//! Возможности оболочки на этой ОС (`shell_capabilities`): интерфейс по ним
//! скрывает недоступное (снимок экрана на Linux, самообновление, сочетания
//! клавиш под Wayland) вместо кнопок, которые не сработают. Решения — чистые
//! функции от фактов, тесты идут на любой ОС.

#[cfg(test)]
mod tests;
mod tray;
mod watch;

use serde::Serialize;
use std::path::{Path, PathBuf};

pub use tray::{
    mark_tray_failed, parse_name_has_owner, start_tray_watch, tray_available, tray_for_caps,
    wait_tray,
};
pub use watch::Watch;

/// Операционная система.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    Linux,
    Macos,
}

impl Os {
    #[must_use]
    pub const fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Macos
        } else {
            Self::Linux
        }
    }

    const fn name(self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Linux => "linux",
            Self::Macos => "macos",
        }
    }
}

/// Ответ `shell_capabilities`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCapabilities {
    /// `windows`, `linux` или `macos`.
    pub os: &'static str,
    /// `wayland`, `x11` или пусто (не Linux, сеанс неизвестен).
    pub session_type: &'static str,
    /// `installed`, `portable` (Windows); `deb`, `appimage`, `other` (Linux).
    pub packaging: &'static str,
    /// `admin` — права даёт запуск от администратора; `grant` — выдача прав
    /// ядру (`tun_access_state`, `tun_access_grant`).
    pub tun_access: &'static str,
    pub screen_capture: bool,
    pub self_update: bool,
    pub global_hotkeys: bool,
    pub tray_available: bool,
}

/// Собрать ответ из фактов.
#[must_use]
pub fn build(
    os: Os,
    session_type: &'static str,
    packaging: &'static str,
    tray: bool,
) -> ShellCapabilities {
    let linux = os == Os::Linux;
    ShellCapabilities {
        os: os.name(),
        session_type: if linux { session_type } else { "" },
        packaging,
        tun_access: if linux { "grant" } else { "admin" },
        screen_capture: os == Os::Windows,
        self_update: os == Os::Windows,
        global_hotkeys: !linux || session_type == "x11",
        tray_available: tray,
    }
}

/// Тип сеанса: `XDG_SESSION_TYPE`, а без него — по `WAYLAND_DISPLAY`/`DISPLAY`.
#[must_use]
pub fn session_type(xdg: Option<&str>, wayland_display: bool, display: bool) -> &'static str {
    match xdg {
        Some("wayland") => "wayland",
        Some("x11") => "x11",
        _ if wayland_display => "wayland",
        _ if display => "x11",
        _ => "",
    }
}

/// Способ установки на Linux: `AppImage`, пакет в `/usr` или `/opt`, прочее.
#[must_use]
pub fn packaging_linux(appimage: bool, exe: &Path) -> &'static str {
    if appimage {
        "appimage"
    } else if exe.starts_with("/usr") || exe.starts_with("/opt") {
        "deb"
    } else {
        "other"
    }
}

fn normalize(path: &str) -> String {
    path.to_lowercase()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

/// Windows: exe лежит под Program Files — установленная копия, иначе portable.
#[must_use]
pub fn packaging_windows(exe: &str, program_files: &[PathBuf]) -> &'static str {
    let exe = normalize(exe);
    let under = program_files.iter().any(|root| {
        let root = normalize(&root.to_string_lossy());
        !root.is_empty()
            && exe
                .strip_prefix(&root)
                .is_some_and(|rest| rest.starts_with('/'))
    });
    if under {
        "installed"
    } else {
        "portable"
    }
}

/// Каталоги Program Files из окружения (для подсказки интерфейсу этого достаточно).
fn program_files() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect()
}

fn current() -> ShellCapabilities {
    let os = Os::current();
    let exe = std::env::current_exe().unwrap_or_default();
    let packaging = match os {
        Os::Linux => packaging_linux(std::env::var_os("APPIMAGE").is_some(), &exe),
        Os::Windows => packaging_windows(&exe.to_string_lossy(), &program_files()),
        Os::Macos => "other",
    };
    let session = session_type(
        std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        std::env::var_os("WAYLAND_DISPLAY").is_some(),
        std::env::var_os("DISPLAY").is_some(),
    );
    build(
        os,
        session,
        packaging,
        tray_for_caps(std::time::Duration::from_millis(300)),
    )
}

/// `shell_capabilities` — что умеет оболочка на этой ОС.
#[tauri::command]
pub async fn shell_capabilities() -> Result<ShellCapabilities, String> {
    tauri::async_runtime::spawn_blocking(current)
        .await
        .map_err(|e| e.to_string())
}
