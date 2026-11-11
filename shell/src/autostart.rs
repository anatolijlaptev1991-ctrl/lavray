// SPDX-License-Identifier: GPL-3.0-only

//! Автозапуск с системой (T-82/Э-2). Состояние всегда читается из ОС (FR-UI-013),
//! в настройках не хранится. Способов два:
//!
//! - **с правами администратора из установленной версии** — задача планировщика
//!   `LAVRay-<SID>` (триггер входа пользователя, `RunLevel=HighestAvailable`):
//!   приложение, а с ним и ядро, стартует повышенным, и TUN работает сразу после
//!   входа, как у NekoBox. Задача создаётся, только если exe лежит под Program
//!   Files: повышенная задача на exe в каталоге, доступном пользователю на
//!   запись (portable, Загрузки), позволила бы обойти UAC подменой файла;
//! - **иначе** — значение `LAVRay` в `HKCU\...\Run`.
//!
//! Команды (`reg.exe`, `schtasks.exe`) идут через внедряемый [`Exec`], как в
//! `sysproxy`: тесты проверяют точные аргументы и текст XML на подставке и
//! не трогают ни реестр, ни планировщик. Приложение стартует с флагом `--tray`
//! (окно скрыто, только значок).
//!
//! На Linux автозапуск — запись XDG Desktop Entry в каталоге автозапуска
//! сеанса ([`desktop`]): внешних команд нет, состояние читается из файла.
//! Способы на ОС не смешиваются, поэтому выбор потока — в [`current_state`]
//! и [`change`], а логика каждого способа остаётся отдельной и проверяется
//! на любой платформе (тесты Windows-потока идут через инъекцию [`Exec`]).

pub mod migrate;

#[cfg(target_os = "linux")]
mod desktop;
#[cfg(target_os = "linux")]
mod linux;
mod task;

use crate::launch::ARG_TRAY;
use serde::Serialize;
use std::path::{Path, PathBuf};
use task::{
    encode_task_file, is_under_any, listed_in_csv, program_files_dirs, task_name, task_xml,
    TaskFile, TASK_REVISION,
};

pub use task::{task_sddl, TASK_PREFIX};

/// Имя значения в разделе `Run`.
pub const RUN_VALUE: &str = "LAVRay";
/// Раздел автозапуска текущего пользователя.
pub const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
/// Код ошибки для UI: на этой ОС автозапуск не поддерживается.
pub const ERR_UNSUPPORTED: &str = "unsupported";

/// Какие внешние программы допустимы: перечень закрыт, подставить произвольную
/// команду через этот интерфейс нельзя.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Reg,
    Schtasks,
}

/// Итог запуска программы: код возврата, вывод уже в строках.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

impl Output {
    /// Сообщение программы для пользователя: stderr, иначе stdout.
    fn message(&self) -> String {
        let text = if self.stderr.trim().is_empty() {
            &self.stdout
        } else {
            &self.stderr
        };
        text.trim().to_string()
    }
}

/// Исполнитель внешних команд. `Err` — программу не удалось запустить;
/// ненулевой код возврата — это `Ok(Output { success: false, .. })`.
pub trait Exec {
    fn run(&self, tool: Tool, args: &[String]) -> Result<Output, String>;
}

/// Чем включён автозапуск.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Method {
    /// Задача планировщика (с повышением).
    Task,
    /// Значение в `HKCU\...\Run` (обычный запуск).
    Registry,
    /// Запись автозапуска сеанса (Linux, XDG Desktop Entry).
    DesktopEntry,
}

/// Пояснение к результату операции (код, текст подбирает UI).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Notice {
    /// Задачу планировщика без прав администратора не удалить: она осталась.
    TaskNeedsAdmin,
    /// Задача с правами администратора — только для установленной версии
    /// (Program Files): из этой копии включён обычный автозапуск.
    TaskInstalledOnly,
}

/// Состояние автозапуска для UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AutostartState {
    /// На этой ОС автозапуск управляется из приложения (Windows).
    pub supported: bool,
    /// Автозапуск включён хотя бы одним способом.
    pub enabled: bool,
    /// Каким способом (если включён); при обоих сразу — задача.
    pub method: Option<Method>,
    /// Процесс сейчас с правами администратора.
    pub elevated: bool,
    /// Exe лежит под Program Files: только тогда допустима задача с правами.
    pub installed: bool,
    /// Узнать, есть ли задача планировщика, не удалось (ошибка `schtasks`, а не
    /// «не найдено»): «выключено» тут было бы неправдой.
    pub unknown: bool,
    /// Что не удалось довести до конца (только в ответе на изменение).
    pub notice: Option<Notice>,
}

impl AutostartState {
    /// Ответ ОС без автозапуска из приложения: строку в UI нужно скрыть.
    pub fn unsupported() -> Self {
        Self {
            supported: false,
            enabled: false,
            method: None,
            elevated: false,
            installed: false,
            unknown: false,
            notice: None,
        }
    }
}

/// Окружение текущего процесса для автозапуска.
#[derive(Debug, Clone)]
pub struct Env {
    /// Путь к собственному exe: его запускает автозапуск.
    pub exe: PathBuf,
    /// SID пользователя из токена процесса: имя задачи и `UserId` в XML.
    pub sid: Option<String>,
    /// Процесс запущен с правами администратора.
    pub elevated: bool,
    /// Exe (канонизированный) лежит под Program Files.
    pub installed: bool,
}

impl Env {
    pub fn detect() -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|e| format!("путь к LAVRay.exe: {e}"))?;
        // Ссылку из Program Files на чужой каталог проверка должна разворачивать.
        let real = std::fs::canonicalize(&exe).unwrap_or_else(|_| exe.clone());
        Ok(Self {
            installed: is_under_any(&real, &program_files_dirs()),
            exe,
            sid: crate::token::user_sid(),
            elevated: crate::elevation::is_elevated(),
        })
    }

    /// Имя задачи этого пользователя.
    fn task_name(&self) -> Option<String> {
        self.sid.as_deref().map(task_name)
    }

    /// Можно ли включить автозапуск задачей: права есть и exe установлен.
    fn can_task(&self) -> bool {
        self.elevated && self.installed
    }
}

fn argv(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| (*item).to_string()).collect()
}

/// Результат поиска задачи.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Seen {
    Yes,
    No,
    /// Ошибка планировщика, а не «не найдено».
    Unknown,
}

/// Что сейчас есть в ОС.
#[derive(Debug, Clone, Copy)]
struct Presence {
    task: Seen,
    run: bool,
}

/// Есть ли задача. `schtasks /Query /TN` падает одинаково на «нет такой задачи»
/// и на любую другую ошибку (текст зависит от языка ОС), поэтому при отказе
/// список задач читается целиком: список прочитан и имени в нём нет — задачи
/// действительно нет, список не прочитан — состояние неизвестно.
fn probe_task(exec: &impl Exec, name: Option<&str>) -> Seen {
    let Some(name) = name else {
        return Seen::Unknown;
    };
    match exec.run(Tool::Schtasks, &argv(&["/Query", "/TN", name])) {
        Ok(out) if out.success => return Seen::Yes,
        Ok(_) => {}
        Err(_) => return Seen::Unknown,
    }
    match exec.run(Tool::Schtasks, &argv(&["/Query", "/FO", "CSV", "/NH"])) {
        Ok(list) if list.success => {
            if listed_in_csv(&list.stdout, name) {
                Seen::Yes
            } else {
                Seen::No
            }
        }
        _ => Seen::Unknown,
    }
}

fn presence(exec: &impl Exec, env: &Env) -> Result<Presence, String> {
    let task = probe_task(exec, env.task_name().as_deref());
    let run = exec.run(Tool::Reg, &argv(&["query", RUN_KEY, "/v", RUN_VALUE]))?;
    Ok(Presence {
        task,
        run: run.success,
    })
}

fn state_of(found: Presence, env: &Env) -> AutostartState {
    let method = if found.task == Seen::Yes {
        Some(Method::Task)
    } else if found.run {
        Some(Method::Registry)
    } else {
        None
    };
    AutostartState {
        supported: true,
        enabled: method.is_some(),
        method,
        elevated: env.elevated,
        installed: env.installed,
        unknown: found.task == Seen::Unknown,
        notice: None,
    }
}

/// Задача старого вида (без дескриптора безопасности, ревизия в описании
/// другая) пересоздаётся с актуальным XML. Это делает только повышенный
/// экземпляр из установленной копии: обычному процессу задачу не изменить.
/// Сбой чтения или пересоздания не мешает показать состояние.
fn upgrade_old_task(exec: &impl Exec, env: &Env) {
    let Some(name) = env.task_name() else { return };
    let current = exec.run(Tool::Schtasks, &argv(&["/Query", "/TN", &name, "/XML"]));
    if let Ok(out) = current {
        if out.success && !out.stdout.contains(TASK_REVISION) {
            let _ = create_task(exec, env);
        }
    }
}

/// Прочитать состояние из ОС (задача планировщика и значение `Run`). Повышенный
/// экземпляр заодно пересоздаёт задачи старого вида.
pub fn read_state(exec: &impl Exec, env: &Env) -> Result<AutostartState, String> {
    let found = presence(exec, env)?;
    if found.task == Seen::Yes && env.can_task() {
        upgrade_old_task(exec, env);
    }
    Ok(state_of(found, env))
}

/// Строка запуска: `"<exe>" --tray`.
pub fn run_command(exe: &Path) -> String {
    format!("\"{}\" {ARG_TRAY}", exe.display())
}

fn create_task(exec: &impl Exec, env: &Env) -> Result<(), String> {
    let sid = env
        .sid
        .as_deref()
        .ok_or("не удалось определить SID пользователя из токена процесса")?;
    let file = TaskFile::create(&encode_task_file(&task_xml(&env.exe, sid)))?;
    let out = exec.run(
        Tool::Schtasks,
        &[
            "/Create".to_string(),
            "/TN".to_string(),
            task_name(sid),
            "/XML".to_string(),
            file.path_arg(),
            "/F".to_string(),
        ],
    )?;
    if out.success {
        Ok(())
    } else {
        Err(format!("schtasks /Create: {}", out.message()))
    }
}

fn delete_task(exec: &impl Exec, env: &Env) -> Result<(), String> {
    let name = env
        .task_name()
        .ok_or("не удалось определить SID пользователя из токена процесса")?;
    let out = exec.run(Tool::Schtasks, &argv(&["/Delete", "/TN", &name, "/F"]))?;
    if out.success {
        Ok(())
    } else {
        Err(format!("schtasks /Delete: {}", out.message()))
    }
}

fn add_run_value(exec: &impl Exec, exe: &Path) -> Result<(), String> {
    let command = run_command(exe);
    let out = exec.run(
        Tool::Reg,
        &[
            "add".to_string(),
            RUN_KEY.to_string(),
            "/v".to_string(),
            RUN_VALUE.to_string(),
            "/t".to_string(),
            "REG_SZ".to_string(),
            "/d".to_string(),
            command,
            "/f".to_string(),
        ],
    )?;
    if out.success {
        Ok(())
    } else {
        Err(format!("reg add: {}", out.message()))
    }
}

fn delete_run_value(exec: &impl Exec) -> Result<(), String> {
    let out = exec.run(
        Tool::Reg,
        &argv(&["delete", RUN_KEY, "/v", RUN_VALUE, "/f"]),
    )?;
    if out.success {
        Ok(())
    } else {
        Err(format!("reg delete: {}", out.message()))
    }
}

fn enable(exec: &impl Exec, env: &Env, before: Presence) -> Result<Option<Notice>, String> {
    if env.exe.to_string_lossy().contains('"') {
        return Err(format!(
            "недопустимый путь к программе: {}",
            env.exe.display()
        ));
    }
    if env.can_task() {
        create_task(exec, env)?;
        if before.run {
            delete_run_value(exec)?; // чтобы не стартовать дважды
        }
        return Ok(None);
    }
    // Обычный автозапуск. С правами, но из не установленной копии, он единственный
    // допустимый: об этом говорит уведомление.
    add_run_value(exec, &env.exe)?;
    let mut notice = (env.elevated && !env.installed).then_some(Notice::TaskInstalledOnly);
    // Старая задача: удалить без прав может не получиться — тогда она остаётся.
    if before.task != Seen::No && delete_task(exec, env).is_err() && before.task == Seen::Yes {
        notice = Some(Notice::TaskNeedsAdmin);
    }
    Ok(notice)
}

fn disable(exec: &impl Exec, env: &Env, before: Presence) -> Result<Option<Notice>, String> {
    let run_result = if before.run {
        delete_run_value(exec)
    } else {
        Ok(())
    };
    let mut notice = None;
    // «Неизвестно» тоже пробуем удалить, но отказ там не ошибка: задачи могло и не быть.
    if before.task != Seen::No {
        if let Err(reason) = delete_task(exec, env) {
            if before.task == Seen::Yes {
                if env.elevated {
                    return Err(reason);
                }
                notice = Some(Notice::TaskNeedsAdmin);
            }
        }
    }
    run_result?;
    Ok(notice)
}

/// Включить или выключить автозапуск и вернуть состояние, заново прочитанное
/// из ОС. Включение с правами администратора из установленной копии создаёт
/// задачу планировщика (и убирает значение `Run`), иначе пишет значение `Run`.
pub fn set_enabled(exec: &impl Exec, env: &Env, enabled: bool) -> Result<AutostartState, String> {
    let before = presence(exec, env)?;
    let notice = if enabled {
        enable(exec, env, before)?
    } else {
        disable(exec, env, before)?
    };
    let mut state = read_state(exec, env)?;
    state.notice = notice;
    Ok(state)
}

/// Системный исполнитель: `reg.exe` и `schtasks.exe` из `System32` по полному
/// пути (имя без пути ищется сначала в каталоге приложения, а команда может
/// выполняться с правами администратора — A2-07).
pub struct System;

#[cfg(windows)]
impl Exec for System {
    fn run(&self, tool: Tool, args: &[String]) -> Result<Output, String> {
        use crate::oemtext::decode_console_output;
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let name = match tool {
            Tool::Reg => "reg.exe",
            Tool::Schtasks => "schtasks.exe",
        };
        let root = std::env::var_os("SystemRoot")
            .or_else(|| std::env::var_os("windir"))
            .unwrap_or_else(|| r"C:\Windows".into());
        let out = std::process::Command::new(PathBuf::from(root).join("System32").join(name))
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("{name}: {e}"))?;
        Ok(Output {
            success: out.status.success(),
            stdout: decode_console_output(&out.stdout),
            stderr: decode_console_output(&out.stderr),
        })
    }
}

#[cfg(not(windows))]
impl Exec for System {
    fn run(&self, _tool: Tool, _args: &[String]) -> Result<Output, String> {
        Err(ERR_UNSUPPORTED.to_string())
    }
}

/// Автозапуск управляется из приложения на Windows (задача планировщика или
/// значение `Run`) и на Linux (запись XDG в каталоге автозапуска сеанса).
pub fn supported() -> bool {
    cfg!(windows) || cfg!(target_os = "linux")
}

/// Состояние автозапуска в этой ОС (то, что отдаёт команда `autostart_state`).
pub fn current_state() -> Result<AutostartState, String> {
    if !supported() {
        return Ok(AutostartState::unsupported());
    }
    let env = Env::detect()?;
    #[cfg(target_os = "linux")]
    let state = {
        let dir = desktop::autostart_dir()?;
        linux::state(&dir, &env)
    };
    #[cfg(not(target_os = "linux"))]
    let state = read_state(&System, &env);
    state
}

/// Изменить автозапуск в этой ОС (команда `set_autostart`).
pub fn change(enabled: bool) -> Result<AutostartState, String> {
    if !supported() {
        return Err(ERR_UNSUPPORTED.to_string());
    }
    let env = Env::detect()?;
    #[cfg(target_os = "linux")]
    let state = {
        let dir = desktop::autostart_dir()?;
        linux::set_enabled(&dir, &env, enabled)
    };
    #[cfg(not(target_os = "linux"))]
    let state = set_enabled(&System, &env, enabled);
    state
}

#[cfg(test)]
mod tests;

#[cfg(target_os = "linux")]
#[cfg(test)]
mod desktop_parse_tests;

#[cfg(target_os = "linux")]
#[cfg(test)]
mod desktop_tests;
