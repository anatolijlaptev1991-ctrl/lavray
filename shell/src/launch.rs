// SPDX-License-Identifier: GPL-3.0-only

//! Аргументы запуска оболочки (T-81/Э-2, T-82/Э-2): `--tray`,
//! `--elevated-relaunch`, `--wait-pid=<pid>`. Разбор и ожидание чужого процесса
//! не зависят от GUI и проверяются тестами; в `main.rs` только вызов.
//!
//! Зачем `--wait-pid`: перезапуск от администратора запускает второй экземпляр,
//! пока первый ещё гасит ядро и снимает системный прокси. Плагин single-instance
//! в этот момент передал бы аргументы старому окну и закрыл новый экземпляр,
//! поэтому новый ждёт выхода старого процесса до инициализации плагинов.

use std::time::Duration;

/// Старт со скрытым окном: только значок в трее (автозапуск).
pub const ARG_TRAY: &str = "--tray";
/// Экземпляр запущен перезапуском от администратора из диалога TUN.
pub const ARG_ELEVATED_RELAUNCH: &str = "--elevated-relaunch";
/// Дождаться выхода процесса с этим pid, прежде чем стартовать.
pub const ARG_WAIT_PID: &str = "--wait-pid";

/// Сколько новый экземпляр ждёт выхода старого: лестница остановки ядра (§5) —
/// до 15 с, плюс запас на снятие прокси.
pub const WAIT_PID_TIMEOUT: Duration = Duration::from_secs(20);
/// Период опроса «процесс ещё жив».
pub const WAIT_PID_POLL: Duration = Duration::from_millis(100);
/// Пауза после выхода прежнего процесса: его процессы `WebView2` закрываются чуть
/// позже, а новый экземпляр (с другим уровнем прав) уже открывает тот же профиль.
pub const WAIT_PID_SETTLE: Duration = Duration::from_millis(500);

/// Разобранные аргументы командной строки.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct LaunchArgs {
    /// Скрыть окно при старте (`--tray`).
    pub tray: bool,
    /// Запуск после «Перезапустить от администратора».
    pub elevated_relaunch: bool,
    /// pid процесса, выхода которого нужно дождаться.
    pub wait_pid: Option<u32>,
}

impl LaunchArgs {
    /// Разбор аргументов без имени программы. Неизвестные игнорируются (их
    /// может добавить ОС или будущий deep link); `--wait-pid=` с нечислом и
    /// нулём считается незаданным: ждать «процесс 0» нечего.
    pub fn parse<I, S>(args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut parsed = Self::default();
        for arg in args {
            let arg = arg.as_ref();
            if arg == ARG_TRAY {
                parsed.tray = true;
            } else if arg == ARG_ELEVATED_RELAUNCH {
                parsed.elevated_relaunch = true;
            } else if let Some(pid) = arg
                .strip_prefix(ARG_WAIT_PID)
                .and_then(|rest| rest.strip_prefix('='))
            {
                parsed.wait_pid = pid.parse::<u32>().ok().filter(|pid| *pid != 0);
            }
        }
        parsed
    }

    /// Аргументы процесса из `std::env::args_os()` (без имени программы):
    /// не-Unicode аргумент не должен ронять запуск.
    #[must_use]
    pub fn from_env() -> Self {
        Self::parse(
            std::env::args_os()
                .skip(1)
                .map(|arg| arg.to_string_lossy().into_owned()),
        )
    }
}

/// Аргументы для второго экземпляра: кого дождаться и скрыто ли окно.
#[must_use]
pub fn relaunch_args(parent_pid: u32, tray: bool) -> Vec<String> {
    let mut args = vec![
        ARG_ELEVATED_RELAUNCH.to_string(),
        format!("{ARG_WAIT_PID}={parent_pid}"),
    ];
    if tray {
        args.push(ARG_TRAY.to_string());
    }
    args
}

/// Ждёт, пока `alive(pid)` не станет `false`, но не дольше `timeout`.
/// `true` — процесса больше нет, `false` — вышли по таймауту. Часы и опрос
/// внедряются, чтобы тест обходился без реального ожидания.
pub fn wait_until_gone(
    pid: u32,
    timeout: Duration,
    poll: Duration,
    mut alive: impl FnMut(u32) -> bool,
    mut sleep: impl FnMut(Duration),
) -> bool {
    let mut waited = Duration::ZERO;
    while alive(pid) {
        if waited >= timeout {
            return false;
        }
        sleep(poll);
        waited += poll;
    }
    true
}

/// Дождаться выхода процесса `pid` (до [`WAIT_PID_TIMEOUT`]) и выдержать паузу
/// [`WAIT_PID_SETTLE`]. `false` — он всё ещё жив: запуск продолжается,
/// single-instance сам передаст управление старому окну.
pub fn wait_for_exit(pid: u32) -> bool {
    let gone = wait_until_gone(
        pid,
        WAIT_PID_TIMEOUT,
        WAIT_PID_POLL,
        process_alive,
        std::thread::sleep,
    );
    if gone {
        std::thread::sleep(WAIT_PID_SETTLE);
    }
    gone
}

/// Жив ли процесс `pid`. Нет доступа к процессу — считаем живым: ждать
/// дольше безопаснее, чем стартовать поверх чужого окна.
#[cfg(windows)]
#[must_use]
pub fn process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

    /// Право ждать на хэндле процесса (`SYNCHRONIZE`).
    const SYNCHRONIZE: u32 = 0x0010_0000;
    // SAFETY: вызов без указателей; нулевой хэндл означает ошибку и
    // проверяется ниже.
    let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        // Нет такого pid — процесса нет; прочие отказы — не знаем, значит жив.
        // SAFETY: читает код последней ошибки потока.
        return unsafe { GetLastError() } != ERROR_INVALID_PARAMETER;
    }
    // SAFETY: `handle` открыт выше; нулевое ожидание только опрашивает.
    let state = unsafe { WaitForSingleObject(handle, 0) };
    // SAFETY: `handle` закрывается ровно один раз.
    unsafe { CloseHandle(handle) };
    state == WAIT_TIMEOUT
}

#[cfg(unix)]
pub fn process_alive(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    // SAFETY: сигнал 0 ничего не доставляет, только проверяет существование.
    let sent = unsafe { libc::kill(pid, 0) };
    sent == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(any(windows, unix)))]
pub fn process_alive(_pid: u32) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn parses_tray_relaunch_and_wait_pid() {
        let args = LaunchArgs::parse(["--tray", "--elevated-relaunch", "--wait-pid=4242"]);
        assert_eq!(
            args,
            LaunchArgs {
                tray: true,
                elevated_relaunch: true,
                wait_pid: Some(4242),
            }
        );
        assert_eq!(
            LaunchArgs::parse(Vec::<String>::new()),
            LaunchArgs::default()
        );
    }

    #[test]
    fn ignores_unknown_and_malformed_arguments() {
        for bad in [
            "--wait-pid",
            "--wait-pid=",
            "--wait-pid=abc",
            "--wait-pid=0",
            "--wait-pid=-5",
            "--wait-pid=99999999999",
            "--wait-pidx=7",
        ] {
            assert_eq!(LaunchArgs::parse([bad]).wait_pid, None, "{bad}");
        }
        let args = LaunchArgs::parse(["lavray://import?url=x", "--unknown", "--tray=1"]);
        assert_eq!(args, LaunchArgs::default(), "точное совпадение флага");
    }

    #[test]
    fn the_last_wait_pid_wins() {
        let args = LaunchArgs::parse(["--wait-pid=1", "--wait-pid=2"]);
        assert_eq!(args.wait_pid, Some(2));
    }

    #[test]
    fn relaunch_args_carry_parent_pid_and_hidden_window() {
        assert_eq!(
            relaunch_args(77, false),
            ["--elevated-relaunch", "--wait-pid=77"]
        );
        assert_eq!(
            relaunch_args(77, true),
            ["--elevated-relaunch", "--wait-pid=77", "--tray"]
        );
        // то, что отправляем, тем же разбором и читается
        let back = LaunchArgs::parse(relaunch_args(77, true));
        assert!(back.tray && back.elevated_relaunch);
        assert_eq!(back.wait_pid, Some(77));
    }

    #[test]
    fn waits_until_the_process_is_gone() {
        let polls = Cell::new(0u32);
        let slept = Cell::new(Duration::ZERO);
        let gone = wait_until_gone(
            9,
            Duration::from_secs(20),
            Duration::from_millis(100),
            |pid| {
                assert_eq!(pid, 9);
                polls.set(polls.get() + 1);
                polls.get() <= 3 // жив на трёх опросах
            },
            |d| slept.set(slept.get() + d),
        );
        assert!(gone);
        assert_eq!(polls.get(), 4);
        assert_eq!(slept.get(), Duration::from_millis(300));
    }

    #[test]
    fn returns_immediately_when_the_process_is_already_gone() {
        let slept = Cell::new(false);
        assert!(wait_until_gone(
            1,
            Duration::from_secs(20),
            Duration::from_millis(100),
            |_| false,
            |_| slept.set(true),
        ));
        assert!(!slept.get());
    }

    #[test]
    fn gives_up_after_the_timeout() {
        let slept = Cell::new(Duration::ZERO);
        let gone = wait_until_gone(
            1,
            Duration::from_secs(2),
            Duration::from_millis(100),
            |_| true,
            |d| slept.set(slept.get() + d),
        );
        assert!(!gone);
        assert_eq!(slept.get(), Duration::from_secs(2), "ждали ровно timeout");
    }

    #[test]
    fn the_current_process_is_alive_and_a_spent_one_is_not() {
        assert!(process_alive(std::process::id()));
        // Завершённый дочерний процесс: pid ещё не переиспользован за миллисекунды.
        #[cfg(windows)]
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/C", "exit", "0"])
            .spawn()
            .expect("cmd.exe запускается");
        #[cfg(unix)]
        let mut child = std::process::Command::new("true")
            .spawn()
            .expect("true запускается");
        #[cfg(any(windows, unix))]
        {
            let pid = child.id();
            child.wait().expect("дочерний процесс завершился");
            assert!(wait_until_gone(
                pid,
                Duration::from_secs(5),
                Duration::from_millis(50),
                process_alive,
                std::thread::sleep,
            ));
        }
    }
}
