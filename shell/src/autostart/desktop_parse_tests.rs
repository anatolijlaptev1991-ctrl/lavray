// SPDX-License-Identifier: GPL-3.0-only

//! Тесты разбора записи автозапуска без файловой системы: трёхслойное
//! экранирование `Exec=` по спецификации, сборка содержимого, строгий разбор
//! состояний (включена, запрещена флагом, чужой файл, сломанные строки, BOM).

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
fn exec_line_escapes_quote_and_backslash_per_spec() {
    // Литеральный `\` в кавычках — четыре подряд (строковый разбор у
    // лаунчера идёт раньше кавычек).
    let quoted = entry_exec(Path::new("/opt/my \"tools\"\\lavray-shell"));
    assert_eq!(quoted, r#""/opt/my \\"tools\\"\\\\lavray-shell" --tray"#);
}

#[test]
fn exec_line_doubles_percent_field_codes() {
    let quoted = entry_exec(Path::new("/opt/50%off/lavray-shell"));
    assert_eq!(quoted, r#""/opt/50%%off/lavray-shell" --tray"#);
}

#[test]
fn exec_line_escapes_dollar_and_backtick() {
    let quoted = entry_exec(Path::new("/tmp/$x`y/lavray-shell"));
    assert_eq!(quoted, r#""/tmp/\\$x\\`y/lavray-shell" --tray"#);
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
fn state_disabled_flag_does_not_require_exec() {
    // По Autostart-спеке отключение — одноимённый файл с Hidden=true:
    // `Exec` и `Type` для него не требуются.
    assert_eq!(
        entry_state("[Desktop Entry]\nHidden=true\n"),
        Entry::Disabled
    );
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
fn state_requires_type_application() {
    // Type по спеке обязателен: запись без него — чужая (Unknown), не наша.
    let without = entry_contents(Path::new(EXE)).replace("Type=Application\n", "");
    assert_eq!(entry_state(&without), Entry::Unknown);
    let other = entry_contents(Path::new(EXE)).replace("Type=Application", "Type=Link");
    assert_eq!(entry_state(&other), Entry::Unknown);
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
fn state_case_is_significant_everywhere() {
    // Спека: регистр значим везде — в имени секции и в boolean-значениях.
    assert_eq!(
        entry_state("[desktop entry]\nType=Application\nExec=x\n"),
        Entry::Unknown
    );
    let text = entry_contents(Path::new(EXE)).replace("Hidden=false", "Hidden=TRUE");
    assert_eq!(
        entry_state(&text),
        Entry::Enabled {
            exec: entry_exec(Path::new(EXE))
        },
        "TRUE — не boolean спеки, запрещающим не считается"
    );
}

#[test]
fn state_bom_is_stripped() {
    // GKeyFile пропускает BOM: файл, который реально исполнится, не «чужой».
    let text = format!(
        "\u{FEFF}[Desktop Entry]\nType=Application\nExec={}\n",
        entry_exec(Path::new(EXE))
    );
    assert_eq!(
        entry_state(&text),
        Entry::Enabled {
            exec: entry_exec(Path::new(EXE))
        }
    );
}

#[test]
fn state_localized_keys_and_exec_in_value_are_ignored() {
    let text = format!(
        "[Desktop Entry]\nType=Application\nName[ru]=ЛавРэй\nExec={}\nComment=Exec=в значении\n",
        entry_exec(Path::new(EXE))
    );
    assert_eq!(
        entry_state(&text),
        Entry::Enabled {
            exec: entry_exec(Path::new(EXE))
        }
    );
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
