// SPDX-License-Identifier: GPL-3.0-only

//! Конверты Connect-стриминга: `[флаги:1][длина:4 big-endian][данные]`.

use crate::error::{Code, ConnectError};
use bytes::{BufMut, Bytes, BytesMut};
use serde_json::json;

/// Флаг: данные сжаты (не поддерживается спайком).
pub const FLAG_COMPRESSED: u8 = 0b01;
/// Флаг: завершающий кадр (end-stream).
pub const FLAG_END_STREAM: u8 = 0b10;

/// Кадр с заданными флагами.
pub fn encode(flags: u8, payload: &[u8]) -> Bytes {
    let mut b = BytesMut::with_capacity(5 + payload.len());
    b.put_u8(flags);
    b.put_u32(payload.len() as u32);
    b.put_slice(payload);
    b.freeze()
}

/// Финальный кадр: `{}` при успехе или `{"error":{...}}`.
pub fn end_stream(err: Option<&ConnectError>) -> Bytes {
    let v = match err {
        Some(e) => json!({"error": e.to_value()}),
        None => json!({}),
    };
    encode(FLAG_END_STREAM, v.to_string().as_bytes())
}

/// Разбор тела server-streaming запроса: ровно один несжатый кадр данных.
pub fn decode_single(body: &[u8]) -> Result<&[u8], ConnectError> {
    let bad = |m: &str| ConnectError::new(Code::InvalidArgument, m);
    if body.len() < 5 {
        return Err(bad("неполный заголовок конверта"));
    }
    let flags = body[0];
    let len = u32::from_be_bytes([body[1], body[2], body[3], body[4]]) as usize;
    if flags & FLAG_COMPRESSED != 0 {
        return Err(ConnectError::new(
            Code::Unimplemented,
            "сжатие конвертов не поддерживается",
        ));
    }
    if flags & FLAG_END_STREAM != 0 {
        return Err(bad("запрос не может содержать end-stream кадр"));
    }
    match body.len() - 5 {
        n if n < len => Err(bad("конверт короче заявленной длины")),
        n if n > len => Err(bad("после единственного сообщения есть лишние данные")),
        _ => Ok(&body[5..]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_errors() {
        let f = encode(0, b"{}");
        assert_eq!(&f[..], b"\x00\x00\x00\x00\x02{}");
        assert_eq!(decode_single(&f).unwrap(), b"{}");
        assert!(decode_single(&f[..4]).is_err());
        assert!(decode_single(&encode(FLAG_END_STREAM, b"{}")).is_err());
        assert_eq!(
            decode_single(&encode(FLAG_COMPRESSED, b"{}"))
                .unwrap_err()
                .code,
            Code::Unimplemented
        );
        assert_eq!(&end_stream(None)[..], b"\x02\x00\x00\x00\x02{}");
    }
}
