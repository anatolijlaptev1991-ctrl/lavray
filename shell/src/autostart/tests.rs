// SPDX-License-Identifier: GPL-3.0-only

//! Тесты автозапуска на подставной ОС: точные аргументы `reg`/`schtasks`,
//! содержимое XML, имя задачи на пользователя, выбор способа по правам и по
//! месту установки, различение «не найдено» и ошибки планировщика. Реестр и
//! планировщик не трогаются.

use super::*;
use std::cell::{Cell, RefCell};

const EXE: &str = r"C:\Program Files\LAVRay\LAVRay.exe";
const SID: &str = "S-1-5-21-1111111111-2222222222-3333333333-1001";
const TASK: &str = "LAVRay-S-1-5-21-1111111111-2222222222-3333333333-1001";
const RUN_DATA: &str = r#""C:\Program Files\LAVRay\LAVRay.exe" --tray"#;
const RUN_KEY_ARG: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const NOT_FOUND: &str = "ERROR: The system cannot find the file specified.";

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
    /// Планировщик не работает: любой `schtasks` завершается ошибкой.
    scheduler_down: bool,
    /// `schtasks /Query /TN` отказывает, хотя в общем списке задача видна.
    query_by_name_denied: bool,
    /// Задача создана прежней версией: XML без дескриптора безопасности и ревизии.
    legacy_task: Cell<bool>,
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

    /// Вывод `schtasks /Query /FO CSV /NH`: чужие задачи и, если есть, наша.
    fn task_list(&self) -> String {
        let mut text = String::from(
            "\"\\Microsoft\\Windows\\Defrag\\ScheduledDefrag\",\"N/A\",\"Ready\"\r\n\
             \"\\LAVRay-Other-S-1-5-21-9\",\"N/A\",\"Ready\"\r\n",
        );
        if self.task.get() {
            text.push_str(&format!("\"\\{TASK}\",\"N/A\",\"Ready\"\r\n"));
        }
        text
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
        if self.scheduler_down && tool == Tool::Schtasks {
            return failed("ERROR: The Task Scheduler service is not available.");
        }
        match (tool, args[0].as_str()) {
            (Tool::Schtasks, "/Query") if args[1] == "/TN" && args.get(3).is_some() => {
                assert_eq!(args[2], TASK);
                assert_eq!(args[3], "/XML");
                if !self.task.get() || self.query_by_name_denied {
                    return failed(NOT_FOUND);
                }
                let xml = if self.legacy_task.get() {
                    "<Task><RegistrationInfo><Description>LAVRay: start after user logon</Description></RegistrationInfo></Task>".to_string()
                } else {
                    self.created_xml
                        .borrow()
                        .clone()
                        .unwrap_or_else(|| task_xml(Path::new(EXE), SID))
                };
                Ok(Output {
                    success: true,
                    stdout: xml,
                    stderr: String::new(),
                })
            }
            (Tool::Schtasks, "/Query") if args[1] == "/TN" => {
                assert_eq!(args[2], TASK, "задача ищется по имени пользователя");
                if self.task.get() && !self.query_by_name_denied {
                    ok()
                } else if self.query_by_name_denied {
                    failed("ERROR: Access is denied.")
                } else {
                    failed(NOT_FOUND)
                }
            }
            (Tool::Schtasks, "/Query") => {
                assert_eq!(args[1..], ["/FO", "CSV", "/NH"]);
                Ok(Output {
                    success: true,
                    stdout: self.task_list(),
                    stderr: String::new(),
                })
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
                self.legacy_task.set(false);
                ok()
            }
            (Tool::Schtasks, "/Delete") => {
                assert_eq!(args[2], TASK);
                if self.deny_task_delete {
                    return failed("ERROR: Access is denied.");
                }
                if !self.task.replace(false) {
                    return failed(NOT_FOUND);
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

/// Установленная версия (под Program Files).
fn env(elevated: bool) -> Env {
    Env {
        exe: PathBuf::from(EXE),
        sid: Some(SID.to_string()),
        elevated,
        installed: true,
    }
}

/// Копия не из Program Files (portable, Загрузки, dev-сборка).
fn portable(elevated: bool) -> Env {
    Env {
        exe: PathBuf::from(r"C:\Users\u\Downloads\LAVRay.exe"),
        installed: false,
        ..env(elevated)
    }
}

fn call(tool: Tool, args: &[&str]) -> (Tool, Vec<String>) {
    (tool, args.iter().map(|a| (*a).to_string()).collect())
}

fn run_delete() -> (Tool, Vec<String>) {
    call(Tool::Reg, &["delete", RUN_KEY_ARG, "/v", "LAVRay", "/f"])
}

fn task_delete() -> (Tool, Vec<String>) {
    call(Tool::Schtasks, &["/Delete", "/TN", TASK, "/F"])
}

#[test]
fn state_is_read_from_the_os_every_time() {
    let os = FakeSystem::default();
    let off = read_state(&os, &env(false)).unwrap();
    assert!(off.supported && !off.enabled && off.method.is_none() && !off.unknown);
    assert_eq!(
        *os.calls.borrow(),
        [
            call(Tool::Schtasks, &["/Query", "/TN", TASK]),
            call(Tool::Schtasks, &["/Query", "/FO", "CSV", "/NH"]),
            call(Tool::Reg, &["query", RUN_KEY_ARG, "/v", "LAVRay"]),
        ]
    );

    // внешний мир изменился — следующее чтение это видит
    *os.run.borrow_mut() = Some(RUN_DATA.to_string());
    let run = read_state(&os, &env(false)).unwrap();
    assert_eq!((run.enabled, run.method), (true, Some(Method::Registry)));
    os.task.set(true);
    let both = read_state(&os, &env(true)).unwrap();
    assert_eq!((both.enabled, both.method), (true, Some(Method::Task)));
    assert!(both.elevated && both.installed);
}

#[test]
fn a_found_task_needs_a_single_scheduler_query() {
    let os = FakeSystem::with_task();
    read_state(&os, &env(false)).unwrap();
    let schtasks: Vec<_> = os
        .calls
        .borrow()
        .iter()
        .filter(|(tool, _)| *tool == Tool::Schtasks)
        .cloned()
        .collect();
    assert_eq!(schtasks, [call(Tool::Schtasks, &["/Query", "/TN", TASK])]);
}

#[test]
fn a_scheduler_error_is_unknown_and_not_off() {
    let os = FakeSystem {
        scheduler_down: true,
        ..FakeSystem::default()
    };
    let state = read_state(&os, &env(false)).unwrap();
    assert!(state.unknown, "состояние задачи неизвестно");
    assert!(!state.enabled, "значения Run нет, задачу прочитать нельзя");

    // со значением Run автозапуск включён, но задача по-прежнему неизвестна
    *os.run.borrow_mut() = Some(RUN_DATA.to_string());
    let with_run = read_state(&os, &env(false)).unwrap();
    assert!(with_run.unknown && with_run.enabled);
    assert_eq!(with_run.method, Some(Method::Registry));
}

#[test]
fn not_found_is_told_from_other_errors_by_the_task_list() {
    // по имени отказ, но в списке задача есть — она есть
    let denied = FakeSystem {
        query_by_name_denied: true,
        ..FakeSystem::with_task()
    };
    let seen = read_state(&denied, &env(false)).unwrap();
    assert_eq!(
        (seen.enabled, seen.method, seen.unknown),
        (true, Some(Method::Task), false)
    );

    // список прочитан, имени в нём нет (есть лишь похожие) — задачи нет
    let absent = FakeSystem::default();
    let none = read_state(&absent, &env(false)).unwrap();
    assert!(!none.enabled && !none.unknown);
}

#[test]
fn a_missing_sid_makes_the_task_unknown_and_never_calls_the_scheduler() {
    let os = FakeSystem::default();
    let mut no_sid = env(false);
    no_sid.sid = None;
    let state = read_state(&os, &no_sid).unwrap();
    assert!(state.unknown);
    assert!(os.calls.borrow().iter().all(|(tool, _)| *tool == Tool::Reg));
}

#[test]
fn task_name_is_per_user() {
    assert_eq!(task_name(SID), TASK);
    assert_ne!(task_name(SID), task_name("S-1-5-21-1-2-3-1002"));
    assert!(task_name(SID).starts_with(TASK_PREFIX));
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
    assert_eq!(args[..4], ["/Create", "/TN", TASK, "/XML"]);
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
    assert_eq!(calls[1], run_delete());
}

#[test]
fn an_elevated_portable_copy_gets_the_plain_run_value_and_a_notice() {
    let os = FakeSystem::default();
    let state = set_enabled(&os, &portable(true), true).unwrap();
    // повышенная задача на exe в каталоге пользователя — обход UAC подменой файла
    assert!(!os.task.get(), "задача не создавалась");
    assert!(
        os.mutating_calls()
            .iter()
            .all(|(tool, _)| *tool == Tool::Reg),
        "{:?}",
        os.mutating_calls()
    );
    assert_eq!(
        os.run.borrow().as_deref(),
        Some(r#""C:\Users\u\Downloads\LAVRay.exe" --tray"#)
    );
    assert_eq!(state.method, Some(Method::Registry));
    assert_eq!(state.notice, Some(Notice::TaskInstalledOnly));
    assert!(state.elevated && !state.installed);
}

#[test]
fn plain_enable_writes_the_run_value_with_tray_flag() {
    let os = FakeSystem::default();
    let state = set_enabled(&os, &env(false), true).unwrap();
    assert_eq!(
        (state.enabled, state.method),
        (true, Some(Method::Registry))
    );
    assert_eq!(state.notice, None, "без прав задача и не предполагалась");
    assert_eq!(
        os.mutating_calls(),
        [call(
            Tool::Reg,
            &[
                "add",
                RUN_KEY_ARG,
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
    assert_eq!(os.mutating_calls()[1], task_delete());
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
    assert_eq!(os.mutating_calls(), [run_delete(), task_delete()]);
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
fn disable_with_an_unreadable_scheduler_still_clears_what_it_can() {
    let os = FakeSystem {
        scheduler_down: true,
        ..FakeSystem::with_run_value()
    };
    let state = set_enabled(&os, &env(true), false).unwrap();
    assert!(os.run.borrow().is_none(), "Run убран");
    assert!(
        state.unknown && !state.enabled,
        "про задачу по-прежнему ничего не известно"
    );
    assert_eq!(state.notice, None, "отказ при «неизвестно» не ошибка");
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
fn task_xml_has_the_logon_trigger_sid_and_battery_flags() {
    let xml = task_xml(Path::new(EXE), SID);
    for needed in [
        "<LogonTrigger>",
        &format!("<UserId>{SID}</UserId>"),
        "<RunLevel>HighestAvailable</RunLevel>",
        "<LogonType>InteractiveToken</LogonType>",
        "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
        "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
        "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
        "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
        r#"<Command>"C:\Program Files\LAVRay\LAVRay.exe"</Command>"#,
        "<Arguments>--tray</Arguments>",
    ] {
        assert!(xml.contains(needed), "нет {needed} в XML:\n{xml}");
    }
    // Каталог exe выделяет Path::parent, а на Linux CI `\` не разделитель.
    #[cfg(windows)]
    assert!(
        xml.contains(r"<WorkingDirectory>C:\Program Files\LAVRay</WorkingDirectory>"),
        "нет WorkingDirectory в XML:\n{xml}"
    );
    assert!(xml.starts_with(r#"<?xml version="1.0" encoding="UTF-16"?>"#));
    assert_eq!(xml.matches("<LogonTrigger>").count(), 1);
    assert_eq!(
        xml.matches(SID).count(),
        3,
        "SID в триггере, субъекте и дескрипторе"
    );
}

#[test]
fn task_xml_reaches_schtasks_as_utf16_with_the_real_path() {
    let os = FakeSystem::default();
    set_enabled(&os, &env(true), true).unwrap();
    let xml = os.created_xml.borrow().clone().unwrap();
    assert_eq!(xml, task_xml(Path::new(EXE), SID));
}

#[test]
fn task_xml_escapes_markup_characters_and_keeps_cyrillic() {
    let xml = task_xml(
        Path::new(r"C:\Users\Анатолий\A&B <x>\LAVRay.exe"),
        "S-1-5-21-9",
    );
    assert!(xml.contains(r"A&amp;B &lt;x&gt;"), "{xml}");
    assert!(xml.contains("<UserId>S-1-5-21-9</UserId>"), "{xml}");
    let bytes = encode_task_file(&xml);
    assert_eq!(bytes[..2], [0xFF, 0xFE]);
    assert_eq!(
        bytes.len(),
        2 + xml.encode_utf16().count() * 2,
        "BOM и 2 байта на единицу"
    );
}

#[test]
fn enabling_needs_a_sid_for_the_task_and_a_sane_path() {
    let os = FakeSystem::default();
    let mut no_sid = env(true);
    no_sid.sid = None;
    assert!(set_enabled(&os, &no_sid, true).is_err());
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
fn the_task_list_is_parsed_for_the_exact_root_task_name() {
    let list = "\"\\Microsoft\\Windows\\X\\LAVRay-S-1-5-21-5\",\"N/A\",\"Ready\"\r\n\
                \"\\LAVRay-S-1-5-21-50\",\"N/A\",\"Ready\"\r\n\
                \"\\lavray-s-1-5-21-5\",\"N/A\",\"Running\"\r\n";
    assert!(listed_in_csv(list, "LAVRay-S-1-5-21-5"), "регистр не важен");
    assert!(!listed_in_csv(list, "LAVRay-S-1-5-21-6"));
    assert!(!listed_in_csv(list, "LAVRay-S-1-5-21-"), "только целое имя");
    assert!(!listed_in_csv("INFO: no tasks\r\n", "LAVRay-S-1-5-21-5"));
    assert!(!listed_in_csv("", "LAVRay-S-1-5-21-5"));
    // задача из вложенной папки с тем же именем — не наша
    let nested = "\"\\Microsoft\\Windows\\X\\LAVRay-S-1-5-21-7\",\"N/A\",\"Ready\"\r\n";
    assert!(!listed_in_csv(nested, "LAVRay-S-1-5-21-7"));
}

#[cfg(windows)]
mod installed {
    use super::*;
    use crate::autostart::task::is_under_any;

    fn roots() -> Vec<PathBuf> {
        vec![
            PathBuf::from(r"C:\Program Files"),
            PathBuf::from(r"C:\Program Files (x86)"),
        ]
    }

    #[test]
    fn a_file_under_program_files_is_installed_whatever_the_case() {
        assert!(is_under_any(Path::new(EXE), &roots()));
        assert!(is_under_any(
            Path::new(r"c:\PROGRAM FILES (X86)\LAVRay\lavray.EXE"),
            &roots()
        ));
        // канонизированный вид с \\?\ — тот же каталог
        assert!(is_under_any(
            Path::new(r"\\?\C:\Program Files\LAVRay\LAVRay.exe"),
            &roots()
        ));
        assert!(is_under_any(
            Path::new(r"C:\Program Files\LAVRay\LAVRay.exe"),
            &[PathBuf::from(r"\\?\C:\Program Files")]
        ));
    }

    #[test]
    fn other_places_are_not_installed() {
        for path in [
            r"C:\Users\u\Downloads\LAVRay.exe",
            r"C:\Program Files Evil\LAVRay.exe", // тот же префикс строкой, другой каталог
            r"C:\Program Files",                 // сам каталог, не файл внутри
            r"D:\Program Files\LAVRay\LAVRay.exe", // другой диск
            r"C:\Program Files\..\Users\u\LAVRay.exe", // выход из каталога через ..
            r"LAVRay.exe",
        ] {
            assert!(!is_under_any(Path::new(path), &roots()), "{path}");
        }
        assert!(
            !is_under_any(Path::new(EXE), &[]),
            "без каталогов — не установлено"
        );
    }

    #[test]
    fn the_real_program_files_directories_are_found() {
        let dirs = program_files_dirs();
        assert!(!dirs.is_empty());
        let system = std::env::var("ProgramFiles").expect("переменная ProgramFiles");
        let probe = Path::new(&system).join("LAVRay").join("LAVRay.exe");
        assert!(is_under_any(&probe, &dirs), "{probe:?} в {dirs:?}");
        // а exe самого теста (target) — не установленная копия
        let me = std::fs::canonicalize(std::env::current_exe().unwrap()).unwrap();
        assert!(!is_under_any(&me, &dirs), "{me:?}");
    }
}

/// Записи SDDL задачи: (субъект, права).
fn aces(sddl: &str) -> Vec<(String, String)> {
    sddl.trim_start_matches("D:")
        .split('(')
        .skip(1)
        .map(|ace| {
            let parts: Vec<&str> = ace.trim_end_matches(')').split(';').collect();
            assert_eq!(parts[0], "A", "только разрешающие записи: {ace}");
            (parts[5].to_string(), parts[2].to_string())
        })
        .collect()
}

#[test]
fn task_xml_carries_the_security_descriptor_with_read_only_for_the_user() {
    let sddl = task_sddl(SID);
    assert_eq!(
        sddl,
        format!("D:(A;;FA;;;BA)(A;;FA;;;SY)(A;;FR;;;{SID})"),
        "администраторы и SYSTEM — всё, пользователь — только чтение"
    );
    let rights = aces(&sddl);
    assert_eq!(rights.len(), 3);
    assert!(rights.contains(&("BA".to_string(), "FA".to_string())));
    assert!(rights.contains(&("SY".to_string(), "FA".to_string())));
    // у пользователя ни записи (FW), ни запуска (FX), ни полного доступа
    assert!(rights.contains(&(SID.to_string(), "FR".to_string())));
    assert!(!sddl.contains("FW") && !sddl.contains("FX") && !sddl.contains("GA"));

    let xml = task_xml(Path::new(EXE), SID);
    assert!(
        xml.contains(&format!("<SecurityDescriptor>{sddl}</SecurityDescriptor>")),
        "{xml}"
    );
    let info = xml
        .split("<RegistrationInfo>")
        .nth(1)
        .and_then(|rest| rest.split("</RegistrationInfo>").next())
        .expect("RegistrationInfo");
    assert!(
        info.contains("<SecurityDescriptor>"),
        "дескриптор — в RegistrationInfo: {info}"
    );
    assert!(
        info.contains(&format!("({TASK_REVISION})")),
        "ревизия в описании: {info}"
    );
}

#[test]
fn an_elevated_instance_recreates_a_legacy_task_once() {
    let os = FakeSystem::with_task();
    os.legacy_task.set(true);

    let state = read_state(&os, &env(true)).unwrap();

    assert_eq!(
        (state.enabled, state.method, state.unknown),
        (true, Some(Method::Task), false)
    );
    let calls = os.mutating_calls();
    assert_eq!(calls.len(), 1, "{calls:?}");
    assert_eq!(calls[0].1[..4], ["/Create", "/TN", TASK, "/XML"]);
    assert!(os
        .calls
        .borrow()
        .contains(&call(Tool::Schtasks, &["/Query", "/TN", TASK, "/XML"])));
    assert_eq!(
        os.created_xml.borrow().clone().unwrap(),
        task_xml(Path::new(EXE), SID),
        "пересоздана с актуальным XML"
    );
    assert!(!os.legacy_task.get());

    // следующее чтение задачу уже не трогает
    read_state(&os, &env(true)).unwrap();
    assert_eq!(os.mutating_calls().len(), 1);
}

#[test]
fn a_current_task_is_left_alone_and_other_instances_never_touch_it() {
    let current = FakeSystem::with_task();
    read_state(&current, &env(true)).unwrap();
    assert!(
        current.mutating_calls().is_empty(),
        "актуальная задача не пересоздаётся"
    );

    for (label, env) in [
        ("без прав", env(false)),
        ("не установленная копия", portable(true)),
    ] {
        let old = FakeSystem::with_task();
        old.legacy_task.set(true);
        let state = read_state(&old, &env).unwrap();
        assert!(state.enabled, "{label}: состояние всё равно точное");
        assert!(
            old.mutating_calls().is_empty(),
            "{label}: задачу менять нельзя"
        );
        assert!(
            !old.calls
                .borrow()
                .iter()
                .any(|(_, args)| args.last().is_some_and(|a| a == "/XML")),
            "{label}: XML не запрашивался"
        );
    }
}

#[test]
fn a_failed_upgrade_does_not_break_reading_the_state() {
    let os = FakeSystem {
        fail_create: true,
        ..FakeSystem::with_task()
    };
    os.legacy_task.set(true);
    let state = read_state(&os, &env(true)).unwrap();
    assert!(state.enabled && !state.unknown);
    let file = os.created_file.borrow().clone().unwrap();
    assert!(!file.exists(), "временный XML убран и после сбоя");
}

#[test]
fn an_unreadable_task_xml_leaves_the_task_as_is() {
    // задача есть, но её XML не отдаётся: не пересоздаём вслепую
    let os = FakeSystem {
        query_by_name_denied: true,
        ..FakeSystem::with_task()
    };
    let state = read_state(&os, &env(true)).unwrap();
    assert!(state.enabled);
    assert!(os.mutating_calls().is_empty());
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
    let state = read_state(&os, &env(true)).unwrap();
    let json = serde_json::to_value(&state).unwrap();
    assert_eq!(json["method"], "task");
    assert_eq!(json["enabled"], true);
    assert_eq!(json["elevated"], true);
    assert_eq!(json["installed"], true);
    assert_eq!(json["unknown"], false);
    let mut denied = FakeSystem::with_task();
    denied.deny_task_delete = true;
    let blocked = set_enabled(&denied, &env(false), false).unwrap();
    assert_eq!(
        serde_json::to_value(&blocked).unwrap()["notice"],
        "task_needs_admin"
    );
    let os = FakeSystem::default();
    let only = set_enabled(&os, &portable(true), true).unwrap();
    assert_eq!(
        serde_json::to_value(&only).unwrap()["notice"],
        "task_installed_only"
    );
}

#[cfg(not(windows))]
#[test]
fn other_systems_answer_unsupported() {
    assert!(!supported());
    assert!(!current_state().unwrap().supported);
    assert_eq!(change(true).unwrap_err(), ERR_UNSUPPORTED);
}
