// SPDX-License-Identifier: GPL-3.0-only

//! Тесты автозапуска на подставной ОС: точные аргументы `reg`/`schtasks`,
//! содержимое XML и выбор способа по правам. Реестр и планировщик не трогаются.

use super::*;
use std::cell::{Cell, RefCell};

const EXE: &str = r"C:\Program Files\LAVRay\LAVRay.exe";
const USER: &str = r"ANATOLY\anato";
const RUN_DATA: &str = r#""C:\Program Files\LAVRay\LAVRay.exe" --tray"#;

/// Подставная ОС: помнит задачу и значение `Run`, записывает вызовы и XML,
/// который получил `schtasks /Create`.
#[derive(Default)]
struct FakeSystem {
    task: Cell<bool>,
    run: RefCell<Option<String>>,
    calls: RefCell<Vec<(Tool, Vec<String>)>>,
    created_xml: RefCell<Option<String>>,
    created_file: RefCell<Option<PathBuf>>,
    /// `schtasks /Delete` отвечает «отказано в доступе» (нет прав).
    deny_task_delete: bool,
    /// `schtasks /Create` не удаётся.
    fail_create: bool,
}

impl FakeSystem {
    fn with_task() -> Self {
        let fake = Self::default();
        fake.task.set(true);
        fake
    }

    fn with_run_value() -> Self {
        let fake = Self::default();
        *fake.run.borrow_mut() = Some(RUN_DATA.to_string());
        fake
    }

    fn mutating_calls(&self) -> Vec<(Tool, Vec<String>)> {
        self.calls
            .borrow()
            .iter()
            .filter(|(_, args)| !matches!(args[0].as_str(), "/Query" | "query"))
            .cloned()
            .collect()
    }
}

fn ok() -> Result<Output, String> {
    Ok(Output {
        success: true,
        stdout: String::new(),
        stderr: String::new(),
    })
}

fn failed(text: &str) -> Result<Output, String> {
    Ok(Output {
        success: false,
        stdout: String::new(),
        stderr: text.to_string(),
    })
}

impl Exec for FakeSystem {
    fn run(&self, tool: Tool, args: &[String]) -> Result<Output, String> {
        self.calls.borrow_mut().push((tool, args.to_vec()));
        match (tool, args[0].as_str()) {
            (Tool::Schtasks, "/Query") => {
                if self.task.get() {
                    ok()
                } else {
                    failed("ERROR: The system cannot find the file specified.")
                }
            }
            (Tool::Schtasks, "/Create") => {
                let path = PathBuf::from(&args[4]);
                let bytes = std::fs::read(&path).expect("XML прочитан, пока файл жив");
                *self.created_file.borrow_mut() = Some(path);
                let units: Vec<u16> = bytes[2..]
                    .chunks(2)
                    .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                    .collect();
                *self.created_xml.borrow_mut() = Some(String::from_utf16(&units).unwrap());
                assert_eq!(bytes[..2], [0xFF, 0xFE], "BOM UTF-16 LE");
                if self.fail_create {
                    return failed("ERROR: Access is denied.");
                }
                self.task.set(true);
                ok()
            }
            (Tool::Schtasks, "/Delete") => {
                if self.deny_task_delete {
                    return failed("ERROR: Access is denied.");
                }
                if !self.task.replace(false) {
                    return failed("ERROR: The system cannot find the file specified.");
                }
                ok()
            }
            (Tool::Reg, "query") => {
                if self.run.borrow().is_some() {
                    ok()
                } else {
                    failed(
                        "ERROR: The system was unable to find the specified registry key or value.",
                    )
                }
            }
            (Tool::Reg, "add") => {
                *self.run.borrow_mut() = Some(args[7].clone());
                ok()
            }
            (Tool::Reg, "delete") => {
                if self.run.borrow_mut().take().is_none() {
                    return failed(
                        "ERROR: The system was unable to find the specified registry key or value.",
                    );
                }
                ok()
            }
            other => panic!("неожиданная команда: {other:?}"),
        }
    }
}

fn env(elevated: bool) -> Env {
    Env {
        exe: PathBuf::from(EXE),
        user: Some(USER.to_string()),
        elevated,
    }
}

fn call(tool: Tool, args: &[&str]) -> (Tool, Vec<String>) {
    (tool, args.iter().map(|a| (*a).to_string()).collect())
}

#[test]
fn state_is_read_from_the_os_every_time() {
    let os = FakeSystem::default();
    let off = read_state(&os, false).unwrap();
    assert!(off.supported && !off.enabled && off.method.is_none());
    assert_eq!(
        *os.calls.borrow(),
        [
            call(Tool::Schtasks, &["/Query", "/TN", "LAVRay"]),
            call(
                Tool::Reg,
                &[
                    "query",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "LAVRay"
                ]
            ),
        ]
    );

    // внешний мир изменился — следующее чтение это видит
    *os.run.borrow_mut() = Some(RUN_DATA.to_string());
    let run = read_state(&os, false).unwrap();
    assert_eq!((run.enabled, run.method), (true, Some(Method::Registry)));
    os.task.set(true);
    let both = read_state(&os, true).unwrap();
    assert_eq!((both.enabled, both.method), (true, Some(Method::Task)));
    assert!(both.elevated);
}

#[test]
fn elevated_enable_creates_the_scheduler_task() {
    let os = FakeSystem::default();
    let state = set_enabled(&os, &env(true), true).unwrap();
    assert_eq!((state.enabled, state.method), (true, Some(Method::Task)));
    assert_eq!(state.notice, None);

    let calls = os.mutating_calls();
    assert_eq!(calls.len(), 1, "только создание задачи: {calls:?}");
    let (tool, args) = &calls[0];
    assert_eq!(*tool, Tool::Schtasks);
    assert_eq!(args[..4], ["/Create", "/TN", "LAVRay", "/XML"]);
    assert_eq!(args[5], "/F");
    assert_eq!(args.len(), 6);
    let file = os.created_file.borrow().clone().unwrap();
    assert!(
        file.file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("lavray-task-"),
        "{file:?}"
    );
    assert!(!file.exists(), "временный XML удалён после создания задачи");
    assert!(os.run.borrow().is_none(), "значения Run нет");
}

#[test]
fn elevated_enable_removes_the_old_run_value() {
    let os = FakeSystem::with_run_value();
    let state = set_enabled(&os, &env(true), true).unwrap();
    assert_eq!(state.method, Some(Method::Task));
    assert!(os.run.borrow().is_none(), "двойного запуска нет");
    let calls = os.mutating_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].1[0], "/Create");
    assert_eq!(
        calls[1],
        call(
            Tool::Reg,
            &[
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "LAVRay",
                "/f"
            ]
        )
    );
}

#[test]
fn plain_enable_writes_the_run_value_with_tray_flag() {
    let os = FakeSystem::default();
    let state = set_enabled(&os, &env(false), true).unwrap();
    assert_eq!(
        (state.enabled, state.method),
        (true, Some(Method::Registry))
    );
    assert_eq!(
        os.mutating_calls(),
        [call(
            Tool::Reg,
            &[
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "LAVRay",
                "/t",
                "REG_SZ",
                "/d",
                RUN_DATA,
                "/f"
            ]
        )]
    );
    assert!(!os.task.get(), "задача планировщика не создавалась");
}

#[test]
fn plain_enable_deletes_an_old_task_when_it_can() {
    let os = FakeSystem::with_task();
    let state = set_enabled(&os, &env(false), true).unwrap();
    assert!(!os.task.get());
    assert_eq!(state.method, Some(Method::Registry));
    assert_eq!(state.notice, None);
    assert_eq!(
        os.mutating_calls()[1],
        call(Tool::Schtasks, &["/Delete", "/TN", "LAVRay", "/F"])
    );
}

#[test]
fn plain_enable_reports_an_undeletable_task_and_leaves_it() {
    let mut os = FakeSystem::with_task();
    os.deny_task_delete = true;
    let state = set_enabled(&os, &env(false), true).unwrap();
    assert!(os.task.get(), "задача осталась");
    assert!(os.run.borrow().is_some(), "значение Run записано");
    assert_eq!(state.notice, Some(Notice::TaskNeedsAdmin));
    assert_eq!(state.method, Some(Method::Task));
}

#[test]
fn disable_removes_both_ways() {
    let os = FakeSystem::with_task();
    *os.run.borrow_mut() = Some(RUN_DATA.to_string());
    let state = set_enabled(&os, &env(true), false).unwrap();
    assert!(!state.enabled && state.method.is_none() && state.notice.is_none());
    assert_eq!(
        os.mutating_calls(),
        [
            call(
                Tool::Reg,
                &[
                    "delete",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "LAVRay",
                    "/f"
                ]
            ),
            call(Tool::Schtasks, &["/Delete", "/TN", "LAVRay", "/F"]),
        ]
    );
}

#[test]
fn disable_touches_only_what_exists() {
    let os = FakeSystem::with_run_value();
    set_enabled(&os, &env(false), false).unwrap();
    let tools: Vec<Tool> = os.mutating_calls().iter().map(|(t, _)| *t).collect();
    assert_eq!(tools, [Tool::Reg], "задачи нет — schtasks /Delete не зовём");
}

#[test]
fn disable_without_rights_says_the_task_needs_administrator() {
    let mut os = FakeSystem::with_task();
    os.deny_task_delete = true;
    *os.run.borrow_mut() = Some(RUN_DATA.to_string());
    let state = set_enabled(&os, &env(false), false).unwrap();
    assert!(os.run.borrow().is_none(), "Run убран, он доступен без прав");
    assert!(os.task.get());
    assert!(state.enabled, "задача всё ещё включает автозапуск");
    assert_eq!(state.method, Some(Method::Task));
    assert_eq!(state.notice, Some(Notice::TaskNeedsAdmin));
}

#[test]
fn disable_with_rights_fails_loudly_when_the_task_stays() {
    let mut os = FakeSystem::with_task();
    os.deny_task_delete = true;
    let err = set_enabled(&os, &env(true), false).unwrap_err();
    assert!(err.contains("schtasks /Delete"), "{err}");
}

#[test]
fn a_failed_create_is_an_error_and_cleans_the_temp_file() {
    let os = FakeSystem {
        fail_create: true,
        ..FakeSystem::default()
    };
    let err = set_enabled(&os, &env(true), true).unwrap_err();
    assert!(err.starts_with("schtasks /Create:"), "{err}");
    let file = os.created_file.borrow().clone().unwrap();
    assert!(!file.exists());
}

#[test]
fn task_xml_has_the_logon_trigger_and_battery_flags() {
    let xml = task_xml(Path::new(EXE), USER);
    for needed in [
        "<LogonTrigger>",
        r"<UserId>ANATOLY\anato</UserId>",
        "<RunLevel>HighestAvailable</RunLevel>",
        "<LogonType>InteractiveToken</LogonType>",
        "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
        "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
        "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
        "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
        r#"<Command>"C:\Program Files\LAVRay\LAVRay.exe"</Command>"#,
        "<Arguments>--tray</Arguments>",
        r"<WorkingDirectory>C:\Program Files\LAVRay</WorkingDirectory>",
    ] {
        assert!(xml.contains(needed), "нет {needed} в XML:\n{xml}");
    }
    assert!(xml.starts_with(r#"<?xml version="1.0" encoding="UTF-16"?>"#));
    assert_eq!(xml.matches("<LogonTrigger>").count(), 1);
}

#[test]
fn task_xml_reaches_schtasks_as_utf16_with_the_real_path() {
    let os = FakeSystem::default();
    set_enabled(&os, &env(true), true).unwrap();
    let xml = os.created_xml.borrow().clone().unwrap();
    assert_eq!(xml, task_xml(Path::new(EXE), USER));
}

#[test]
fn task_xml_escapes_markup_characters_and_keeps_cyrillic() {
    let xml = task_xml(
        Path::new(r"C:\Users\Анатолий\A&B <x>\LAVRay.exe"),
        r"ПК\Ан&то",
    );
    assert!(xml.contains(r"A&amp;B &lt;x&gt;"), "{xml}");
    assert!(xml.contains(r"<UserId>ПК\Ан&amp;то</UserId>"), "{xml}");
    let bytes = encode_task_file(&xml);
    assert_eq!(bytes[..2], [0xFF, 0xFE]);
    assert_eq!(
        bytes.len(),
        2 + xml.encode_utf16().count() * 2,
        "BOM и 2 байта на единицу"
    );
}

#[test]
fn enabling_needs_a_user_for_the_logon_trigger_and_a_sane_path() {
    let os = FakeSystem::default();
    let mut no_user = env(true);
    no_user.user = None;
    assert!(set_enabled(&os, &no_user, true).is_err());
    assert!(os.mutating_calls().is_empty());

    let mut quoted = env(false);
    quoted.exe = PathBuf::from("C:\\bad\"name\\LAVRay.exe");
    assert!(set_enabled(&os, &quoted, true).is_err());
    assert!(os.mutating_calls().is_empty());
}

#[test]
fn run_command_quotes_the_path() {
    assert_eq!(run_command(Path::new(EXE)), RUN_DATA);
}

#[test]
fn unsupported_state_hides_the_row() {
    let state = AutostartState::unsupported();
    assert!(!state.supported && !state.enabled);
    let json = serde_json::to_value(&state).unwrap();
    assert_eq!(json["supported"], false);
    assert_eq!(json["method"], serde_json::Value::Null);
}

#[test]
fn state_serializes_with_snake_case_words() {
    let os = FakeSystem::with_task();
    let state = read_state(&os, true).unwrap();
    let json = serde_json::to_value(&state).unwrap();
    assert_eq!(json["method"], "task");
    assert_eq!(json["enabled"], true);
    assert_eq!(json["elevated"], true);
    let mut denied = FakeSystem::with_task();
    denied.deny_task_delete = true;
    let blocked = set_enabled(&denied, &env(false), false).unwrap();
    assert_eq!(
        serde_json::to_value(&blocked).unwrap()["notice"],
        "task_needs_admin"
    );
}

#[cfg(not(windows))]
#[test]
fn other_systems_answer_unsupported() {
    assert!(!supported());
    assert!(!current_state().unwrap().supported);
    assert_eq!(change(true).unwrap_err(), ERR_UNSUPPORTED);
}
