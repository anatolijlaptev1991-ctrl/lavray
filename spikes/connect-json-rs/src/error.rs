// SPDX-License-Identifier: GPL-3.0-only

//! Коды и тело ошибки Connect: `{"code":"...","message":"..."}`.

use serde_json::json;

/// Подмножество кодов Connect, нужное спайку.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Code {
    InvalidArgument,
    DeadlineExceeded,
    NotFound,
    ResourceExhausted,
    Unimplemented,
    Internal,
}

impl Code {
    /// Имя кода в JSON.
    pub fn name(self) -> &'static str {
        match self {
            Code::InvalidArgument => "invalid_argument",
            Code::DeadlineExceeded => "deadline_exceeded",
            Code::NotFound => "not_found",
            Code::ResourceExhausted => "resource_exhausted",
            Code::Unimplemented => "unimplemented",
            Code::Internal => "internal",
        }
    }

    /// HTTP-статус для unary (спецификация Connect, таблица кодов).
    pub fn http_status(self) -> u16 {
        match self {
            Code::InvalidArgument => 400,
            Code::DeadlineExceeded => 504,
            Code::NotFound => 404,
            Code::ResourceExhausted => 429,
            Code::Unimplemented => 501,
            Code::Internal => 500,
        }
    }
}

/// Ошибка вызова: код + сообщение.
#[derive(Clone, Debug)]
pub struct ConnectError {
    pub code: Code,
    pub message: String,
}

impl ConnectError {
    pub fn new(code: Code, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// Объект ошибки `{"code","message"}`.
    pub fn to_value(&self) -> serde_json::Value {
        json!({"code": self.code.name(), "message": self.message})
    }

    /// Тело unary-ответа с ошибкой.
    pub fn to_json(&self) -> Vec<u8> {
        self.to_value().to_string().into_bytes()
    }
}
