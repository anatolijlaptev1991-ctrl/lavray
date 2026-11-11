// SPDX-License-Identifier: GPL-3.0-only

//! Linux: XDG-автозапуск — запись Desktop Entry в каталоге автозапуска сеанса
//! (`$XDG_CONFIG_HOME/autostart`, по умолчанию `~/.config/autostart`).
//! Спецификации: freedesktop «Desktop Entry» 1.5 и «Autostart» 0.6.
//!
//! Файл [`ENTRY_FILE`] полностью принадлежит приложению: при включении
//! перезаписывается целиком (и обновляет путь к программе, если тот переехал),
//! при выключении удаляется. Признак «включено» всегда читается из файла
//! (FR-UI-013), в настройках не хранится. Файл, не похожий на запись
//! приложения, — состояние «неизвестно»: показывается как таковое, а при
//! включении затирается. Запуск — с флагом `--tray` (окно скрыто), как и
//! в задаче планировщика на Windows.

use std::path::Path;

/// Имя файла записи автозапуска приложения.
pub const ENTRY_FILE: &str = "lavray.desktop";

/// Каталог автозапуска текущего пользователя: `$XDG_CONFIG_HOME/autostart`;
/// пустое или относительное значение переменной по спецификации игнорируется,
/// тогда `~/.config/autostart`.
pub fn autostart_dir() -> Result<std::path::PathBuf, String> {
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        let dir = std::path::PathBuf::from(xdg);
        if dir.is_absolute() {
            return Ok(dir.join("autostart"));
        }
    }
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .filter(|home| home.is_absolute())
        .ok_or_else(|| "не удалось определить домашний каталог (HOME не задан)".to_string())?;
    Ok(home.join(".config").join("autostart"))
}

/// Строка `Exec=` по спецификации Desktop Entry: путь к программе в двойных
/// кавычках (внутри экранируются `\` и `"`), затем флаг `--tray`.
pub fn entry_exec(exe: &Path) -> String {
    let mut quoted = String::with_capacity(exe.as_os_str().len() + 10);
    quoted.push('"');
    for c in exe.to_string_lossy().chars() {
        if c == '"' || c == '\\' {
            quoted.push('\\');
        }
        quoted.push(c);
    }
    quoted.push('"');
    quoted.push_str(" --tray");
    quoted
}

/// Полное содержимое записи для пути к программе.
pub fn entry_contents(exe: &Path) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=LAVRay\n\
         Exec={}\n\
         X-GNOME-Autostart-enabled=true\n\
         Hidden=false\n",
        entry_exec(exe)
    )
}

/// Что сейчас в записи.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    /// Запись приложения, автозапуск разрешён; `exec` — строка `Exec=`.
    Enabled { exec: String },
    /// Запись приложения с запрещающим флагом (`Hidden=true` или
    /// `X-GNOME-Autostart-enabled=false`).
    Disabled,
    /// Файл есть, но записи приложения это не похоже (нет секции, `Type`,
    /// `Exec` или строка без `=` в секции).
    Unknown,
}

/// Состояние по содержимому записи (без чтения файлов). Строка `Exec=`
/// сравнивается «как есть»: единственный писатель — приложение, а запись
/// с чужим путём — повод обновить её на актуальный (см. `read`).
pub fn entry_state(text: &str) -> Entry {
    let mut in_section = false;
    let mut section_seen = false;
    let mut exec: Option<String> = None;
    let mut disabled = false;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            in_section = name.eq_ignore_ascii_case("Desktop Entry");
            section_seen |= in_section;
            continue;
        }
        if !in_section {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            return Entry::Unknown;
        };
        match key.trim() {
            "Exec" => exec = Some(value.trim().to_string()),
            "Type" if value.trim().ne("Application") => return Entry::Unknown,
            "Hidden" if value.trim().eq_ignore_ascii_case("true") => disabled = true,
            "X-GNOME-Autostart-enabled" if value.trim().eq_ignore_ascii_case("false") => {
                disabled = true;
            }
            _ => {}
        }
    }
    if !section_seen {
        return Entry::Unknown;
    }
    match exec {
        Some(_) if disabled => Entry::Disabled,
        Some(exec) => Entry::Enabled { exec },
        None => Entry::Unknown,
    }
}

/// Включить: каталог создать, запись записать (перезаписать) целиком.
pub fn enable(dir: &Path, exe: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join(ENTRY_FILE);
    std::fs::write(&path, entry_contents(exe)).map_err(|e| format!("{}: {e}", path.display()))
}

/// Выключить: запись удалить; нет записи — не ошибка.
pub fn disable(dir: &Path) -> Result<(), String> {
    let path = dir.join(ENTRY_FILE);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}
