// SPDX-License-Identifier: GPL-3.0-only

//! Тесты XDG-автозапуска на реальных файлах: включение, выключение,
//! перезапись при переезде программы, состояние при чужом или запрещённом
//! файле. Переменные окружения не трогаются — функции принимают каталог явно.

use super::desktop::{autostart_dir, disable, enable, entry_exec, entry_state, Entry};
use super::linux::{set_enabled, state};
use super::*;
use std::path::Path;

/// Временный каталог со случайным именем (как `TaskFile`): удаляется на выходе.
struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new() -> Self {
        let mut random = [0u8; 8];
        getrandom::fill(&mut random).expect("случайные байты");
        let name = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let dir = std::env::temp_dir().join(format!("lavray-autostart-test-{name}"));
        std::fs::create_dir_all(&dir).expect("создать временный каталог");
        Self(dir)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const EXE: &str = "/usr/bin/lavray-shell";

fn env_at(exe: &str) -> Env {
    Env {
        exe: Path::new(exe).to_path_buf(),
        sid: None,
        elevated: false,
        installed: false,
    }
}

#[test]
fn enable_creates_file_and_disable_removes_it() {
    let dir = TempDir::new();
    enable(&dir.0, Path::new(EXE)).expect("включить");
    let text = std::fs::read_to_string(dir.0.join("lavray.desktop")).expect("запись есть");
    assert_eq!(
        entry_state(&text),
        Entry::Enabled {
            exec: entry_exec(Path::new(EXE))
        }
    );
    disable(&dir.0).expect("выключить");
    assert!(!dir.0.join("lavray.desktop").exists(), "запись удалена");
}

#[test]
fn disable_without_entry_is_not_an_error() {
    let dir = TempDir::new();
    disable(&dir.0).expect("нет записи — не ошибка");
}

#[test]
fn enable_overwrites_and_updates_moved_path() {
    let dir = TempDir::new();
    enable(&dir.0, Path::new("/opt/lavray-0.9/lavray-shell")).expect("включить");
    enable(&dir.0, Path::new("/usr/bin/lavray-shell")).expect("переписать");
    let text = std::fs::read_to_string(dir.0.join("lavray.desktop")).expect("запись есть");
    assert_eq!(
        entry_state(&text),
        Entry::Enabled {
            exec: entry_exec(Path::new("/usr/bin/lavray-shell"))
        },
        "после переезда путь обновлён"
    );
}

#[test]
fn autostart_dir_uses_home_without_xdg() {
    // В CI HOME задан, XDG_CONFIG_HOME — нет; не трогая переменные, проверяем
    // лишь что каталог не пуст и завершается с понятной ошибкой без HOME.
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    match home {
        Some(home) if home.is_absolute() => {
            let dir = autostart_dir().expect("каталог определён");
            assert_eq!(dir, home.join(".config").join("autostart"));
        }
        _ => {
            let err = autostart_dir().expect_err("без HOME — ошибка");
            assert!(err.contains("HOME"), "в сообщении указание на HOME: {err}");
        }
    }
}

#[test]
fn linux_state_reports_entry_and_self_heals_moved_path() {
    let dir = TempDir::new();
    let exe = Path::new("/usr/bin/lavray-shell");
    enable(&dir.0, Path::new("/opt/old/lavray-shell")).expect("включить со старым путём");

    let state = state(&dir.0, &env_at("/usr/bin/lavray-shell")).expect("состояние");
    assert!(state.enabled);
    assert_eq!(state.method, Some(Method::DesktopEntry));
    assert!(!state.unknown);
    assert!(
        !state.installed,
        "на Linux поле установленной копии не используется"
    );

    let healed = std::fs::read_to_string(dir.0.join("lavray.desktop")).expect("запись есть");
    assert_eq!(
        entry_state(&healed),
        Entry::Enabled {
            exec: entry_exec(exe)
        },
        "путь от старого расположения обновлён на текущий"
    );
}

#[test]
fn linux_state_disabled_flag_reports_not_enabled() {
    let dir = TempDir::new();
    enable(&dir.0, Path::new(EXE)).expect("включить");
    let text = std::fs::read_to_string(dir.0.join("lavray.desktop")).expect("запись есть");
    std::fs::write(
        dir.0.join("lavray.desktop"),
        text.replace("Hidden=false", "Hidden=true"),
    )
    .expect("записать с Hidden=true");

    let state = state(&dir.0, &env_at(EXE)).expect("состояние");
    assert!(!state.enabled);
    assert!(!state.unknown, "запись приложения понятна");
    assert_eq!(state.method, Some(Method::DesktopEntry));
}

#[test]
fn linux_state_foreign_file_is_unknown() {
    let dir = TempDir::new();
    std::fs::write(dir.0.join("lavray.desktop"), "мусор без секций").expect("чужой файл");

    let state = state(&dir.0, &env_at(EXE)).expect("состояние");
    assert!(!state.enabled);
    assert!(state.unknown, "файл не похож на запись приложения");
}

#[test]
fn linux_state_without_entry_is_off() {
    let dir = TempDir::new();
    let state = state(&dir.0, &env_at(EXE)).expect("состояние");
    assert!(!state.enabled);
    assert!(!state.unknown);
}

#[test]
fn linux_set_enabled_round_trip() {
    let dir = TempDir::new();
    let on = set_enabled(&dir.0, &env_at(EXE), true).expect("включить");
    assert!(on.enabled);
    let off = set_enabled(&dir.0, &env_at(EXE), false).expect("выключить");
    assert!(!off.enabled);
    assert!(!dir.0.join("lavray.desktop").exists(), "запись удалена");
}

#[test]
fn unsupported_without_linux_and_windows() {
    // supported() задан через cfg!: на других ОС строка настроек скрыта.
    let expected = cfg!(windows) || cfg!(target_os = "linux");
    assert_eq!(supported(), expected);
}
