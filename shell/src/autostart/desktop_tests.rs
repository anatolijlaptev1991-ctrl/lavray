// SPDX-License-Identifier: GPL-3.0-only

//! Тесты XDG-автозапуска: содержимое записи, экранирование пути в `Exec=`,
//! разбор состояний (включена, запрещена флагом, чужой файл), включение и
//! выключение на реальных файлах во временном каталоге. Переменные окружения
//! не трогаются — функции принимают каталог явно.

use super::desktop::{autostart_dir, disable, enable, entry_contents, entry_exec, entry_state, Entry};
use super::*;
use std::path::Path;

/// Временный каталог со случайным именем (как `TaskFile`): удаляется на выходе.
struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new() -> Self {
        let mut random = [0u8; 8];
        getrandom::fill(&mut random).expect("случайные байты");
        let name = random.iter().map(|b| format!("{b:02x}")).collect::<String>();
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

#[test]
fn exec_line_quotes_path_and_adds_tray_flag() {
    assert_eq!(entry_exec(Path::new(EXE)), "\"/usr/bin/lavray-shell\" --tray");
}

#[test]
fn exec_line_escapes_quote_and_backslash() {
    let quoted = entry_exec(Path::new("/opt/my \"tools\"\\lavray-shell"));
    assert_eq!(quoted, "\"/opt/my \\\"tools\\\"\\\\lavray-shell\" --tray");
}

#[test]
fn contents_are_valid_entry() {
    let text = entry_contents(Path::new(EXE));
    assert_eq!(
        entry_state(&text),
        Entry::Enabled {
            exec: entry_exec(Path::new(EXE))
        }
    );
    assert!(text.contains("Name=LAVRay"));
    assert!(text.contains("Type=Application"));
}

#[test]
fn state_without_file_is_not_enabled() {
    let dir = TempDir::new();
    enable(&dir.0, Path::new(EXE)).expect("включить");
    disable(&dir.0).expect("выключить");
    assert!(!dir.0.join("lavray.desktop").exists(), "запись удалена");
}

#[test]
fn enable_creates_file_and_disable_removes_it() {
    let dir = TempDir::new();
    enable(&dir.0, Path::new(EXE)).expect("включить");
    let text = std::fs::read_to_string(dir.0.join("lavray.desktop")).expect("запись есть");
    assert_eq!(entry_state(&text), Entry::Enabled { exec: entry_exec(Path::new(EXE)) });
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
        Entry::Enabled { exec: entry_exec(Path::new("/usr/bin/lavray-shell")) },
        "после переезда путь обновлён"
    );
}

#[test]
fn state_reads_hidden_flag_as_disabled() {
    let text = entry_contents(Path::new(EXE)).replace("Hidden=false", "Hidden=true");
    assert_eq!(entry_state(&text), Entry::Disabled);
}

#[test]
fn state_reads_gnome_flag_as_disabled() {
    let text = entry_contents(Path::new(EXE)).replace(
        "X-GNOME-Autostart-enabled=true",
        "X-GNOME-Autostart-enabled=false",
    );
    assert_eq!(entry_state(&text), Entry::Disabled);
}

#[test]
fn state_ignores_flags_of_other_values() {
    let text = entry_contents(Path::new(EXE)).replace(
        "X-GNOME-Autostart-enabled=true",
        "X-GNOME-Autostart-enabled=TRUE-ISH",
    );
    assert_eq!(
        entry_state(&text),
        Entry::Enabled { exec: entry_exec(Path::new(EXE)) },
        "не-«false» значение запрещающим не считается"
    );
}

#[test]
fn state_other_entry_section_is_unknown() {
    assert_eq!(entry_state("[Desktop Action open]\nName=Открыть\nExec=xdg-open\n"), Entry::Unknown);
    assert_eq!(entry_state("Name=LAVRay\nExec=x\n"), Entry::Unknown, "нет секции");
}

#[test]
fn state_other_type_is_unknown() {
    let text = entry_contents(Path::new(EXE)).replace("Type=Application", "Type=Link");
    assert_eq!(entry_state(&text), Entry::Unknown);
}

#[test]
fn state_line_without_equals_is_unknown() {
    let text = "[Desktop Entry]\nType=Application\nName=LAVRay\nExec=/x --tray\nсломаная строка\n";
    assert_eq!(entry_state(text), Entry::Unknown);
}

#[test]
fn state_without_exec_is_unknown() {
    let text = "[Desktop Entry]\nType=Application\nName=LAVRay\n";
    assert_eq!(entry_state(text), Entry::Unknown);
}

#[test]
fn state_ignores_other_sections_after_ours() {
    let text = format!(
        "[Desktop Entry]\nType=Application\nName=LAVRay\nExec={}\n\n[Another]\nBroken line here\n",
        entry_exec(Path::new(EXE))
    );
    assert_eq!(
        entry_state(&text),
        Entry::Enabled { exec: entry_exec(Path::new(EXE)) },
        "сломанные строки чужих секций не портят нашу запись"
    );
}

#[test]
fn state_comments_and_blank_lines_are_skipped() {
    let text = format!(
        "# комментарий\n\n[Desktop Entry]\n# ещё\nType=Application\nName=LAVRay\nExec={}\n",
        entry_exec(Path::new(EXE))
    );
    assert_eq!(entry_state(&text), Entry::Enabled { exec: entry_exec(Path::new(EXE)) });
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

    let env = Env {
        exe: exe.to_path_buf(),
        sid: None,
        elevated: false,
        installed: false,
    };
    let state = linux_state(&dir.0, &env).expect("состояние");
    assert!(state.enabled);
    assert_eq!(state.method, Some(Method::DesktopEntry));
    assert!(!state.unknown);
    assert!(!state.installed, "на Linux поле установленной копии не используется");

    let healed = std::fs::read_to_string(dir.0.join("lavray.desktop")).expect("запись есть");
    assert_eq!(
        entry_state(&healed),
        Entry::Enabled { exec: entry_exec(exe) },
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

    let env = Env {
        exe: Path::new(EXE).to_path_buf(),
        sid: None,
        elevated: false,
        installed: false,
    };
    let state = linux_state(&dir.0, &env).expect("состояние");
    assert!(!state.enabled);
    assert!(!state.unknown, "запись приложения понятна");
    assert_eq!(state.method, Some(Method::DesktopEntry));
}

#[test]
fn linux_state_foreign_file_is_unknown() {
    let dir = TempDir::new();
    std::fs::write(dir.0.join("lavray.desktop"), "мусор без секций").expect("чужой файл");

    let env = Env {
        exe: Path::new(EXE).to_path_buf(),
        sid: None,
        elevated: false,
        installed: false,
    };
    let state = linux_state(&dir.0, &env).expect("состояние");
    assert!(!state.enabled);
    assert!(state.unknown, "файл не похож на запись приложения");
}

#[test]
fn linux_state_without_entry_is_off() {
    let dir = TempDir::new();
    let env = Env {
        exe: Path::new(EXE).to_path_buf(),
        sid: None,
        elevated: false,
        installed: false,
    };
    let state = linux_state(&dir.0, &env).expect("состояние");
    assert!(!state.enabled);
    assert!(!state.unknown);
}

#[test]
fn linux_set_enabled_round_trip() {
    let dir = TempDir::new();
    let env = Env {
        exe: Path::new(EXE).to_path_buf(),
        sid: None,
        elevated: false,
        installed: false,
    };
    let on = linux_set_enabled(&dir.0, &env, true).expect("включить");
    assert!(on.enabled);
    let off = linux_set_enabled(&dir.0, &env, false).expect("выключить");
    assert!(!off.enabled);
    assert!(!dir.0.join("lavray.desktop").exists(), "запись удалена");
}

#[test]
fn unsupported_without_linux_and_windows() {
    // supported() задан через cfg!: на других ОС строка настроек скрыта.
    let expected = cfg!(windows) || cfg!(target_os = "linux");
    assert_eq!(supported(), expected);
}
