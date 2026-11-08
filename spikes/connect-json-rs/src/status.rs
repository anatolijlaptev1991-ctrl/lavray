// SPDX-License-Identifier: GPL-3.0-only

//! JSON-формы `CoreStatus` и `CoreEvent` (protojson Go: нули опущены, int64 строкой).

use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

/// Снимок состояния ядра в «простое» (CORE_STATE_IDLE=0 в JSON опущен).
pub fn core_status(core_version: &str) -> Value {
    json!({
        "mode": "CONNECT_MODE_SYSTEM_PROXY",
        "coreVersion": core_version,
        "inbound": {"listen": "127.0.0.1", "port": 2080},
        "routingPresetId": "global",
        "tun": {"interfaceName": "lavray-tun"},
    })
}

/// Текущее время, мс с эпохи Unix.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// `CoreEvent{ts_ms, state_changed}`; int64 `tsMs` строкой.
pub fn state_changed_event(status: Value) -> Value {
    json!({"tsMs": now_ms().to_string(), "stateChanged": status})
}
