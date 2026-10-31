// SPDX-License-Identifier: GPL-3.0-only

//! SHA-256 для установщиков: потоковое чтение, hex и сравнение за постоянное
//! время. Крейт `sha2` уже в зависимостях (проверка ядра, T-44).

use sha2::{Digest, Sha256};
use std::io::{self, Read};

/// Размер блока чтения: 64 КиБ — компромисс между вызовами и памятью.
const CHUNK: usize = 64 * 1024;

/// SHA-256 потока до конца; читается тот же дескриптор, второго открытия нет.
pub fn sha256_reader(reader: &mut impl Read) -> io::Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let read = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        hasher.update(&buf[..read]);
    }
    Ok(hasher.finalize().into())
}

/// Строчный hex.
pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 64 hex-символа (любой регистр) → 32 байта; иначе `None`.
pub fn parse_sha256_hex(text: &str) -> Option<[u8; 32]> {
    let raw = text.as_bytes();
    if raw.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (byte, pair) in out.iter_mut().zip(raw.as_chunks::<2>().0) {
        let high = char::from(pair[0]).to_digit(16)?;
        let low = char::from(pair[1]).to_digit(16)?;
        *byte = u8::try_from(high * 16 + low).ok()?;
    }
    Some(out)
}

/// Равенство двух сумм без раннего выхода: время не зависит от места расхождения.
pub fn ct_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    const EMPTY: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const MILLION_A: &str = "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0";

    fn digest(data: &[u8]) -> String {
        to_hex(&sha256_reader(&mut &data[..]).unwrap())
    }

    #[test]
    fn matches_the_nist_vectors() {
        assert_eq!(digest(b"abc"), ABC);
        assert_eq!(digest(b""), EMPTY);
        assert_eq!(digest(&vec![b'a'; 1_000_000]), MILLION_A);
    }

    #[test]
    fn hex_round_trips_in_both_cases() {
        let bytes = parse_sha256_hex(ABC).unwrap();
        assert_eq!(to_hex(&bytes), ABC);
        assert_eq!(parse_sha256_hex(&ABC.to_uppercase()), Some(bytes));
    }

    #[test]
    fn invalid_hex_is_refused() {
        assert_eq!(parse_sha256_hex(""), None);
        assert_eq!(parse_sha256_hex(&ABC[1..]), None);
        assert_eq!(parse_sha256_hex(&format!("{ABC}0")), None);
        assert_eq!(parse_sha256_hex(&ABC.replace('b', "g")), None);
        // многобайтовый символ не должен сдвигать разбор пар
        assert_eq!(parse_sha256_hex(&format!("{}я", &ABC[..62])), None);
    }

    #[test]
    fn constant_time_compare_sees_a_difference_in_any_byte() {
        let a = parse_sha256_hex(ABC).unwrap();
        assert!(ct_eq(&a, &a));
        for index in [0, 15, 31] {
            let mut b = a;
            b[index] ^= 1;
            assert!(!ct_eq(&a, &b), "байт {index}");
        }
    }
}
