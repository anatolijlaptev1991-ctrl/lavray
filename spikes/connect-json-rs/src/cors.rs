// SPDX-License-Identifier: GPL-3.0-only

//! CORS как в `core/internal/api/cors.go`: только локальные origin оболочки и панели.

use hyper::header::{HeaderMap, HeaderValue, VARY};

const ALLOWED: [&str; 5] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:1420",
    "http://127.0.0.1:1420",
];

const ALLOW_HEADERS: &str =
    "Content-Type, Authorization, Connect-Protocol-Version, Connect-Timeout-Ms, X-LAVRay-CSRF";

/// Origin разрешён (список оболочки либо loopback-адрес с любым портом).
pub fn is_allowed(origin: &str) -> bool {
    ALLOWED.contains(&origin)
        || origin.starts_with("http://127.0.0.1:")
        || origin.starts_with("http://localhost:")
}

/// Проставляет CORS-заголовки для разрешённого origin.
pub fn apply(origin: Option<&str>, h: &mut HeaderMap) {
    let Some(o) = origin.filter(|o| is_allowed(o)) else {
        return;
    };
    let Ok(v) = HeaderValue::from_str(o) else {
        return;
    };
    h.insert("access-control-allow-origin", v);
    h.insert(VARY, HeaderValue::from_static("Origin"));
    h.insert(
        "access-control-allow-credentials",
        HeaderValue::from_static("true"),
    );
    h.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("POST, GET, OPTIONS"),
    );
    h.insert(
        "access-control-allow-headers",
        HeaderValue::from_static(ALLOW_HEADERS),
    );
    h.insert(
        "access-control-expose-headers",
        HeaderValue::from_static("Connect-Content-Encoding"),
    );
    h.insert("access-control-max-age", HeaderValue::from_static("600"));
}
