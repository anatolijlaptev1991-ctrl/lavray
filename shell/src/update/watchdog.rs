// SPDX-License-Identifier: GPL-3.0-only

//! Режим `--update-watchdog` (T-75): копия старого exe ждёт выхода установщика,
//! запускает новую версию БЕЗ повышения прав, ждёт её heartbeat
//! [`crate::updater::HEARTBEAT_GRACE`] и, если отметки нет, откатывает прошлым установщиком.
//! Решение «ждать / здорово / откатывать» — чистая функция [`decide`]; всё, что
//! касается ОС, стоит за трейтами и в тестах подменяется.

use super::clock::Clock;
use super::heartbeat::{evaluate, Health, HealthSource, HealthVerdict};
use super::watchdog_args::WatchdogArgs;
use std::path::Path;
use std::time::Duration;

/// Как часто watchdog читает `health.json`.
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);
/// Сколько ждать завершения установщика (NSIS ставит десятки секунд).
pub const INSTALLER_WAIT: Duration = Duration::from_mins(10);

/// Решение на момент `now`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Отметки ещё нет, grace-период идёт.
    Wait,
    /// Новая версия отметилась.
    Healthy,
    /// Отметки нет и `HEARTBEAT_GRACE` вышел.
    Rollback,
}

/// Решить по отметке: `started_ms` — когда запущена новая версия, `now_ms` —
/// сейчас (оба в миллисекундах Unix). Ровно 60 с — уже откат, 59,9 с — ждём.
#[must_use]
pub fn decide(now_ms: u64, started_ms: u64, health: Option<&Health>, expected: &str) -> Decision {
    match evaluate(health, expected, started_ms, now_ms) {
        HealthVerdict::Ok => Decision::Healthy,
        HealthVerdict::Pending => Decision::Wait,
        HealthVerdict::Missing => Decision::Rollback,
    }
}

/// Чем кончилось ожидание процесса.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitResult {
    /// Процесс вышел; код, если его удалось узнать.
    Exited(Option<u32>),
    /// Не вышел за отведённое время.
    TimedOut,
}

/// Ожидание выхода процесса по pid.
pub trait InstallerWaiter {
    fn wait_exit(&self, pid: u32, timeout: Duration) -> WaitResult;
}

/// Запуск приложения без повышения прав (на Windows — через Проводник).
pub trait Launcher {
    fn launch_non_elevated(&self, exe: &Path) -> Result<(), String>;
}

/// Итог попытки отката.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RollbackResult {
    /// Прошлый установщик запущен; его pid.
    Started(u32),
    /// Прошлого установщика нет.
    Unavailable,
    /// Отказ в UAC.
    UacCancelled,
    /// Не удалось (код ошибки).
    Failed(String),
}

/// Откат прошлым установщиком (см. `rollback.rs`).
pub trait RollbackStep {
    fn run(&self) -> RollbackResult;
}

/// Всё, что нужно циклу watchdog.
pub struct WatchdogDeps<'a> {
    pub waiter: &'a dyn InstallerWaiter,
    pub launcher: &'a dyn Launcher,
    pub clock: &'a dyn Clock,
    pub health: &'a dyn HealthSource,
    pub rollback: &'a dyn RollbackStep,
}

/// Чем кончил работу watchdog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Healthy,
    RolledBack,
    RollbackUnavailable,
    RollbackCancelled,
    RollbackFailed(String),
    InstallerFailed(u32),
    InstallerTimeout,
    LaunchFailed(String),
}

impl Outcome {
    /// Короткое имя для `last-update.json`.
    #[must_use]
    pub fn name(&self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::RolledBack => "rolled_back",
            Self::RollbackUnavailable => "rollback_unavailable",
            Self::RollbackCancelled => "rollback_cancelled",
            Self::RollbackFailed(_) => "rollback_failed",
            Self::InstallerFailed(_) => "installer_failed",
            Self::InstallerTimeout => "installer_timeout",
            Self::LaunchFailed(_) => "launch_failed",
        }
    }
}

/// Довести обновление до конца: дождаться установщика, запустить приложение,
/// следить за heartbeat, при необходимости откатить.
#[must_use]
pub fn run(args: &WatchdogArgs, deps: &WatchdogDeps<'_>) -> Outcome {
    match deps.waiter.wait_exit(args.installer_pid, INSTALLER_WAIT) {
        WaitResult::TimedOut => return Outcome::InstallerTimeout,
        WaitResult::Exited(Some(code)) if code != 0 => {
            // установка не удалась: прежняя версия, если она цела, запускается
            let _ = deps.launcher.launch_non_elevated(&args.app_exe);
            return Outcome::InstallerFailed(code);
        }
        WaitResult::Exited(_) => {}
    }
    if let Err(reason) = deps.launcher.launch_non_elevated(&args.app_exe) {
        return Outcome::LaunchFailed(reason);
    }
    let started = deps.clock.now_ms();
    loop {
        let health = deps.health.read();
        match decide(deps.clock.now_ms(), started, health.as_ref(), &args.version) {
            Decision::Wait => deps.clock.sleep(POLL_INTERVAL),
            Decision::Healthy => return Outcome::Healthy,
            Decision::Rollback => return roll_back(args, deps),
        }
    }
}

/// Откат: прошлый установщик, затем снова запустить приложение.
fn roll_back(args: &WatchdogArgs, deps: &WatchdogDeps<'_>) -> Outcome {
    match deps.rollback.run() {
        RollbackResult::Started(pid) => {
            let _ = deps.waiter.wait_exit(pid, INSTALLER_WAIT);
            match deps.launcher.launch_non_elevated(&args.app_exe) {
                Ok(()) => Outcome::RolledBack,
                Err(reason) => Outcome::LaunchFailed(reason),
            }
        }
        RollbackResult::Unavailable => Outcome::RollbackUnavailable,
        RollbackResult::UacCancelled => Outcome::RollbackCancelled,
        RollbackResult::Failed(code) => Outcome::RollbackFailed(code),
    }
}

#[cfg(test)]
mod tests;
