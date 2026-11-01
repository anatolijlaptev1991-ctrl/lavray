// SPDX-License-Identifier: GPL-3.0-only

//! Настройки оболочки из `ui-state.json` (T-82).
//!
//! Оболочка не связана с ядром и читает эти значения до создания окна, поэтому
//! они живут в общем файле настроек UI, а не в ядре. Значения пишет UI через
//! `localStorage` (ключи из [`crate::ui_state::ALLOWED_KEYS`]); здесь они
//! превращаются в типизированные поля с умолчаниями. Испорченное значение не
//! ломает запуск — берётся умолчание.

use crate::ui_state::Entries;

/// «Закрывать в трей»: крестик прячет окно (по умолчанию) или закрывает приложение.
pub const CLOSE_TO_TRAY: &str = "lavray.closeToTray";
/// «Запускать свёрнутым»: при обычном запуске окно не показывается, только значок.
pub const START_MINIMIZED: &str = "lavray.startMinimized";
/// Системные уведомления о подключении и ошибках.
pub const NOTIFY: &str = "lavray.notify";
/// Глобальное сочетание «подключить / отключить»; пусто — выключено.
pub const HOTKEY_CONNECT: &str = "lavray.hotkeyConnect";
/// Копия настройки ядра `connect.kill_switch_proxy`: не снимать системный прокси
/// при падении ядра (см. [`crate::killswitch`]).
pub const KILL_SWITCH_PROXY: &str = "lavray.killSwitchProxy";

/// Наибольшая длина сочетания клавиш в файле, байт: длиннее — мусор.
const MAX_ACCEL_BYTES: usize = 64;

/// Типизированные настройки оболочки.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellPrefs {
    pub close_to_tray: bool,
    pub start_minimized: bool,
    pub notify: bool,
    /// Сочетание как его сохранил UI; проверяется при регистрации.
    pub hotkey_connect: Option<String>,
    /// Не снимать системный прокси, когда ядро упало.
    pub kill_switch_proxy: bool,
}

impl Default for ShellPrefs {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            start_minimized: false,
            notify: true,
            hotkey_connect: None,
            kill_switch_proxy: false,
        }
    }
}

impl ShellPrefs {
    /// Настройки из `ui-state.json` в каталоге данных; файла нет или он испорчен — умолчания.
    pub fn load(data_dir: &std::path::Path) -> Self {
        Self::from_entries(&crate::ui_state::load(data_dir).entries)
    }

    /// Настройки из записей `ui-state.json`; чего нет или что испорчено — умолчание.
    pub fn from_entries(entries: &Entries) -> Self {
        let d = Self::default();
        Self {
            close_to_tray: flag(entries, CLOSE_TO_TRAY, d.close_to_tray),
            start_minimized: flag(entries, START_MINIMIZED, d.start_minimized),
            notify: flag(entries, NOTIFY, d.notify),
            hotkey_connect: accel(entries),
            kill_switch_proxy: flag(entries, KILL_SWITCH_PROXY, d.kill_switch_proxy),
        }
    }
}

/// Логическое значение: UI пишет `"1"`/`"0"`, старые записи могли быть `true`/`false`.
fn flag(entries: &Entries, key: &str, default: bool) -> bool {
    match entries.get(key).map(|v| v.trim()) {
        Some("1") | Some("true") => true,
        Some("0") | Some("false") => false,
        _ => default,
    }
}

fn accel(entries: &Entries) -> Option<String> {
    let raw = entries.get(HOTKEY_CONNECT)?.trim();
    if raw.is_empty() || raw.len() > MAX_ACCEL_BYTES {
        return None;
    }
    Some(raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(pairs: &[(&str, &str)]) -> Entries {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn prefs_defaults_when_missing() {
        let p = ShellPrefs::from_entries(&Entries::new());
        assert_eq!(p, ShellPrefs::default());
        assert!(p.close_to_tray, "по умолчанию крестик прячет в трей");
        assert!(!p.start_minimized);
        assert!(p.notify);
        assert_eq!(
            p.hotkey_connect, None,
            "горячая клавиша по умолчанию выключена"
        );
    }

    #[test]
    fn prefs_read_written_values() {
        let p = ShellPrefs::from_entries(&entries(&[
            (CLOSE_TO_TRAY, "0"),
            (START_MINIMIZED, "1"),
            (NOTIFY, "false"),
            (HOTKEY_CONNECT, " Ctrl+Alt+K "),
        ]));
        assert!(!p.close_to_tray);
        assert!(p.start_minimized);
        assert!(!p.notify);
        assert_eq!(p.hotkey_connect.as_deref(), Some("Ctrl+Alt+K"));
    }

    #[test]
    fn prefs_invalid_values_fall_back() {
        let long = "K".repeat(MAX_ACCEL_BYTES + 1);
        let p = ShellPrefs::from_entries(&entries(&[
            (CLOSE_TO_TRAY, "yes"),
            (START_MINIMIZED, ""),
            (NOTIFY, "2"),
            (HOTKEY_CONNECT, &long),
        ]));
        assert_eq!(p, ShellPrefs::default());
    }

    #[test]
    fn load_reads_the_ui_state_file_and_survives_its_absence() {
        let dir = std::env::temp_dir().join(format!("lavray-prefs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(ShellPrefs::load(&dir), ShellPrefs::default(), "файла нет");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(crate::ui_state::FILE_NAME), "{broken").unwrap();
        assert_eq!(
            ShellPrefs::load(&dir),
            ShellPrefs::default(),
            "файл испорчен"
        );
        crate::ui_state::set(&dir, CLOSE_TO_TRAY, Some("0".into()), None).unwrap();
        assert!(!ShellPrefs::load(&dir).close_to_tray, "записанное значение");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn kill_switch_proxy_defaults_off_and_reads_the_mirror() {
        assert!(
            !ShellPrefs::default().kill_switch_proxy,
            "по умолчанию прокси снимается"
        );
        let on = ShellPrefs::from_entries(&entries(&[(KILL_SWITCH_PROXY, "1")]));
        assert!(on.kill_switch_proxy);
        let junk = ShellPrefs::from_entries(&entries(&[(KILL_SWITCH_PROXY, "maybe")]));
        assert!(!junk.kill_switch_proxy, "мусор — умолчание");
    }

    #[test]
    fn blank_hotkey_is_off() {
        let p = ShellPrefs::from_entries(&entries(&[(HOTKEY_CONNECT, "   ")]));
        assert_eq!(p.hotkey_connect, None);
    }
}
