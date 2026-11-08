// SPDX-License-Identifier: GPL-3.0-only

//! Разбор запроса: тело с лимитом, `Connect-Timeout-Ms`, тип содержимого, JSON-сообщение.

use crate::error::{Code, ConnectError};
use crate::MAX_REQUEST_BYTES;
use bytes::Bytes;
use http_body_util::{BodyExt, Limited};
use hyper::body::Incoming;
use hyper::header::{CONTENT_LENGTH, CONTENT_TYPE};
use hyper::Request;
use std::time::Duration;

/// Тело запроса с лимитом `MAX_REQUEST_BYTES`.
pub async fn read_body(req: Request<Incoming>) -> Result<Bytes, ConnectError> {
    let too_big = || ConnectError::new(Code::ResourceExhausted, "размер сообщения превышает лимит");
    let declared = req
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok());
    if declared.is_some_and(|n| n > MAX_REQUEST_BYTES) {
        return Err(too_big());
    }
    match Limited::new(req.into_body(), MAX_REQUEST_BYTES)
        .collect()
        .await
    {
        Ok(c) => Ok(c.to_bytes()),
        Err(e)
            if e.downcast_ref::<http_body_util::LengthLimitError>()
                .is_some() =>
        {
            Err(too_big())
        }
        Err(e) => Err(ConnectError::new(
            Code::InvalidArgument,
            format!("чтение тела: {e}"),
        )),
    }
}

/// `Connect-Timeout-Ms` (до 10 цифр, по спецификации).
pub fn timeout_of(req: &Request<Incoming>) -> Option<Duration> {
    let v = req.headers().get("connect-timeout-ms")?.to_str().ok()?;
    (v.len() <= 10)
        .then(|| v.parse::<u64>().ok())
        .flatten()
        .map(Duration::from_millis)
}

pub fn media_type(req: &Request<Incoming>) -> &str {
    let ct = req
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    ct.split(';').next().unwrap_or("").trim()
}

/// Пустое тело допустимо (как `{}`); иначе нужен JSON-объект.
pub fn parse_request(body: &[u8]) -> Result<serde_json::Value, ConnectError> {
    if body.is_empty() {
        return Ok(serde_json::json!({}));
    }
    match serde_json::from_slice::<serde_json::Value>(body) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) => Err(ConnectError::new(
            Code::InvalidArgument,
            "ожидается JSON-объект",
        )),
        Err(e) => Err(ConnectError::new(
            Code::InvalidArgument,
            format!("разбор JSON: {e}"),
        )),
    }
}
