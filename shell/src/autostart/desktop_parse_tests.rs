// SPDX-License-Identifier: GPL-3.0-only

//! Тесты разбора записи автозапуска без файловой системы: экранирование пути
//! в `Exec=`, сборка содержимого, распознавание состояний (включена,
//! запрещена флагом, чужой файл, сломанные строки).

use super::desktop::{entry_contents, entry_exec, entry_state, Entry};
use std::path::Path;

const EXE: &str = "/usr/bin/lavray-shell";

#[test]
fn exec_line_quotes_path_and_adds_tray_flag() {
    assert_eq!(
        entry_exec(Path::new(EXE)),
        "\"/usr/bin/lavray-shell\" --tray"
    );
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
        Entry::Enabled {
            exec: entry_exec(Path::new(EXE))
        },
        "не-«false» значение запрещающим не считается"
    );
}

#[test]
fn state_other_entry_section_is_unknown() {
    assert_eq!(
        entry_state("[Desktop Action open]\nName=Открыть\nExec=xdg-open\n"),
        Entry::Unknown
    );
    assert_eq!(
        entry_state("Name=LAVRay\nExec=x\n"),
        Entry::Unknown,
        "нет секции"
    );
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
        Entry::Enabled {
            exec: entry_exec(Path::new(EXE))
        },
        "сломанные строки чужих секций не портят нашу запись"
    );
}

#[test]
fn state_comments_and_blank_lines_are_skipped() {
    let text = format!(
        "# комментарий\n\n[Desktop Entry]\n# ещё\nType=Application\nName=LAVRay\nExec={}\n",
        entry_exec(Path::new(EXE))
    );
    assert_eq!(
        entry_state(&text),
        Entry::Enabled {
            exec: entry_exec(Path::new(EXE))
        }
    );
}
