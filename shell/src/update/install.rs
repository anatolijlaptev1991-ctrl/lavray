// SPDX-License-Identifier: GPL-3.0-only

//! Запуск установщика с повышением (T-75). NSIS-установщик Tauri ставится в
//! режиме per-machine: нужен UAC, один запрос на запуск. Настоящий запуск —
//! `ShellExecuteExW("runas")` в `runas_win.rs`; здесь только трейт, аргументы
//! и разбор исхода, чтобы порядок шагов проверялся подставкой.

use std::path::Path;

/// Тихая установка NSIS.
pub const SILENT_ARG: &str = "/S";

/// Почему повышенный запуск не состоялся.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ElevateError {
    /// Пользователь отказал в UAC (`ERROR_CANCELLED`, 1223): не ошибка.
    UacCancelled,
    /// Прочий сбой, текст — от ОС.
    Failed(String),
}

/// Запущенный повышенный процесс.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ElevatedHandle {
    /// pid установщика: по нему watchdog дожидается его выхода.
    pub pid: u32,
}

/// Запуск программы с повышением и возвратом pid. В продакшене — `Runas`
/// (`runas_win.rs`), в тестах — подставка: настоящий UAC на машине владельца
/// вызывать нельзя.
pub trait Elevator {
    fn run_elevated(&self, exe: &Path, args: &[&str]) -> Result<ElevatedHandle, ElevateError>;
}

/// Запустить установщик тихо.
pub fn launch_installer(
    elevator: &dyn Elevator,
    installer: &Path,
) -> Result<ElevatedHandle, ElevateError> {
    elevator.run_elevated(installer, &[SILENT_ARG])
}

/// Один аргумент командной строки Windows: в кавычки, если есть пробел или
/// кавычка; обратные слэши перед кавычкой удваиваются (правила `CommandLineToArgvW`).
fn quote(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_string();
    }
    let mut out = String::from('"');
    let mut slashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => slashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            other => {
                out.push_str(&"\\".repeat(slashes));
                out.push(other);
                slashes = 0;
            }
        }
    }
    out.push_str(&"\\".repeat(slashes * 2));
    out.push('"');
    out
}

/// Строка параметров для `ShellExecuteExW`.
pub fn join_args(args: &[&str]) -> String {
    args.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;

    struct Recorder(RefCell<Vec<(PathBuf, Vec<String>)>>);

    impl Elevator for Recorder {
        fn run_elevated(&self, exe: &Path, args: &[&str]) -> Result<ElevatedHandle, ElevateError> {
            let args = args.iter().map(ToString::to_string).collect();
            self.0.borrow_mut().push((exe.to_path_buf(), args));
            Ok(ElevatedHandle { pid: 4242 })
        }
    }

    #[test]
    fn the_installer_is_started_silently_and_its_pid_returned() {
        let rec = Recorder(RefCell::default());
        let exe = PathBuf::from("setup.exe");
        let handle = launch_installer(&rec, &exe).unwrap();
        assert_eq!(handle.pid, 4242);
        assert_eq!(rec.0.borrow().as_slice(), [(exe, vec!["/S".to_string()])]);
    }

    #[test]
    fn arguments_are_quoted_for_the_windows_command_line() {
        assert_eq!(join_args(&["/S"]), "/S");
        assert_eq!(join_args(&["/S", "/D=C:\\x"]), "/S /D=C:\\x");
        assert_eq!(join_args(&["a b"]), "\"a b\"");
        assert_eq!(join_args(&["say \"hi\""]), "\"say \\\"hi\\\"\"");
        assert_eq!(join_args(&["C:\\my dir\\"]), "\"C:\\my dir\\\\\"");
        assert_eq!(join_args(&[""]), "\"\"");
        assert_eq!(join_args(&[]), "");
    }
}
