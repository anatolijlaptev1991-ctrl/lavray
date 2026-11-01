// SPDX-License-Identifier: GPL-3.0-only

//! Аргументы режима `--update-watchdog`: копия старого exe, запущенная
//! приложением сразу после установщика. Формат `--ключ=значение`, как у
//! остальных аргументов оболочки (`--wait-pid=`); значения со пробелами
//! безопасны: процесс создаётся списком аргументов, не строкой.

use std::path::PathBuf;

/// Признак режима watchdog.
pub const ARG_UPDATE_WATCHDOG: &str = "--update-watchdog";
const ARG_INSTALLER_PID: &str = "--installer-pid";
const ARG_DATA_DIR: &str = "--data-dir";
const ARG_APP_EXE: &str = "--app-exe";
const ARG_VERSION: &str = "--version";
/// Самая длинная допустимая версия (`0.5.1-rc.1+build` с большим запасом).
const MAX_VERSION: usize = 64;

/// Что нужно watchdog, чтобы довести обновление до конца.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchdogArgs {
    /// pid запущенного установщика: его выхода ждём.
    pub installer_pid: u32,
    /// Каталог данных (там `updates/health.json`, `previous/`).
    pub data_dir: PathBuf,
    /// Exe приложения, которое нужно запустить после установки.
    pub app_exe: PathBuf,
    /// Версия, чей heartbeat ожидается.
    pub version: String,
}

/// Среди аргументов есть `--update-watchdog`.
pub fn requested<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|a| a.as_ref() == ARG_UPDATE_WATCHDOG)
}

/// Версия годится для передачи watchdog: непустая, короткая, без пробелов.
pub fn version_ok(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= MAX_VERSION
        && !version.chars().any(|c| c.is_control() || c.is_whitespace())
}

impl WatchdogArgs {
    /// Аргументы командной строки (без имени программы).
    pub fn to_cli(&self) -> Vec<String> {
        vec![
            ARG_UPDATE_WATCHDOG.to_string(),
            format!("{ARG_INSTALLER_PID}={}", self.installer_pid),
            format!("{ARG_DATA_DIR}={}", self.data_dir.display()),
            format!("{ARG_APP_EXE}={}", self.app_exe.display()),
            format!("{ARG_VERSION}={}", self.version),
        ]
    }

    /// Разбор; `None` — режима нет или не хватает обязательного поля.
    pub fn parse<I, S>(args: I) -> Option<Self>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let (mut flag, mut pid, mut data, mut exe, mut version) = (false, None, None, None, None);
        for arg in args {
            let arg = arg.as_ref();
            if arg == ARG_UPDATE_WATCHDOG {
                flag = true;
            } else if let Some((key, value)) = arg.split_once('=') {
                match key {
                    ARG_INSTALLER_PID => pid = value.parse::<u32>().ok().filter(|p| *p != 0),
                    ARG_DATA_DIR => data = (!value.is_empty()).then(|| PathBuf::from(value)),
                    ARG_APP_EXE => exe = (!value.is_empty()).then(|| PathBuf::from(value)),
                    ARG_VERSION => version = Some(value.to_string()).filter(|v| version_ok(v)),
                    _ => {}
                }
            }
        }
        Some(Self {
            installer_pid: pid.filter(|_| flag)?,
            data_dir: data?,
            app_exe: exe?,
            version: version?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> WatchdogArgs {
        WatchdogArgs {
            installer_pid: 4321,
            data_dir: PathBuf::from("C:\\Users\\Анатолий Л\\AppData\\Roaming\\LAVRay"),
            app_exe: PathBuf::from("C:\\Program Files\\LAVRay\\LAVRay.exe"),
            version: "0.5.1-rc.1".to_string(),
        }
    }

    #[test]
    fn the_command_line_round_trips_with_spaces_and_unicode() {
        let cli = sample().to_cli();
        assert!(requested(&cli));
        assert_eq!(WatchdogArgs::parse(&cli), Some(sample()));
    }

    #[test]
    fn a_value_may_contain_an_equals_sign() {
        let mut args = sample();
        args.data_dir = PathBuf::from("D:\\a=b\\LAVRay");
        assert_eq!(WatchdogArgs::parse(args.to_cli()), Some(args));
    }

    #[test]
    fn without_the_flag_there_is_no_watchdog() {
        let cli: Vec<String> = sample().to_cli().into_iter().skip(1).collect();
        assert!(!requested(&cli));
        assert_eq!(WatchdogArgs::parse(&cli), None);
        assert!(!requested(["--tray"]));
    }

    #[test]
    fn a_missing_or_invalid_field_makes_the_arguments_unusable() {
        for drop in 1..5 {
            let cli: Vec<String> = sample()
                .to_cli()
                .into_iter()
                .enumerate()
                .filter(|(i, _)| *i != drop)
                .map(|(_, a)| a)
                .collect();
            assert_eq!(WatchdogArgs::parse(&cli), None, "без поля {drop}");
        }
        for bad in [
            "--installer-pid=0",
            "--installer-pid=x",
            "--version=1 2",
            "--version=",
        ] {
            let mut cli = sample().to_cli();
            cli.push(bad.to_string());
            assert_eq!(WatchdogArgs::parse(&cli), None, "{bad}");
        }
    }

    #[test]
    fn unknown_arguments_are_ignored() {
        let mut cli = sample().to_cli();
        cli.push("--tray".to_string());
        cli.push("--what=ever".to_string());
        assert_eq!(WatchdogArgs::parse(&cli), Some(sample()));
    }
}
