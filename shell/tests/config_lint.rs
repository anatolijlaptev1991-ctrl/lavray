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

/// T-82/Э-2: окно создаётся скрытым, а показывает его `setup()` (кроме запуска
/// с `--tray` и «Запускать свёрнутым»): иначе автозапуск мигал бы окном перед
/// тем, как его спрятать.
/// T-81 (ревью): само окно создаёт код (`create: false` в конфигурации), чтобы
/// у повышенного экземпляра был свой каталог данных WebView.
#[test]
fn main_window_is_created_by_code_hidden_and_shown_unless_tray() {
    let window = &read_json("tauri.conf.json")["app"]["windows"][0];
    assert_eq!(window["label"], "main");
    assert_eq!(window["visible"], Value::Bool(false));
    assert_eq!(window["create"], Value::Bool(false));

    let main_rs = read("src/main.rs");
    assert!(main_rs.contains("window_policy::start_hidden(launch.tray, launch.elevated_relaunch"));
    assert!(main_rs.contains("fn create_main_window"));
    assert!(main_rs.contains("WebviewWindowBuilder::from_config"));
    assert!(main_rs.contains("profile::webview_data_dir("));
    assert!(main_rs.contains(".data_directory(dir)"));
    let setup = main_rs
        .split("tray_ui::install(app)?;")
        .nth(1)
        .and_then(|rest| rest.split("Ok(())").next())
        .expect("хвост setup()");
    assert!(setup.contains("if !start_hidden"), "{setup}");
    assert!(setup.contains("tray_ui::show_main_window(app.handle())"));
}

/// T-81/Э-3, T-82: при удалении приложения установщик убирает автозапуск
/// (значение `Run` и задачи планировщика `LAVRay*` всех пользователей), но не
/// при обновлении. Хук стоит в POSTUNINSTALL: к тому моменту деинсталлятор уже
/// проверил, что приложение не запущено. Службы и отдельного `wintun.dll` нет:
/// wintun встроен в sing-tun. Выпускается только NSIS (у MSI хука нет).
#[test]
fn nsis_uninstall_hook_removes_autostart_but_not_on_update() {
    let conf = read_json("tauri.conf.json");
    let nsis = &conf["bundle"]["windows"]["nsis"];
    let hooks = nsis["installerHooks"].as_str().expect("installerHooks");
    let text = read(hooks);
    assert!(text.contains("!macro NSIS_HOOK_POSTUNINSTALL"));
    assert!(
        !text.contains("!macro NSIS_HOOK_PREUNINSTALL"),
        "до проверки запущенного приложения автозапуск не трогаем"
    );
    assert!(text.contains(
        r#"DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LAVRay""#
    ));
    // задачи по схеме имён `LAVRay-<SID>` (и прежнее простое имя), PowerShell по полному пути
    assert!(text.contains("Get-ScheduledTask -TaskName 'LAVRay','LAVRay-*'"));
    assert!(text.contains("Unregister-ScheduledTask -Confirm:$$false"));
    assert!(text.contains(r#"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"#));
    assert!(
        text.contains("${DisableX64FSRedirection}") && text.contains("${EnableX64FSRedirection}")
    );
    assert!(
        text.contains("${If} $UpdateMode <> 1"),
        "обновление не должно сбрасывать автозапуск"
    );
    // имена совпадают с теми, что пишет оболочка
    assert_eq!(lavray_shell::autostart::TASK_PREFIX, "LAVRay");
    assert_eq!(lavray_shell::autostart::RUN_VALUE, "LAVRay");
    assert!(text.is_ascii(), "NSIS читает .nsh без BOM в ANSI-кодировке");
    let resources = conf["bundle"]["resources"].to_string();
    assert!(
        !resources.contains("wintun"),
        "wintun встроен в sing-tun, отдельная DLL не нужна"
    );
    let targets: Vec<&str> = conf["bundle"]["targets"]
        .as_array()
        .expect("bundle.targets")
        .iter()
        .filter_map(Value::as_str)
        .collect();
    assert_eq!(targets, ["nsis"], "у MSI нет хука удаления автозапуска");
}
