//! Охрана проводки `src/main.rs`: GUI Tauri в тесте не поднять, а бинарник
//! библиотечными тестами не виден (A2-23), поэтому проверяется текст — то, что
//! уже ломалось. Логика меню трея — в `lavray_shell::tray`.

/// Исходник из `shell/src` (читается во время теста).
fn source(name: &str) -> String {
    let path = format!("{}/src/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("не прочитать {path}: {e}"))
}

/// F-041: меню трея строится по `TrayMenuSpec`, тексты приходят из UI (словари),
/// а не зашиты в оболочку по-русски.
#[test]
fn tray_is_built_from_the_spec_without_hardcoded_labels() {
    let main_rs = source("main.rs");
    assert!(main_rs.contains("tray_ui::install(app)"));
    assert!(main_rs.contains("fn tray_update"));
    for banned in ["\"Открыть LAVRay\"", "\"Выход\""] {
        assert!(!main_rs.contains(banned), "зашита подпись трея: {banned}");
    }
}

/// F-086: «Выход» не спит в потоке обработчика меню, а свёрнутое окно
/// разворачивается (`unminimize`) по «Открыть», клику и повторному запуску.
#[test]
fn quit_does_not_block_and_the_window_is_restored() {
    let main_rs = source("main.rs");
    assert!(
        !main_rs.contains("from_millis(1200)"),
        "пауза 1200 мс в обработчике"
    );
    assert!(
        main_rs.contains("fn begin_quit"),
        "выход — в фоновом потоке"
    );
    assert!(source("tray_ui.rs").contains("unminimize()"));
    assert!(main_rs.contains("tray_ui::show_main_window(app)"));
}

/// F-042: UI спрашивает оболочку о правах до подключения в режиме TUN.
#[test]
fn elevation_command_is_registered_for_the_ui() {
    let main_rs = source("main.rs");
    assert!(main_rs.contains("fn is_elevated"));
    assert!(
        main_rs.contains("            is_elevated,"),
        "нет в generate_handler!"
    );
}

/// F-082/F-083 (A2-11, A2-21): ядро ведёт цикл из библиотеки (`coreproc::runner`
/// поверх `CoreSupervisor`), а не самописный цикл без предела рестартов; кольцо
/// логов ядра и ручной перезапуск доступны UI.
#[test]
fn main_uses_the_library_supervisor_and_exposes_diagnostics() {
    let main_rs = source("main.rs");
    assert!(main_rs.contains("spawn_supervisor("));
    for banned in ["backoff * 2", "fn spawn_core("] {
        assert!(
            !main_rs.contains(banned),
            "остался самописный цикл: {banned}"
        );
    }
    for needed in ["            core_log_tail,", "            restart_core,"] {
        assert!(
            main_rs.contains(needed),
            "нет в generate_handler!: {needed}"
        );
    }
}

/// A2-18: порт `set_system_proxy` проверяет оболочка, а не только UI; тип
/// порта шире `u16`, иначе 0 проходил бы, а >65535 давал сырую ошибку serde.
#[test]
fn system_proxy_command_validates_the_port_it_is_given() {
    let main_rs = source("main.rs");
    let command = main_rs
        .split("fn set_system_proxy")
        .nth(1)
        .and_then(|rest| rest.split("fn request_quit").next())
        .expect("команда set_system_proxy");
    assert!(command.contains("port: i64"), "порт принимается шире u16");
    assert!(command.contains("validate_port(port)?"));
    assert!(!command.contains("port: u16"));
}
