// SPDX-License-Identifier: GPL-3.0-only

//! Ограниченное чтение маленьких служебных файлов (JSON в несколько КиБ).
//!
//! Файл открывается один раз, читается не больше `max + 1` байт через
//! [`Read::take`]: лишний байт значит «файл больше предела» и считается
//! порчей. Отдельного `metadata` нет — между проверкой размера и чтением файл
//! мог бы вырасти (TOCTOU), а здесь предел держит сам дескриптор.

use std::io::{self, Read};
use std::path::Path;

/// Прочитать файл целиком, но не больше `max` байт; больше — `InvalidData`.
pub fn read_bounded(path: &Path, max: u64) -> io::Result<Vec<u8>> {
    let mut raw = Vec::new();
    std::fs::File::open(path)?
        .take(max.saturating_add(1))
        .read_to_end(&mut raw)?;
    if raw.len() as u64 > max {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("файл больше {max} байт"),
        ));
    }
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(tag: &str, len: usize) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("lavray-bounded-{}-{tag}", std::process::id()));
        std::fs::write(&p, vec![b'x'; len]).unwrap();
        p
    }

    #[test]
    fn exactly_max_is_read() {
        let p = file("max", 16);
        assert_eq!(read_bounded(&p, 16).unwrap().len(), 16);
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn one_over_max_is_invalid_data() {
        let p = file("over", 17);
        let e = read_bounded(&p, 16).unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::InvalidData);
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn empty_and_missing() {
        let p = file("empty", 0);
        assert!(read_bounded(&p, 16).unwrap().is_empty());
        let _ = std::fs::remove_file(&p);
        assert_eq!(
            read_bounded(&p, 16).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
    }
}
