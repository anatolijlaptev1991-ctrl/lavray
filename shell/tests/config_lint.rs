// SPDX-License-Identifier: GPL-3.0-only

//! Охрана конфигурации оболочки (T-58): Tauri читает `tauri.conf.json` и
//! `capabilities/*.json` при сборке, а неверное значение компилятором Rust не
//! ловится и проявляется только в окне.

use serde_json::Value;

fn read(rel: &str) -> String {
    let path = format!("{}/{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("не прочитать {path}: {e}"))
}

fn read_json(rel: &str) -> Value {
    serde_json::from_str(&read(rel)).unwrap_or_else(|e| panic!("{rel} — не JSON: {e}"))
}

/// F-089 (B1-23): по умолчанию Tauri сам перехватывает перетаскивание файлов, и
/// HTML5-события `dragover`/`drop` до страницы не доходят: зона «Перетащите
/// файл сюда» в окне импорта мертва.
#[test]
fn main_window_lets_the_page_handle_file_drops() {
    let window = &read_json("tauri.conf.json")["app"]["windows"][0];
    assert_eq!(window["label"], "main");
    assert_eq!(window["dragDropEnabled"], Value::Bool(false));
}

/// F-088 (A2-19, B1-22): `window.open` и `target="_blank"` в WebView2 молча
/// гасятся; ссылки открывает плагин opener, и только по `https`/`http`.
#[test]
fn opener_plugin_is_registered_and_limited_to_http_and_https() {
    assert!(read("Cargo.toml").contains("tauri-plugin-opener"));
    assert!(read("src/main.rs").contains("tauri_plugin_opener::init()"));

    let capability = read_json("capabilities/default.json");
    let opener: Vec<&Value> = capability["permissions"]
        .as_array()
        .expect("permissions")
        .iter()
        .filter(|p| {
            p.as_str()
                .or_else(|| p["identifier"].as_str())
                .is_some_and(|id| id.starts_with("opener:"))
        })
        .collect();
    assert_eq!(
        opener.len(),
        1,
        "одно разрешение opener (не opener:default: он открывает и mailto:, tel:)"
    );
    assert_eq!(opener[0]["identifier"], "opener:allow-open-url");
    let urls: Vec<&str> = opener[0]["allow"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["url"].as_str())
        .collect();
    assert_eq!(urls, ["https://*", "http://*"]);
}
