// SPDX-License-Identifier: GPL-3.0-only

//! Однократное автоподключение при старте: флаг `--connect-last` ядра
//! (`lavray-core serve`) передаётся ТОЛЬКО при первом запуске ядра за жизнь
//! процесса оболочки. Перезапуск после краха и ручной перезапуск ядра его не
//! получают: иначе отключённый пользователем VPN поднимался бы сам. Не
//! передаётся и после `--elevated-relaunch`: подключение там продолжает UI,
//! запомнив намерение до перезапуска.
//!
//! Токены и прочие параметры не меняются: к стандартному argv
//! ([`spawn_args`](super::driver::spawn_args)) просто дописывается флаг.

use super::driver::spawn_args;
use super::CoreSpawnConfig;
use crate::launch::LaunchArgs;
use std::sync::atomic::{AtomicBool, Ordering};

/// Флаг ядра.
pub const ARG_CONNECT_LAST: &str = "--connect-last";

/// Первый запуск ядра в этом процессе ещё не состоялся.
static FIRST_SPAWN: AtomicBool = AtomicBool::new(true);

/// Дописать `--connect-last` к конфигурации запуска, если это первый запуск
/// ядра процесса и оболочка не запущена с `--elevated-relaunch`. Вызывается из
/// фабрики конфигурации надзирателя на каждый (пере)запуск.
pub fn apply(config: CoreSpawnConfig) -> CoreSpawnConfig {
    apply_with(
        config,
        &FIRST_SPAWN,
        LaunchArgs::from_env().elevated_relaunch,
    )
}

/// То же с явными зависимостями (для тестов).
pub(crate) fn apply_with(
    mut config: CoreSpawnConfig,
    first_spawn: &AtomicBool,
    elevated_relaunch: bool,
) -> CoreSpawnConfig {
    // Первый запуск «расходуется» даже при повышенном перезапуске: следующие
    // запуски ядра (после краха) подключения всё равно не получают.
    let first = first_spawn.swap(false, Ordering::SeqCst);
    if first && !elevated_relaunch && config.extra_args.is_empty() {
        let mut args = spawn_args(&config);
        args.push(ARG_CONNECT_LAST.to_owned());
        config.extra_args = args;
    }
    config
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coreproc::SecretToken;
    use std::path::PathBuf;

    fn config() -> CoreSpawnConfig {
        CoreSpawnConfig {
            binary: PathBuf::from("lavray-core"),
            listen_socket: PathBuf::from("127.0.0.1:0"),
            data_dir: PathBuf::from("data-dir"),
            auth_token: SecretToken::from_base64url("A".repeat(43)).unwrap(),
            agent_token: None,
            extra_args: vec![],
        }
    }

    fn has_flag(config: &CoreSpawnConfig) -> bool {
        spawn_args(config).iter().any(|a| a == ARG_CONNECT_LAST)
    }

    /// Только первый запуск ядра за жизнь процесса получает флаг; перезапуск
    /// после краха и ручной перезапуск (новый вызов фабрики) — нет.
    #[test]
    fn only_the_first_spawn_gets_the_flag() {
        let first = AtomicBool::new(true);
        let a = apply_with(config(), &first, false);
        assert!(has_flag(&a), "{:?}", spawn_args(&a));
        assert_eq!(
            spawn_args(&a),
            [
                "serve",
                "--listen-socket",
                "127.0.0.1:0",
                "--data",
                "data-dir",
                "--connect-last"
            ]
        );
        for _ in 0..3 {
            let again = apply_with(config(), &first, false);
            assert!(!has_flag(&again));
            assert_eq!(spawn_args(&again), spawn_args(&config()));
        }
    }

    /// После `--elevated-relaunch` подключение продолжает UI: флага нет ни в
    /// первом, ни в последующих запусках.
    #[test]
    fn an_elevated_relaunch_never_gets_the_flag() {
        let first = AtomicBool::new(true);
        assert!(!has_flag(&apply_with(config(), &first, true)));
        assert!(!has_flag(&apply_with(config(), &first, false)));
    }

    /// Фейк-ядра тестов (свой argv) флаг не получают, а токены в argv не уходят.
    #[test]
    fn custom_argv_is_left_alone() {
        let mut custom = config();
        custom.extra_args = vec!["-c".to_owned()];
        let out = apply_with(custom, &AtomicBool::new(true), false);
        assert_eq!(out.extra_args, ["-c"]);
        let joined = spawn_args(&apply_with(config(), &AtomicBool::new(true), false)).join(" ");
        assert!(!joined.contains(&"A".repeat(43)));
    }
}
