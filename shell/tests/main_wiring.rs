// SPDX-License-Identifier: GPL-3.0-only

//! Охрана проводки `src/main.rs`: GUI Tauri в тесте не поднять, а бинарник
//! библиотечными тестами не виден (A2-23), поэтому проверяется текст — то, что
//! уже ломалось. Логика меню трея — в `lavray_shell::tray`.

/// Исходник из `shell/src` (читается во время теста).
fn source(name: &str) -> String {
    let path = format!("{}/src/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("не прочитать {path}: {e}"))
        // git на Windows может выкачать файлы с CRLF; проверки ищут LF
        .replace("\r\n", "\n")
}

/// Команда есть в списке `generate_handler!` (`src/commands.rs`, T-82).
/// Принимает имя с отступом и запятой — как раньше искали в `main.rs`.
fn registered(entry: &str) -> bool {
    let name = entry.trim().trim_end_matches(',');
    source("commands.rs")
        .lines()
        .any(|line| line.trim().trim_end_matches(',').rsplit("::").next() == Some(name))
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
    assert!(registered("is_elevated"), "нет в generate_handler!");
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
        assert!(registered(needed), "нет в generate_handler!: {needed}");
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

/// T-82: `reg.exe`, WinINET и RAS не работают в потоке команд: команда
/// асинхронная и отдаёт тело `sysproxy::set_blocking`, а то идёт в пул
/// блокирующих потоков.
#[test]
fn system_proxy_command_runs_in_the_blocking_pool() {
    let main_rs = source("main.rs");
    let command = main_rs
        .split("async fn set_system_proxy")
        .nth(1)
        .and_then(|rest| rest.split("fn request_quit").next())
        .expect("асинхронная команда set_system_proxy");
    assert!(command.contains("set_blocking(data, enabled, port).await"));
    assert!(
        !command.contains("SysProxy::new"),
        "тело вернулось в обработчик команды"
    );
    assert!(source("sysproxy/command.rs").contains("spawn_blocking(job)"));
}

/// S-02: вывод `reg.exe` читается в OEM-кодовой странице, а не как UTF-8
/// (запуск `reg.exe` в тестах не нужен - проверяется проводка Windows-бэкенда;
/// macOS/Linux читают UTF-8 законно).
#[test]
fn reg_output_is_decoded_with_the_oem_codepage() {
    let windows_backend = source("sysproxy/registry.rs");
    assert!(windows_backend.contains("decode_console_output(&out.stdout)"));
    assert!(windows_backend.contains("decode_console_output(&out.stderr)"));
    for banned in [
        "from_utf8_lossy(&out.stdout)",
        "from_utf8_lossy(&out.stderr)",
    ] {
        assert!(
            !windows_backend.contains(banned),
            "вывод reg.exe читается как UTF-8: {banned}"
        );
    }
}

/// T-81/Э-2: «Перезапустить от администратора» зарегистрирована для UI, текущий
/// экземпляр выходит обычным путём (`begin_quit`) только после успешного
/// запуска второго, а второй ждёт старого до инициализации single-instance.
#[test]
fn relaunch_is_wired_and_waits_for_the_old_instance_before_plugins() {
    let main_rs = source("main.rs");
    assert!(registered("relaunch_elevated"), "нет в generate_handler!");
    let command = main_rs
        .split("async fn relaunch_elevated")
        .nth(1)
        .and_then(|rest| rest.split("async fn autostart_state").next())
        .expect("команда relaunch_elevated");
    assert!(command.contains("if outcome == RelaunchOutcome::Started"));
    assert!(command.contains("begin_quit(&app)"));
    assert!(
        command.contains("spawn_blocking"),
        "UAC ждёт ответа не в потоке команд"
    );

    let wait = main_rs.find("wait_for_exit(pid)").expect("ожидание pid");
    let plugin = main_rs
        .find("tauri_plugin_single_instance::init")
        .expect("плагин single-instance");
    assert!(wait < plugin, "ждать нужно до плагина single-instance");
}

/// T-82/Э-2: команды автозапуска зарегистрированы и не блокируют главный поток
/// (`reg.exe`/`schtasks.exe` — отдельные процессы).
#[test]
fn autostart_commands_are_registered_and_run_off_the_main_thread() {
    let main_rs = source("main.rs");
    for needed in ["            autostart_state,", "            set_autostart"] {
        assert!(registered(needed), "нет в generate_handler!: {needed}");
    }
    for name in ["async fn autostart_state", "async fn set_autostart"] {
        let body = main_rs
            .split(name)
            .nth(1)
            .and_then(|rest| rest.split("\n}\n").next())
            .unwrap_or_else(|| panic!("нет {name}"));
        assert!(body.contains("spawn_blocking"), "{name}: {body}");
    }
}

/// T-81 (ревью): мьютекс single-instance проверяется ДО плагина (повышенный
/// экземпляр прячет свой мьютекс от обычного, и плагин принял бы себя за
/// первый); не вышедший за срок прежний экземпляр — сообщение и выход, а не
/// передача аргументов старому окну.
#[test]
fn single_instance_is_checked_before_the_plugin_and_a_stuck_parent_stops_the_start() {
    let main_rs = source("main.rs");
    let check = main_rs
        .find("single_instance::check(")
        .expect("проверка мьютекса");
    let plugin = main_rs
        .find("tauri_plugin_single_instance::init")
        .expect("плагин single-instance");
    assert!(check < plugin, "проверка мьютекса должна идти до плагина");
    assert!(main_rs.contains("Verdict::ElevatedInstanceRunning"));
    assert!(main_rs.contains("msgbox::ALREADY_RUNNING_ELEVATED"));

    let wait = main_rs
        .find("if !wait_for_exit(pid)")
        .expect("ожидание pid");
    let tail = &main_rs[wait..check];
    assert!(tail.contains("msgbox::previous_instance_alive("));
    assert!(tail.contains("std::process::exit(1)"));
}

/// T-81 (ревью): сбой создания окна — сообщение с причиной, не паника; общие
/// настройки UI читаются и пишутся командами оболочки (файл `ui-state.json`),
/// а признак перезапуска — из флага `--elevated-relaunch`.
#[test]
fn window_failure_is_reported_and_the_ui_state_commands_are_registered() {
    let main_rs = source("main.rs");
    assert!(main_rs.contains("msgbox::window_failed(&reason)"));
    assert!(
        !main_rs.contains(".expect(\"LAVRay shell: failed to build tauri application\")"),
        "сбой сборки приложения не должен быть тихой паникой"
    );
    for needed in [
        "            launch_info,",
        "            ui_state_load,",
        "            ui_state_set,",
        "            window_show,",
    ] {
        assert!(registered(needed), "нет в generate_handler!: {needed}");
    }
    // обычному пользователю UAC потребовал бы пароль чужой учётной записи
    assert!(main_rs.contains("can_elevate: token::can_self_elevate("));
}

/// T-81 (ревью): повышенный процесс создаёт общий файл настроек с явным доступом
/// для текущего пользователя (SID из токена), а признак перезапуска не читается
/// из файлов.
#[test]
fn ui_state_file_is_opened_to_the_user_when_an_elevated_process_writes_it() {
    let main_rs = source("main.rs");
    let command = main_rs
        .split("async fn ui_state_set")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
}
",
            )
            .next()
        })
        .expect("команда ui_state_set");
    assert!(command.contains("process_is_elevated()"));
    assert!(command.contains("token::user_sid()"));
    assert!(command.contains("ui_state::set(&data_dir(), &key, value, owner.as_deref())"));
    assert!(
        command.contains("spawn_blocking"),
        "запись с fsync — не в потоке команд"
    );

    let launch = main_rs
        .split("fn launch_info")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
}
",
            )
            .next()
        })
        .expect("команда launch_info");
    assert!(
        !launch.contains("data_dir"),
        "признак берётся из флага, не из файла"
    );
}

/// MCP: команды доступа агентов зарегистрированы; каждый запуск ядра получает
/// свой агентский токен; устаревший файл убирается до запуска ядра, а при выходе
/// (меню, завершение сеанса Windows) файл удаляется.
#[test]
fn agent_access_is_wired_to_the_core_lifecycle() {
    let main_rs = source("main.rs");
    for needed in [
        "            agent_access_set,",
        "            agent_core_path",
    ] {
        assert!(registered(needed), "нет в generate_handler!: {needed}");
    }
    let config = main_rs
        .split("fn core_spawn_config")
        .nth(1)
        .and_then(|rest| rest.split("\n}\n").next())
        .expect("core_spawn_config");
    assert!(
        config.contains("agent_token: Some(generate_auth_token()"),
        "каждый запуск ядра получает новый агентский токен"
    );

    let stale = main_rs.find("remove_stale()").expect("очистка файла");
    let supervisor = main_rs
        .find("spawn_supervisor(core_spawn_config")
        .expect("надзор");
    assert!(
        stale < supervisor,
        "файл прошлого запуска убирается до ядра"
    );

    let quit = main_rs
        .split("fn begin_quit")
        .nth(1)
        .and_then(|rest| rest.split("\n}\n").next())
        .expect("begin_quit");
    assert!(quit.contains("agent.shutdown()"), "выход убирает файл");
    let exit = main_rs
        .split("on_run_event(&event, ||")
        .nth(1)
        .expect("Exit");
    assert!(exit.contains("agent.shutdown()"), "Exit убирает файл");

    for line in main_rs.lines().filter(|l| l.contains("println!")) {
        assert!(
            !line.contains("agent_token") && !line.contains("token}"),
            "токен в журнале: {line}"
        );
    }
}

/// Все `.rs` из `shell/src` (рекурсивно), кроме тестов.
fn all_sources(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            all_sources(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// Имя функции из строки объявления: `pub async fn name(` → `name`.
fn fn_name(line: &str) -> Option<String> {
    let rest = line.split("fn ").nth(1)?;
    let name: String = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    (!name.is_empty()).then_some(name)
}

/// T-82: команда, объявленная `#[tauri::command]` в любом файле `src/`, но не
/// попавшая в `commands.rs`, в окне отвечает «command not found». Список — одно
/// место регистрации, и `main.rs` ничего мимо него не регистрирует.
#[test]
fn every_declared_command_is_registered_once() {
    let mut files = Vec::new();
    all_sources(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    let mut declared = Vec::new();
    for file in files {
        let code = std::fs::read_to_string(&file).unwrap();
        let mut lines = code.lines();
        while let Some(line) = lines.next() {
            if line.trim_start().starts_with("#[tauri::command") {
                let decl = lines
                    .find(|l| l.contains("fn "))
                    .expect("fn после атрибута");
                declared.push(fn_name(decl).expect("имя команды"));
            }
        }
    }
    assert!(declared.len() >= 25, "{declared:?}");
    for name in &declared {
        assert!(
            registered(name),
            "команда {name} не зарегистрирована в commands.rs"
        );
    }
    let list = source("commands.rs");
    let entries = list
        .lines()
        .map(str::trim)
        .filter(|l| l.starts_with("super::") || l.starts_with("lavray_shell::"))
        .count();
    assert_eq!(
        entries,
        declared.len(),
        "в commands.rs лишняя или повторная запись"
    );
    let main_rs = source("main.rs");
    assert!(main_rs.contains(".invoke_handler(commands::handler())"));
    assert!(
        !main_rs.contains("generate_handler!"),
        "второй список команд в main.rs"
    );
}

/// T-82: крестик окна (системный и в шапке) решает настройка «Закрывать в трей»;
/// выход — тем же `begin_quit`, что «Выход» в трее (ядро, прокси, файл агентов).
#[test]
fn close_button_follows_the_close_to_tray_setting() {
    let main_rs = source("main.rs");
    let close = main_rs
        .split("fn close_window")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
}
",
            )
            .next()
        })
        .expect("close_window");
    assert!(close.contains("window_policy::on_close(&ShellPrefs::load(&data_dir()))"));
    assert!(close.contains(
        "CloseAction::Quit => {
            begin_quit("
    ));
    let event = main_rs
        .split("WindowEvent::CloseRequested")
        .nth(1)
        .and_then(|rest| rest.split("WindowEvent::ThemeChanged").next())
        .expect("CloseRequested");
    assert!(event.contains("api.prevent_close();"));
    assert!(event.contains("close_window(&main)"));
    let hide = main_rs
        .split("fn window_hide")
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
}
",
            )
            .next()
        })
        .expect("window_hide");
    assert!(hide.contains("close_window(&window)"));
}

/// T-75: команды обновления зарегистрированы для UI, замок «установка идёт»
/// лежит в общем состоянии, а режим `--update-watchdog` разбирается первой
/// строкой `main()` — до single-instance, плагинов, окна и ядра.
#[test]
fn update_commands_are_registered_and_the_watchdog_mode_runs_first() {
    for name in [
        "update_apply",
        "update_rollback",
        "update_health_ok",
        "update_previous_info",
        "update_pick_installer",
    ] {
        assert!(registered(name), "нет в generate_handler!: {name}");
    }
    // HIGH-1: копировать в staging произвольный путь от страницы нельзя — только
    // `update_pick_installer` (нативный диалог выбирает пользователь, не страница)
    assert!(
        !registered("update_stage_local"),
        "update_stage_local не должен быть зарегистрирован"
    );
    for file in ["update/wiring.rs", "update/pick.rs", "update/stage.rs"] {
        assert!(
            !source(file).contains("fn update_stage_local"),
            "команда update_stage_local объявлена в {file}"
        );
    }
    assert!(
        source("os_integration.rs").contains("update::wiring::new_gate()"),
        "замок установки не в общем состоянии"
    );

    let main_rs = source("main.rs");
    let body = main_rs.split("fn main() {").nth(1).expect("main()");
    let first_statement = body.lines().find(|l| !l.trim().is_empty()).unwrap();
    assert!(
        first_statement.contains("update::watchdog_entry::run_if_requested()"),
        "watchdog должен идти первым: {first_statement}"
    );
    for later in ["LaunchArgs::from_env()", "tauri::generate_context!()"] {
        assert!(body.find(later).unwrap() > body.find("run_if_requested").unwrap());
    }
}

/// T-75: страница не получает JS-прав на обновление — команды вызываются как
/// обычные команды оболочки, а установку запускает только `update_apply`.
#[test]
fn update_commands_need_no_extra_capability() {
    let caps = std::fs::read_to_string(format!(
        "{}/capabilities/default.json",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    assert!(!caps.contains("update"), "лишнее право на обновление");
}

/// `LaunchArgs` копируется побитово: `from_env()` передаётся дальше по значению.
#[test]
fn launch_args_is_copy() {
    fn assert_copy<T: Copy>() {}
    assert_copy::<lavray_shell::launch::LaunchArgs>();
}
