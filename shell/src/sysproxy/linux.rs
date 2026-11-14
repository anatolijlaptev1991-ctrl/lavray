// SPDX-License-Identifier: GPL-3.0-only

//! Linux: системный прокси — GNOME (gsettings) и KDE Plasma (kioslaverc).
//! Приоритет: KDE-сеанс → kioslaverc; иначе gsettings, если схема
//! `org.gnome.system.proxy` в системе есть; иначе понятная ошибка.
//! В остальных средах (XFCE, Sway…) системный прокси не управляется —
//! используйте TUN. Какие ключи ставить, решает чистый модуль [`super::gnome`];
//! здесь только вызовы `gsettings` с таймаутом.

use super::gnome::{self, Setting};
use super::ProxySnapshot;
use crate::exec::run_timeout;
use std::process::Command;
use std::time::Duration;

/// Предел одного вызова gsettings: без сеансовой шины он может зависнуть.
const GSETTINGS_TIMEOUT: Duration = Duration::from_secs(5);

const NO_BACKEND: &str = "системный прокси: поддерживаются GNOME (gsettings) и KDE (kioslaverc); \
                          в этой среде используйте TUN";

fn gsettings(args: &[&str]) -> Result<String, String> {
    let out = run_timeout(Command::new("gsettings").args(args), GSETTINGS_TIMEOUT)
        .map_err(|e| format!("gsettings {}: {e}", args.join(" ")))?;
    if !out.success() {
        return Err(format!(
            "gsettings {}: {}",
            args.join(" "),
            out.stderr.trim()
        ));
    }
    Ok(out.stdout.trim().to_string())
}

fn set_gnome(setting: &Setting) -> Result<(), String> {
    gsettings(&["set", setting.schema, setting.key, setting.value.as_str()]).map(|_| ())
}

/// Применить команды по порядку; первая ошибка прерывает (включение).
fn set_all(settings: &[Setting]) -> Result<(), String> {
    settings.iter().try_for_each(set_gnome)
}

/// Применить все команды, не останавливаясь на ошибке (возврат из снимка):
/// каждый ключ получает шанс вернуться, ошибки собираются в одну.
fn set_all_reporting(settings: &[Setting]) -> Result<(), String> {
    let errors: Vec<String> = settings
        .iter()
        .filter_map(|setting| set_gnome(setting).err())
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Схема прокси GNOME есть в системе (gsettings установлен и схема собрана).
fn gnome_schema_available() -> bool {
    gsettings(&["list-keys", gnome::PROXY]).is_ok()
}

/// Активный бэкенд.
enum Active {
    Kde,
    Gnome,
}

fn backend() -> Option<Active> {
    if super::kde::is_kde() {
        Some(Active::Kde)
    } else if gnome_schema_available() {
        Some(Active::Gnome)
    } else {
        None
    }
}

fn kde_path() -> Result<std::path::PathBuf, String> {
    super::kde::config_path().ok_or_else(|| "HOME не задан: kioslaverc недоступен".to_string())
}

pub fn capture() -> Result<ProxySnapshot, String> {
    match backend() {
        Some(Active::Kde) => super::kde::capture_at(&kde_path()?),
        Some(Active::Gnome) => gnome::capture_with(|schema, key| gsettings(&["get", schema, key])),
        None => Ok(ProxySnapshot {
            version: 1,
            os: "linux".into(),
            data: serde_json::json!({"backend": "unsupported"}),
        }),
    }
}

pub fn apply(host: &str, port: u16) -> Result<(), String> {
    match backend() {
        Some(Active::Kde) => {
            super::kde::apply_at(&kde_path()?, host, port)?;
            super::kde::notify_kde();
            Ok(())
        }
        Some(Active::Gnome) => set_all(&gnome::enable_settings(host, port)),
        None => Err(NO_BACKEND.to_string()),
    }
}

pub fn restore(snap: &ProxySnapshot) -> Result<(), String> {
    match snap.data.get("backend").and_then(|v| v.as_str()) {
        Some("kde") => {
            if let Some(path) = super::kde::config_path() {
                super::kde::restore_at(&path, snap)?;
                super::kde::notify_kde();
            }
            Ok(())
        }
        Some("gnome") => {
            // gsettings или схемы нет — вернуть нечего; иначе снимок не
            // удалялся бы и включение прокси блокировалось навсегда
            if !gnome_schema_available() {
                return Ok(());
            }
            set_all_reporting(&gnome::restore_settings(&snap.data))
        }
        _ => clear(),
    }
}

pub fn clear() -> Result<(), String> {
    match backend() {
        Some(Active::Kde) => {
            if let Some(path) = super::kde::config_path() {
                super::kde::clear_at(&path)?;
                super::kde::notify_kde();
            }
            Ok(())
        }
        Some(Active::Gnome) => set_all(&gnome::disable_settings()),
        None => Ok(()),
    }
}
