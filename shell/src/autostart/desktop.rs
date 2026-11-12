// SPDX-License-Identifier: GPL-3.0-only

//! Linux: XDG-автозапуск — запись Desktop Entry в каталоге автозапуска сеанса
//! (`$XDG_CONFIG_HOME/autostart`, по умолчанию `~/.config/autostart`).
//! Спецификации: freedesktop «Desktop Entry» 1.5 и «Autostart» 0.6.
//!
//! Файл [`ENTRY_FILE`] полностью принадлежит приложению: при включении
//! перезаписывается целиком (и обновляет путь к программе, если тот переехал),
//! при выключении удаляется. Признак «включено» всегда читается из файла
//! (FR-UI-013), в настройках не хранится. Запись делается атомарно
//! (temp + rename): rename заменяет и симлинк на месте файла, не переходя на
//! цель, и не оставляет полузаписанного файла. Запуск — с флагом `--tray`
//! (окно скрыто), как и в задаче планировщика на Windows.

use std::path::Path;

/// Имя файла записи автозапуска приложения.
pub const ENTRY_FILE: &str = "lavray.desktop";

/// Проверка пути к программе: значение `Exec=` — строка без управляющих
/// символов (спека), и она должна быть честным UTF-8, иначе лаунчер прочитает
/// иное, чем записали.
fn validate_exe(exe: &Path) -> Result<(), String> {
    let text = exe.to_str().ok_or_else(|| {
        format!(
            "недопустимый путь к программе (не UTF-8): {}",
            exe.display()
        )
    })?;
    if text.chars().any(char::is_control) {
        return Err(format!(
            "недопустимый путь к программе (управляющие символы): {text}"
        ));
    }
    Ok(())
}

/// Строка `Exec=` по спецификации Desktop Entry. Три слоя экранирования — в
/// порядке, обратном разбору лаунчера:
/// 1. field codes: `%` → `%%` (иначе `%f`/`%u`/неизвестный код искажают путь);
/// 2. аргумент в двойных кавычках: `"` `\` `` ` `` `$` → `\X`;
/// 3. значение строки: `\` → `\\` (разбор строки идёт раньше кавычек, поэтому
///    литеральный `\` в кавычках даёт четыре подряд).
pub fn entry_exec(exe: &Path) -> String {
    // Single-pass: три слоя экранирования применяются inline, без
    // промежуточных аллокаций (раньше — 2 String на каждый символ пути).
    // Порядок слоёв обратен разбору лаунчера: field codes → кавычки → строка.
    let mut out = String::with_capacity(exe.as_os_str().len() * 2 + 16);
    out.push('"');
    for c in exe.to_string_lossy().chars() {
        match c {
            // Слой 1: % → %% (field code). Слои 2/3 не затрагивают %.
            '%' => out.push_str("%%"),
            // Слои 2+3: спецсимвол кавычек → \X → \\X (строка удваивает \).
            '"' | '`' | '$' => {
                out.push_str("\\\\");
                out.push(c);
            }
            // Слои 2+3: \ → \\ (кавычки добавляют escape) → \\\\ (строка
            // удваивает КАЖДЫЙ из двух backslash — итого четыре).
            '\\' => out.push_str("\\\\\\\\"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out.push_str(" --tray");
    out
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
    /// `X-GNOME-Autostart-enabled=false`) — так по Autostart-спеке отключают
    /// чужие записи; `Exec` для этого не требуется.
    Disabled,
    /// Файл есть, но записи приложения это не похоже.
    Unknown,
}

/// Состояние по содержимому записи (без чтения файлов). Разбор строгий:
/// регистр значим везде (спека), `Type` обязателен, строка `Exec=` хранится
/// «как есть» — единственный писатель приложения, чужая запись не
/// эквивалентна нашей (см. `linux::state`).
pub fn entry_state(text: &str) -> Entry {
    // BOM слева лаунчеры (GKeyFile) пропускают — не считаем файл чужим.
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let mut in_section = false;
    let mut section_seen = false;
    let mut exec: Option<String> = None;
    let mut type_ok = false;
    let mut disabled = false;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            in_section = name == "Desktop Entry";
            section_seen |= in_section;
            continue;
        }
        if !in_section {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            return Entry::Unknown;
        };
        let value = value.trim();
        match key.trim() {
            "Exec" => exec = Some(value.to_string()),
            "Type" => type_ok = value == "Application",
            "Hidden" if value == "true" => disabled = true,
            "X-GNOME-Autostart-enabled" if value == "false" => disabled = true,
            _ => {}
        }
    }
    if disabled {
        return Entry::Disabled;
    }
    if !section_seen {
        return Entry::Unknown;
    }
    match exec {
        Some(exec) if type_ok => Entry::Enabled { exec },
        _ => Entry::Unknown,
    }
}

/// Включить: каталог создать, запись записать атомарно (temp + rename) —
/// перезапись целиком, включая чужой или повреждённый файл.
pub fn enable(dir: &Path, exe: &Path) -> Result<(), String> {
    validate_exe(exe)?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut random = [0u8; 8];
    getrandom::fill(&mut random).map_err(|e| format!("случайное имя файла: {e}"))?;
    let name = random
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let tmp = dir.join(format!(".lavray-{name}.tmp"));
    let path = dir.join(ENTRY_FILE);
    let result = (|| -> Result<(), String> {
        std::fs::write(&tmp, entry_contents(exe)).map_err(|e| format!("{}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, &path).map_err(|e| format!("{}: {e}", path.display()))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
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
