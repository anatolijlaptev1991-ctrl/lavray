// SPDX-License-Identifier: GPL-3.0-only

//! T-44 (A2-18): права окна не шире необходимого, а откат прокси не доступен
//! странице. Тест читает исходники как текст — ни окно, ни реестр не нужны.

use std::fs;

/// Права, которыми UI действительно пользуется: события оболочки
/// (`core-endpoint`, resize) и перетаскивание безрамочного окна за заголовок
/// (`data-tauri-drag-region`). Остальное — команды оболочки без ACL. T-58:
/// `opener:allow-open-url` — единственное право плагина opener, с областью
/// только `https://*` и `http://*` (её проверяет `config_lint`).
const ALLOWED: [&str; 5] = [
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:window:allow-start-dragging",
    "core:window:allow-internal-toggle-maximize",
    "opener:allow-open-url",
];

fn read(rel: &str) -> String {
    fs::read_to_string(format!("{}/{rel}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

#[test]
fn capabilities_contain_only_the_permissions_the_ui_uses() {
    let caps: serde_json::Value = serde_json::from_str(&read("capabilities/default.json")).unwrap();
    let granted: Vec<&str> = caps["permissions"]
        .as_array()
        .unwrap()
        .iter()
        // право — строка или объект с областью: {"identifier": …, "allow": […]}
        .map(|p| p.as_str().or_else(|| p["identifier"].as_str()).unwrap())
        .collect();
    for permission in &granted {
        assert!(
            ALLOWED.contains(permission),
            "лишнее право {permission}: core:default и tray/menu/webview странице не нужны"
        );
    }
    assert_eq!(
        granted.len(),
        ALLOWED.len(),
        "право убрали, но UI им пользуется: {granted:?}"
    );
}

#[test]
fn the_page_cannot_roll_the_system_proxy_back() {
    assert!(
        !read("src/main.rs").contains("recover_system_proxy"),
        "откат незакрытого снимка делает setup() при старте; странице команда не нужна"
    );
}
