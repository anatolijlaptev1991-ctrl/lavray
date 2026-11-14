// SPDX-License-Identifier: GPL-3.0-only

//! Повышенные права процесса (T-46, T-81). TUN без прав администратора
//! (Windows) или root (Unix) не поднимется. Модель прав — «как в `NekoBox`»,
//! без системной службы: TUN работает, когда приложение (а с ним и ядро, его
//! дочерний процесс) запущено от администратора. Оболочка отвечает, запущена
//! ли она с повышением ([`is_elevated`]), и по явной просьбе пользователя
//! перезапускает себя от администратора ([`relaunch_elevated`]): диалог UAC
//! показывает сама система, отказ в нём ничего не ломает.

use crate::launch::relaunch_args;
use serde::Serialize;
use std::path::Path;

/// `true`, если процесс запущен с повышенными правами: Windows — токен с
/// `TokenIsElevated`, Unix — euid 0.
#[must_use]
pub fn is_elevated() -> bool {
    imp::is_elevated()
}

/// Чем кончилась просьба «Перезапустить от администратора».
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RelaunchOutcome {
    /// Второй экземпляр запущен с повышением: этому процессу пора выходить
    /// обычным путём (останов ядра, возврат системного прокси).
    Started,
    /// Пользователь отказал в диалоге UAC: приложение осталось как было.
    Cancelled,
}

/// Код ошибки для UI: процесс уже с правами, перезапускать незачем.
pub const ERR_ALREADY_ELEVATED: &str = "already_elevated";
/// Код ошибки для UI: на этой ОС перезапуск с повышением не поддерживается.
pub const ERR_UNSUPPORTED: &str = "unsupported";
/// Код ошибки для UI: учётная запись обычная, повысить права без пароля другого
/// пользователя нельзя — `runas` вызывать незачем, нужен администратор.
pub const ERR_ADMIN_ACCOUNT_REQUIRED: &str = "admin_account_required";

/// Почему запуск с повышением не состоялся.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunasError {
    /// Отказ в диалоге UAC (`ERROR_CANCELLED`, 1223).
    Cancelled,
    /// ОС не умеет повышать запуск (не Windows): права даёт пользователь.
    Unsupported,
    /// Прочий сбой, текст — от ОС.
    Failed(String),
}

/// Запуск программы с повышением. В продакшене — [`Runas`] (`ShellExecuteExW`,
/// глагол `runas`), в тестах — подставка: настоящий UAC на разработческой
/// машине вызывать нельзя.
pub trait Elevator {
    fn run_elevated(&self, exe: &Path, args: &[String]) -> Result<(), RunasError>;
}

/// Системный запуск с повышением.
pub struct Runas;

impl Elevator for Runas {
    fn run_elevated(&self, exe: &Path, args: &[String]) -> Result<(), RunasError> {
        imp::run_elevated(exe, args)
    }
}

/// Что известно о текущем экземпляре в момент просьбы о перезапуске.
pub struct RelaunchRequest<'a> {
    /// Собственный exe: перезапуск идёт именно на него.
    pub exe: &'a Path,
    /// pid текущего процесса: новый экземпляр дождётся его выхода.
    pub parent_pid: u32,
    /// Окно сейчас скрыто в трей: новый экземпляр тоже стартует скрытым.
    pub window_hidden: bool,
    /// Права текущего процесса (`is_elevated()` на момент вызова).
    pub elevated: bool,
    /// Процесс может повыситься сам (UAC спросит только согласие): тип токена
    /// не `Default`. Обычному пользователю UAC потребовал бы пароль чужой
    /// учётной записи — тогда запрос не выполняется.
    pub can_elevate: bool,
}

/// Перезапустить приложение от администратора. Сам выход текущего экземпляра
/// делает вызывающий после `Ok(Started)`: здесь только запуск.
///
/// Ошибки — стабильные коды ([`ERR_ALREADY_ELEVATED`], [`ERR_UNSUPPORTED`]) или
/// текст ОС; отказ в UAC ошибкой не считается — это [`RelaunchOutcome::Cancelled`].
pub fn relaunch_elevated(
    elevator: &impl Elevator,
    request: &RelaunchRequest<'_>,
) -> Result<RelaunchOutcome, String> {
    if request.elevated {
        return Err(ERR_ALREADY_ELEVATED.to_string());
    }
    if !request.can_elevate {
        return Err(ERR_ADMIN_ACCOUNT_REQUIRED.to_string());
    }
    let args = relaunch_args(request.parent_pid, request.window_hidden);
    match elevator.run_elevated(request.exe, &args) {
        Ok(()) => Ok(RelaunchOutcome::Started),
        Err(RunasError::Cancelled) => Ok(RelaunchOutcome::Cancelled),
        Err(RunasError::Unsupported) => Err(ERR_UNSUPPORTED.to_string()),
        Err(RunasError::Failed(reason)) => Err(reason),
    }
}

#[cfg(windows)]
mod imp {
    use super::RunasError;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    pub fn is_elevated() -> bool {
        let mut token: HANDLE = std::ptr::null_mut();
        // SAFETY: псевдо-хэндл процесса закрывать не нужно; `token` — валидный
        // указатель на локальную переменную.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut token) } == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned = 0u32;
        // SAFETY: `token` открыт выше; буфер — `repr(C)` структура, её размер
        // передан как длина.
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenElevation,
                std::ptr::from_mut(&mut elevation).cast(),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &raw mut returned,
            )
        };
        // SAFETY: `token` открыт выше и закрывается ровно один раз.
        unsafe { CloseHandle(token) };
        ok != 0 && elevation.TokenIsElevated != 0
    }

    /// `ShellExecuteExW` с глаголом `runas`: система сама показывает UAC.
    /// Возврат — когда пользователь ответил на диалог и процесс создан.
    pub fn run_elevated(exe: &Path, args: &[String]) -> Result<(), RunasError> {
        use windows_sys::Win32::Foundation::{GetLastError, ERROR_CANCELLED};
        use windows_sys::Win32::System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        };
        use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        fn wide(text: &OsStr) -> Vec<u16> {
            text.encode_wide().chain(std::iter::once(0)).collect()
        }
        let verb = wide(OsStr::new("runas"));
        let file = wide(exe.as_os_str());
        let params = wide(OsStr::new(&args.join(" ")));
        let dir = exe.parent().map(|dir| wide(dir.as_os_str()));

        // SAFETY: структура из нулей — допустимое начальное состояние
        // SHELLEXECUTEINFOW; обязательные поля заполняются ниже.
        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOASYNC; // вызов из потока без цикла сообщений
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        info.lpDirectory = dir.as_ref().map_or(std::ptr::null(), std::vec::Vec::as_ptr);
        info.nShow = SW_SHOWNORMAL;

        // SAFETY: COM нужен оболочке Windows для ShellExecute вне потока окна;
        // `S_FALSE`/`S_OK` (>= 0) закрываются парным `CoUninitialize`, отказ
        // (поток уже в другом режиме) — нет.
        let com = unsafe {
            CoInitializeEx(
                std::ptr::null(),
                (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
            )
        };
        // SAFETY: `info` и все строки (`verb`, `file`, `params`, `dir`) живут до
        // конца вызова; `cbSize` указан.
        let launched = unsafe { ShellExecuteExW(&raw mut info) } != 0;
        // SAFETY: читает код последней ошибки потока сразу после вызова.
        let code = if launched {
            0
        } else {
            unsafe { GetLastError() }
        };
        if com >= 0 {
            // SAFETY: парный вызов к успешному `CoInitializeEx` выше.
            unsafe { CoUninitialize() };
        }
        match code {
            _ if launched => Ok(()),
            ERROR_CANCELLED => Err(RunasError::Cancelled),
            other => Err(RunasError::Failed(format!(
                "ShellExecuteEx: код ошибки Windows {other}"
            ))),
        }
    }
}

#[cfg(unix)]
mod imp {
    use super::RunasError;
    use std::path::Path;

    pub fn is_elevated() -> bool {
        // SAFETY: `geteuid` — сисколл без аргументов и побочных эффектов.
        unsafe { libc::geteuid() == 0 }
    }

    /// Перезапуск всего GUI с повышением на unix не поддерживается: права для
    /// TUN выдаются ядру (`tunaccess`), а не оболочке.
    pub fn run_elevated(_exe: &Path, _args: &[String]) -> Result<(), RunasError> {
        Err(RunasError::Unsupported)
    }
}

#[cfg(not(any(windows, unix)))]
mod imp {
    pub fn is_elevated() -> bool {
        false
    }

    pub fn run_elevated(_exe: &std::path::Path, _args: &[String]) -> Result<(), super::RunasError> {
        Err(super::RunasError::Unsupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::process::Command;

    /// Подставной исполнитель: пишет, что у него просили, и отвечает заданным.
    struct FakeElevator {
        answer: Result<(), RunasError>,
        calls: RefCell<Vec<(PathBuf, Vec<String>)>>,
    }

    impl FakeElevator {
        fn answering(answer: Result<(), RunasError>) -> Self {
            Self {
                answer,
                calls: RefCell::new(Vec::new()),
            }
        }
    }

    impl Elevator for FakeElevator {
        fn run_elevated(&self, exe: &Path, args: &[String]) -> Result<(), RunasError> {
            self.calls
                .borrow_mut()
                .push((exe.to_path_buf(), args.to_vec()));
            self.answer.clone()
        }
    }

    fn request(elevated: bool, window_hidden: bool) -> RelaunchRequest<'static> {
        RelaunchRequest {
            exe: Path::new(r"C:\Program Files\LAVRay\LAVRay.exe"),
            parent_pid: 1234,
            window_hidden,
            elevated,
            can_elevate: true,
        }
    }

    /// Ответ — настоящий `bool` и не меняется между вызовами (в тестовой среде
    /// `cargo test` запущен без повышения, но проверять это нельзя: CI бывает
    /// и с root).
    #[test]
    fn is_elevated_reports_bool() {
        let first: bool = is_elevated();
        assert_eq!(first, is_elevated());
    }

    #[test]
    fn relaunch_starts_own_exe_with_wait_pid() {
        let elevator = FakeElevator::answering(Ok(()));
        let outcome = relaunch_elevated(&elevator, &request(false, false));
        assert_eq!(outcome, Ok(RelaunchOutcome::Started));
        assert_eq!(
            *elevator.calls.borrow(),
            [(
                PathBuf::from(r"C:\Program Files\LAVRay\LAVRay.exe"),
                vec![
                    "--elevated-relaunch".to_string(),
                    "--wait-pid=1234".to_string()
                ]
            )]
        );
    }

    #[test]
    fn relaunch_keeps_the_window_hidden_when_it_was_hidden() {
        let elevator = FakeElevator::answering(Ok(()));
        relaunch_elevated(&elevator, &request(false, true)).unwrap();
        let calls = elevator.calls.borrow();
        assert_eq!(calls[0].1.last().map(String::as_str), Some("--tray"));
    }

    #[test]
    fn uac_refusal_is_an_outcome_not_an_error() {
        let elevator = FakeElevator::answering(Err(RunasError::Cancelled));
        assert_eq!(
            relaunch_elevated(&elevator, &request(false, false)),
            Ok(RelaunchOutcome::Cancelled)
        );
    }

    #[test]
    fn an_already_elevated_process_is_not_relaunched() {
        let elevator = FakeElevator::answering(Ok(()));
        assert_eq!(
            relaunch_elevated(&elevator, &request(true, false)),
            Err(ERR_ALREADY_ELEVATED.to_string())
        );
        assert!(elevator.calls.borrow().is_empty(), "UAC не вызывался");
    }

    #[test]
    fn a_standard_user_never_reaches_the_uac_credentials_prompt() {
        let elevator = FakeElevator::answering(Ok(()));
        let mut standard = request(false, false);
        standard.can_elevate = false;
        assert_eq!(
            relaunch_elevated(&elevator, &standard),
            Err(ERR_ADMIN_ACCOUNT_REQUIRED.to_string())
        );
        assert!(elevator.calls.borrow().is_empty(), "runas не вызывался");
    }

    #[test]
    fn other_failures_reach_the_ui_as_text_or_stable_code() {
        let failed = FakeElevator::answering(Err(RunasError::Failed("код 5".into())));
        assert_eq!(
            relaunch_elevated(&failed, &request(false, false)),
            Err("код 5".to_string())
        );
        let unsupported = FakeElevator::answering(Err(RunasError::Unsupported));
        assert_eq!(
            relaunch_elevated(&unsupported, &request(false, false)),
            Err(ERR_UNSUPPORTED.to_string())
        );
    }

    /// На unix перезапуска GUI с повышением нет: права для TUN выдаются ядру
    /// (`tunaccess`). Настоящий `Runas` ничего не запускает и отвечает `unsupported`.
    #[cfg(unix)]
    #[test]
    fn unix_never_relaunches_the_gui() {
        let outcome = relaunch_elevated(&Runas, &request(false, false));
        assert_eq!(outcome, Err(ERR_UNSUPPORTED.to_string()));
    }

    #[test]
    fn outcome_serializes_as_snake_case_words() {
        assert_eq!(
            serde_json::to_string(&RelaunchOutcome::Started).unwrap(),
            "\"started\""
        );
        assert_eq!(
            serde_json::to_string(&RelaunchOutcome::Cancelled).unwrap(),
            "\"cancelled\""
        );
    }

    /// Ответ совпадает с независимой проверкой системы: Windows — членство
    /// токена в «Администраторах» (у неповышенного токена UAC группа «только
    /// для запрета», `IsInRole` даёт `False`); Unix — `id -u`.
    #[test]
    fn agrees_with_the_system_answer() {
        #[cfg(windows)]
        let expected = {
            let check = "([Security.Principal.WindowsPrincipal][Security.Principal.\
                WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.\
                WindowsBuiltInRole]::Administrator)";
            let out = Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", check])
                .output()
                .expect("powershell.exe запускается");
            String::from_utf8_lossy(&out.stdout).trim() == "True"
        };
        #[cfg(unix)]
        let expected = {
            let out = Command::new("id")
                .arg("-u")
                .output()
                .expect("id запускается");
            String::from_utf8_lossy(&out.stdout).trim() == "0"
        };
        #[cfg(not(any(windows, unix)))]
        let expected = false;
        assert_eq!(is_elevated(), expected);
        assert_eq!(is_elevated(), is_elevated());
    }
}
