// SPDX-License-Identifier: GPL-3.0-only

//! Проверка запроса «Сохранить как» (T-82): предложенное имя файла,
//! расширение и размер. Путь страница не задаёт вовсе — его выбирает
//! пользователь в системном диалоге; страница предлагает только имя.

/// Наибольший размер сохраняемого файла, байт (резервная копия — до 64 `МиБ`).
pub const MAX_SAVE_BYTES: usize = 64 * 1024 * 1024;
/// Наибольшая длина предложенного имени, символов.
pub const MAX_NAME_CHARS: usize = 128;
/// Расширения, которые страница может предложить.
pub const ALLOWED_EXTENSIONS: [&str; 4] = ["txt", "log", "json", "lavbk"];

/// Проверенный запрос.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaveRequest {
    /// Имя без каталога, с расширением.
    pub file_name: String,
    pub extension: &'static str,
}

/// Почему запрос отклонён; строка — код ошибки для UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveError {
    BadName,
    BadExtension,
    TooLarge,
}

impl SaveError {
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Self::BadName => "bad_name",
            Self::BadExtension => "bad_extension",
            Self::TooLarge => "too_large",
        }
    }
}

/// Проверить запрос: имя без пути и запрещённых символов, расширение из
/// списка, размер в пределе. Имя без нужного расширения его получает.
pub fn validate(name: &str, extension: &str, size: usize) -> Result<SaveRequest, SaveError> {
    if size > MAX_SAVE_BYTES {
        return Err(SaveError::TooLarge);
    }
    let extension = ALLOWED_EXTENSIONS
        .iter()
        .find(|e| e.eq_ignore_ascii_case(extension))
        .copied()
        .ok_or(SaveError::BadExtension)?;
    let stem = name.trim().trim_end_matches('.');
    let bad = |c: char| {
        c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
    };
    if stem.is_empty() || stem.chars().count() > MAX_NAME_CHARS || stem.chars().any(bad) {
        return Err(SaveError::BadName);
    }
    if is_reserved_device(stem) || stem.chars().all(|c| c == '.') {
        return Err(SaveError::BadName);
    }
    let suffix = format!(".{extension}");
    let file_name = if stem.to_ascii_lowercase().ends_with(&suffix) {
        stem.to_string()
    } else {
        format!("{stem}{suffix}")
    };
    Ok(SaveRequest {
        file_name,
        extension,
    })
}

/// Имена устройств Windows (`CON`, `NUL`, `COM1`…) — с любым расширением.
fn is_reserved_device(stem: &str) -> bool {
    let base = stem
        .split('.')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_uppercase();
    matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && base[3..].chars().all(|c| c.is_ascii_digit() && c != '0'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_extension_once() {
        let r = validate("lavray-log-1", "txt", 10).unwrap();
        assert_eq!(r.file_name, "lavray-log-1.txt");
        assert_eq!(
            validate("журнал.TXT", "txt", 1).unwrap().file_name,
            "журнал.TXT"
        );
        assert_eq!(validate("копия", "LAVBK", 1).unwrap().extension, "lavbk");
    }

    #[test]
    fn path_parts_rejected() {
        for name in [
            "..\\evil",
            "../evil",
            "C:\\x",
            "a/b",
            "x:y",
            "a|b",
            "a?b",
            "a*b",
            "\"q\"",
            "a\u{0}b",
            "tab\tname",
        ] {
            assert_eq!(
                validate(name, "txt", 1),
                Err(SaveError::BadName),
                "{name:?}"
            );
        }
    }

    #[test]
    fn empty_and_dots_rejected() {
        for name in ["", "   ", ".", "..", "...", " . "] {
            assert_eq!(
                validate(name, "txt", 1),
                Err(SaveError::BadName),
                "{name:?}"
            );
        }
    }

    #[test]
    fn windows_device_names_rejected() {
        for name in ["CON", "nul", "Aux.backup", "COM1", "lpt9", "PRN"] {
            assert_eq!(validate(name, "txt", 1), Err(SaveError::BadName), "{name}");
        }
        assert!(validate("COM0", "txt", 1).is_ok());
        assert!(validate("console", "txt", 1).is_ok());
        assert!(validate("COM10", "txt", 1).is_ok());
    }

    #[test]
    fn name_length_boundary() {
        assert!(validate(&"я".repeat(MAX_NAME_CHARS), "txt", 1).is_ok());
        assert_eq!(
            validate(&"я".repeat(MAX_NAME_CHARS + 1), "txt", 1),
            Err(SaveError::BadName)
        );
    }

    #[test]
    fn extension_allowlist() {
        for ext in ["exe", "bat", "lnk", "", "txt.exe"] {
            assert_eq!(validate("a", ext, 1), Err(SaveError::BadExtension), "{ext}");
        }
    }

    #[test]
    fn size_boundary() {
        assert!(validate("a", "txt", MAX_SAVE_BYTES).is_ok());
        assert_eq!(
            validate("a", "txt", MAX_SAVE_BYTES + 1),
            Err(SaveError::TooLarge)
        );
        assert!(
            validate("a", "txt", 0).is_ok(),
            "пустой файл можно сохранить"
        );
    }

    #[test]
    fn codes() {
        assert_eq!(SaveError::BadName.code(), "bad_name");
        assert_eq!(SaveError::BadExtension.code(), "bad_extension");
        assert_eq!(SaveError::TooLarge.code(), "too_large");
    }
}
