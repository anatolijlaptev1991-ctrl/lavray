// SPDX-License-Identifier: GPL-3.0-only

//! Тесты XDG-автозапуска на реальных файлах: включение, выключение, атомарная
//! перезапись (симлинк не переходит на цель), валидация пути, состояние при
//! чужом или запрещённом файле, каталог автозапуска по переменным.
//! Переменные окружения не трогаются — функции принимают значения явно.

use super::desktop::{disable, enable, entry_exec, entry_state, Entry};
use super::linux::{autostart_dir_in, set_enabled, state};
use super::*;
use std::ffi::OsStr;
use std::path::Path;

/// Временный каталог со случайным именем (как `TaskFile`): удаляется на выходе.
pub(super) struct TempDir(pub(super) std::path::PathBuf);

impl TempDir {
    pub(super) fn new() -> Self {
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
fn autostart_dir_in_follows_base_directory_spec() {
    use std::ffi::OsStr;
    let home = OsStr::new("/home/u");
    // Абсолютный XDG_CONFIG_HOME используется.
    assert_eq!(
        autostart_dir_in(Some(OsStr::new("/cfg")), Some(home)).unwrap(),
        Path::new("/cfg/autostart")
    );
    // Пустое и относительное значение игнорируется по спецификации.
    assert_eq!(
        autostart_dir_in(Some(OsStr::new("")), Some(home)).unwrap(),
        Path::new("/home/u/.config/autostart")
    );
    assert_eq!(
        autostart_dir_in(Some(OsStr::new("rel/cfg")), Some(home)).unwrap(),
        Path::new("/home/u/.config/autostart")
    );
    // Без XDG — ~/.config/autostart.
    assert_eq!(
        autostart_dir_in(None, Some(home)).unwrap(),
        Path::new("/home/u/.config/autostart")
    );
    // HOME отсутствует или относительный — понятная ошибка.
    let err = autostart_dir_in(None, None).unwrap_err();
    assert!(err.contains("HOME"), "{err}");
    assert!(autostart_dir_in(None, Some(OsStr::new("rel"))).is_err());
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
