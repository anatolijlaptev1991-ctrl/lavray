// SPDX-License-Identifier: GPL-3.0-only

//! Вывод консольных программ Windows в строку (S-02).
//!
//! `reg.exe` пишет в stdout/stderr в OEM-кодовой странице (на русской Windows
//! CP866), а не в UTF-8. Чтение через `String::from_utf8_lossy` портило все
//! не-ASCII символы: `*.рф` в `ProxyOverride` попадало в снимок как `*.????`,
//! и откат записывал в реестр мусор.
//!
//! Перекодировка идёт системным `MultiByteToWideChar` с явной кодовой
//! страницей: результат зависит только от входа, реестр и процессы не нужны.

use windows_sys::Win32::Globalization::{GetOEMCP, MultiByteToWideChar};

/// OEM-кодовая страница системы (`GetOEMCP`): CP866 на русской Windows,
/// 65001 при включённом «Beta: UTF-8 для всех языков».
pub(crate) fn oem_codepage() -> u32 {
    // SAFETY: вызов без параметров, только читает системную настройку.
    unsafe { GetOEMCP() }
}

/// Байты в кодовой странице `codepage` -> строка. `None` — страница системе
/// неизвестна или вход не помещается в API. Флаги 0: нечитаемый байт даёт
/// символ замены, а не отказ.
pub(crate) fn decode_codepage(bytes: &[u8], codepage: u32) -> Option<String> {
    if bytes.is_empty() {
        return Some(String::new());
    }
    let len = i32::try_from(bytes.len()).ok()?;
    // SAFETY: `bytes` живёт весь вызов, длина передана явно; при нулевом
    // размере выходного буфера функция только возвращает нужную длину.
    let needed =
        unsafe { MultiByteToWideChar(codepage, 0, bytes.as_ptr(), len, std::ptr::null_mut(), 0) };
    let mut wide = vec![0u16; usize::try_from(needed).ok().filter(|n| *n > 0)?];
    // SAFETY: буфер `wide` ровно `needed` элементов, как и заявлено в вызове.
    let written =
        unsafe { MultiByteToWideChar(codepage, 0, bytes.as_ptr(), len, wide.as_mut_ptr(), needed) };
    wide.truncate(usize::try_from(written).ok().filter(|n| *n > 0)?);
    Some(String::from_utf16_lossy(&wide))
}

/// Вывод консольной программы в кодовой странице `codepage` -> строка.
/// ASCII одинаков во всех OEM-страницах и API не требует; если страницу
/// разобрать не удалось, берётся UTF-8 с заменой нечитаемого.
pub(crate) fn decode_output(bytes: &[u8], codepage: u32) -> String {
    if bytes.is_ascii() {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    decode_codepage(bytes, codepage).unwrap_or_else(|| String::from_utf8_lossy(bytes).into_owned())
}

/// Вывод `reg.exe` в OEM-кодовой странице системы -> строка.
pub(crate) fn decode_console_output(bytes: &[u8]) -> String {
    decode_output(bytes, oem_codepage())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CP866: u32 = 866;
    const CP437: u32 = 437;
    const UTF8: u32 = 65001;

    /// `*.рф` в CP866: `*` `.` `р`=0xE0 `ф`=0xE4.
    const BYPASS_RF_CP866: [u8; 4] = [0x2A, 0x2E, 0xE0, 0xE4];

    #[test]
    fn cp866_bytes_become_cyrillic() {
        assert_eq!(decode_output(&BYPASS_RF_CP866, CP866), "*.рф");
        // Вся кириллица: А=0x80, Я=0x9F, а=0xA0, п=0xAF, р=0xE0, я=0xEF.
        let alphabet: Vec<u8> = (0x80..=0xAF).chain(0xE0..=0xEF).collect();
        let decoded = decode_output(&alphabet, CP866);
        assert!(decoded.starts_with("АБВГД"), "{decoded}");
        assert!(decoded.ends_with("рстуфхцчшщъыьэюя"), "{decoded}");
        assert_eq!(decoded.chars().count(), alphabet.len());
    }

    #[test]
    fn ascii_is_unchanged_in_any_codepage() {
        let text = "    ProxyOverride    REG_SZ    localhost;127.*;<local>\r\n";
        for codepage in [CP866, CP437, UTF8, 1252, 932] {
            assert_eq!(decode_output(text.as_bytes(), codepage), text, "{codepage}");
        }
    }

    #[test]
    fn the_same_bytes_depend_on_the_codepage() {
        // 0xE0 в CP437 - «α», в CP866 - «р»: страница обязательна.
        assert_eq!(decode_output(&[0xE0], CP437), "α");
        assert_eq!(decode_output(&[0xE0], CP866), "р");
    }

    #[test]
    fn utf8_oem_codepage_is_supported() {
        // При включённом UTF-8 для всех языков GetOEMCP() == 65001.
        assert_eq!(decode_output("*.рф".as_bytes(), UTF8), "*.рф");
    }

    #[test]
    fn empty_input_is_an_empty_string() {
        assert_eq!(decode_output(&[], CP866), "");
        assert_eq!(decode_console_output(&[]), "");
    }

    #[test]
    fn unknown_codepage_falls_back_instead_of_failing() {
        let text = decode_output(&BYPASS_RF_CP866, 0x7FFF_FFF0);
        assert!(text.starts_with("*."), "{text}");
        assert_eq!(decode_output(b"abc", 0x7FFF_FFF0), "abc");
    }

    #[test]
    fn system_oem_codepage_is_a_real_codepage() {
        let codepage = oem_codepage();
        assert_ne!(codepage, 0);
        assert_eq!(decode_output(b"abc", codepage), "abc");
    }
}
