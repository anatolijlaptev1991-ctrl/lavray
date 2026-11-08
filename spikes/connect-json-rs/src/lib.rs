// SPDX-License-Identifier: GPL-3.0-only

//! Спайк R0-C: Connect-протокол (JSON-кодек, unary + server-streaming) поверх hyper.
//! Контракт — `lavray.v1.CoreService/GetStatus` и `SubscribeEvents`, форма ответа
//! повторяет Go-ядро (protojson: нулевые значения опущены, int64 строкой).

pub mod auth;
pub mod cors;
pub mod envelope;
pub mod error;
pub mod handler;
pub mod request;
pub mod server;
pub mod status;
pub mod stream;

/// Предел размера одного сообщения запроса (как `api.MaxRequestBytes` в Go).
pub const MAX_REQUEST_BYTES: usize = 16 << 20;
