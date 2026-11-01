// SPDX-License-Identifier: GPL-3.0-only

//! Настоящие реализации трейтов обновления, не привязанные к Tauri: UAC,
//! ожидание процесса, запуск без повышения, копия exe для watchdog. Тесты
//! подменяют их подставками; здесь нет логики, только вызовы ОС.

use super::layout::Layout;
use super::prepare::{WatchdogCopy, WatchdogLauncher};
use super::verify::{LockedOpener, RealOpener};
use super::watchdog::Launcher;
use super::watchdog_args::WatchdogArgs;
use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(windows)]
pub use super::proc_win::ProcessWaiter;
#[cfg(windows)]
pub use super::runas_win::Runas;
#[cfg(not(windows))]
pub use portable::{ProcessWaiter, Runas};

/// Вне Windows повышенного запуска нет, а pid ждём опросом без кода возврата.
#[cfg(not(windows))]
mod portable {
    use crate::launch::{process_alive, wait_until_gone, WAIT_PID_POLL};
    use crate::update::install::{ElevateError, ElevatedHandle, Elevator};
    use crate::update::watchdog::{InstallerWaiter, WaitResult};
    use std::path::Path;
    use std::time::Duration;

    pub struct Runas;

    impl Elevator for Runas {
        fn run_elevated(&self, _: &Path, _: &[&str]) -> Result<ElevatedHandle, ElevateError> {
            Err(ElevateError::Failed("unsupported".to_string()))
        }
    }

    pub struct ProcessWaiter;

    impl InstallerWaiter for ProcessWaiter {
        fn wait_exit(&self, pid: u32, timeout: Duration) -> WaitResult {
            let poll = WAIT_PID_POLL;
            if wait_until_gone(pid, timeout, poll, process_alive, std::thread::sleep) {
                WaitResult::Exited(None)
            } else {
                WaitResult::TimedOut
            }
        }
    }
}

/// Запуск приложения без повышения: на Windows — через Проводник, который
/// работает с правами пользователя (процесс, запущенный от администратора,
/// сам запустил бы приложение повышенным).
pub struct ShellLauncher;

impl Launcher for ShellLauncher {
    fn launch_non_elevated(&self, exe: &Path) -> Result<(), String> {
        let mut command = non_elevated_command(exe);
        command.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
fn non_elevated_command(exe: &Path) -> std::process::Command {
    // Проводник из системной папки, а не из PATH
    let root =
        std::env::var_os("SystemRoot").map_or_else(|| PathBuf::from("C:\\Windows"), PathBuf::from);
    let mut command = std::process::Command::new(root.join("explorer.exe"));
    command.arg(exe);
    command
}

#[cfg(not(windows))]
fn non_elevated_command(exe: &Path) -> std::process::Command {
    std::process::Command::new(exe)
}

/// Не показывать окно консоли и не привязывать процесс к консоли родителя.
#[cfg(windows)]
const DETACHED_FLAGS: u32 = 0x0800_0000 | 0x0000_0008 | 0x0000_0200;

/// Копия exe для watchdog в `<data>/updates/watchdog` и её запуск.
pub struct CopyWatchdog {
    pub layout: Layout,
    pub app_exe: PathBuf,
}

impl CopyWatchdog {
    /// Убрать копии прошлых обновлений (работающие удалить не удастся — не страшно).
    fn clear_old(dir: &Path) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

impl WatchdogLauncher for CopyWatchdog {
    fn stage_copy(&self) -> io::Result<WatchdogCopy> {
        let dir = self.layout.watchdog_dir();
        std::fs::create_dir_all(&dir)?;
        Self::clear_old(&dir);
        let path = dir.join(format!("lavray-watchdog-{}.exe", std::process::id()));
        let mut source = std::fs::File::open(&self.app_exe)?;
        let mut target = std::fs::File::create(&path)?;
        io::copy(&mut source, &mut target)?;
        target.sync_all()?;
        drop(target);
        // запрет записи до запуска: копию, которую исполнит, не подменить
        let hold = RealOpener::any().open_locked(&path)?;
        Ok(WatchdogCopy { path, hold })
    }

    fn spawn(&self, copy: &WatchdogCopy, installer_pid: u32, version: &str) -> io::Result<()> {
        let args = WatchdogArgs {
            installer_pid,
            data_dir: self.layout.data_dir().to_path_buf(),
            app_exe: self.app_exe.clone(),
            version: version.to_string(),
        };
        let mut command = std::process::Command::new(&copy.path);
        command
            .args(args.to_cli())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(DETACHED_FLAGS);
        }
        command.spawn().map(|_| ())
    }
}

/// Настоящий запуск: процесс без окна консоли, с ожиданием не дольше [`super::core_verify::VERIFY_TIMEOUT`].
pub struct ProcessRunner;

impl super::core_verify::CoreRunner for ProcessRunner {
    fn run(&self, exe: &Path, args: &[OsString]) -> io::Result<super::core_verify::RunOutput> {
        use std::process::{Command, Stdio};
        let mut command = Command::new(exe);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn()?;
        let deadline = std::time::Instant::now() + super::core_verify::VERIFY_TIMEOUT;
        loop {
            if child.try_wait()?.is_some() {
                break;
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Err(io::Error::from(io::ErrorKind::TimedOut));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let output = child.wait_with_output()?;
        Ok(super::core_verify::RunOutput {
            success: output.status.success(),
            stdout: output.stdout,
        })
    }
}
