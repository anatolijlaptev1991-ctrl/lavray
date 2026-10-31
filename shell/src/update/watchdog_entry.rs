// SPDX-License-Identifier: GPL-3.0-only

//! Вход режима `--update-watchdog` (T-75). `main.rs` вызывает
//! [`run_if_requested`] первой строкой: в режиме watchdog окно, ядро и плагины
//! не создаются, процесс только доводит обновление до конца и выходит.

use super::clock::{Clock, SystemClock};
use super::heartbeat::HealthStore;
use super::layout::Layout;
use super::paths::RealFs;
use super::previous::PreviousStore;
use super::real::{ProcessWaiter, Runas, ShellLauncher};
use super::rollback::PreviousRollback;
use super::verify::RealOpener;
use super::watchdog::{run, Outcome, WatchdogDeps};
use super::watchdog_args::{requested, WatchdogArgs};
use crate::files::io::write_atomic;
use serde_json::json;

/// Код выхода при неразобранных аргументах.
const EXIT_BAD_ARGS: i32 = 2;

/// Если процесс запущен как watchdog — выполнить и выйти; иначе вернуться.
pub fn run_if_requested() {
    let argv: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    if !requested(&argv) {
        return;
    }
    let code = WatchdogArgs::parse(&argv).map_or(EXIT_BAD_ARGS, |args| exit_code(&watch(&args)));
    std::process::exit(code);
}

/// Настоящие зависимости и запись итога.
fn watch(args: &WatchdogArgs) -> Outcome {
    let layout = Layout::new(&args.data_dir);
    let store = PreviousStore::new(layout.clone());
    let rollback = PreviousRollback {
        layout: &layout,
        store: &store,
        fs: &RealFs,
        opener: &RealOpener,
        elevator: &Runas,
    };
    let health = HealthStore::new(&layout);
    let deps = WatchdogDeps {
        waiter: &ProcessWaiter,
        launcher: &ShellLauncher,
        clock: &SystemClock,
        health: &health,
        rollback: &rollback,
    };
    let outcome = run(args, &deps);
    let report = result_json(&args.version, &outcome, SystemClock.now_ms());
    if let Err(e) = write_atomic(&layout.result_file(), report.as_bytes()) {
        eprintln!("LAVRay: итог обновления не записан: {e}");
    }
    outcome
}

/// Код выхода: 0 — всё хорошо (здорово или откатились), иначе 1.
pub fn exit_code(outcome: &Outcome) -> i32 {
    i32::from(!matches!(outcome, Outcome::Healthy | Outcome::RolledBack))
}

/// `last-update.json`: чем кончилось обновление, чтобы показать в интерфейсе.
pub fn result_json(version: &str, outcome: &Outcome, now_ms: u64) -> String {
    let detail = match outcome {
        Outcome::RollbackFailed(text) | Outcome::LaunchFailed(text) => Some(text.clone()),
        Outcome::InstallerFailed(code) => Some(code.to_string()),
        _ => None,
    };
    json!({
        "version": version,
        "outcome": outcome.name(),
        "detail": detail,
        "at": now_ms,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_healthy_or_rolled_back_update_exits_with_zero() {
        assert_eq!(exit_code(&Outcome::Healthy), 0);
        assert_eq!(exit_code(&Outcome::RolledBack), 0);
        for bad in [
            Outcome::RollbackUnavailable,
            Outcome::RollbackCancelled,
            Outcome::RollbackFailed("x".into()),
            Outcome::InstallerFailed(1),
            Outcome::InstallerTimeout,
            Outcome::LaunchFailed("x".into()),
        ] {
            assert_eq!(exit_code(&bad), 1, "{bad:?}");
        }
    }

    #[test]
    fn the_result_file_names_the_outcome_and_its_detail() {
        let json: serde_json::Value =
            serde_json::from_str(&result_json("0.5.1", &Outcome::InstallerFailed(2), 99)).unwrap();
        assert_eq!(json["version"], "0.5.1");
        assert_eq!(json["outcome"], "installer_failed");
        assert_eq!(json["detail"], "2");
        assert_eq!(json["at"], 99);

        let healthy: serde_json::Value =
            serde_json::from_str(&result_json("0.5.1", &Outcome::Healthy, 1)).unwrap();
        assert!(healthy["detail"].is_null());
    }
}
