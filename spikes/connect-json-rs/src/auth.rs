// SPDX-License-Identifier: GPL-3.0-only

//! Bearer-авторизация как в Go-ядре (`core/cmd/lavray-core/auth.go`, T-53).

/// Токен из «Authorization: Bearer <токен>»: схема без учёта регистра, после неё
/// любое число пробелов; голый токен без схемы не принимается.
pub fn bearer_token(header: &str) -> Option<&str> {
    let (scheme, rest) = header.split_once(' ')?;
    scheme
        .eq_ignore_ascii_case("bearer")
        .then(|| rest.trim_start_matches(' '))
}

/// Сравнение за постоянное время (длина не скрывается, как `subtle.ConstantTimeCompare`).
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Запрос авторизован: токен задан (fail-closed) и совпал.
pub fn is_authorized(header: Option<&str>, token: &str) -> bool {
    match header.and_then(bearer_token) {
        Some(got) if !got.is_empty() && !token.is_empty() => {
            ct_eq(got.as_bytes(), token.as_bytes())
        }
        _ => false,
    }
}

/// Тело 401 побайтно как у Go: `http.Error(w, {"code":"unauthenticated"}, 401)`.
pub const UNAUTHENTICATED_BODY: &str = "{\"code\":\"unauthenticated\"}\n";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_parsing() {
        assert_eq!(bearer_token("Bearer abc"), Some("abc"));
        assert_eq!(bearer_token("bearer   abc"), Some("abc"));
        assert_eq!(bearer_token("abc"), None);
        assert_eq!(bearer_token("Basic abc"), None);
        assert!(!is_authorized(Some("Bearer "), "x"));
        assert!(!is_authorized(Some("Bearer x"), ""));
        assert!(is_authorized(Some("Bearer x"), "x"));
        assert!(!is_authorized(None, "x"));
    }
}
