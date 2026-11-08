// SPDX-License-Identifier: GPL-3.0-only

//! Мок процесса ядра для юнит-тестов FSM и цикла надзирателя.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::teardown::{ProbeOutcome, StaleResource, TeardownReport};
use super::{CoreEndpoint, CoreProcess, CoreProcessError, CoreSpawnConfig};

/// transport-url endpoint'а мока по умолчанию (`MockCoreProcess`).
pub(super) const MOCK_ENDPOINT_URL: &str = "unix:///mock/lavray-core";

/// Запись вызова `spawn` БЕЗ токенов: мок не копирует секреты и не требует
/// `Clone` от [`CoreSpawnConfig`]/[`super::SecretToken`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnCall {
    pub binary: PathBuf,
    pub listen_socket: PathBuf,
    pub data_dir: PathBuf,
    pub extra_args: Vec<String>,
}

/// Мок процесса ядра: сценарии результатов + запись вызовов (для юнит-тестов).
///
/// Очереди `*_results` — честный FIFO (первым потребляется первый элемент);
/// пустая очередь отдаёт успех, а `wait_ready` при пустой `ready_results`
/// возвращает `default_ready_endpoint` (у [`MockCoreProcess::always_ok`] —
/// его endpoint на ВСЕ вызовы, не только на первый).
#[derive(Debug)]
pub struct MockCoreProcess {
    /// Очередь результатов `spawn` в порядке вызовов (FIFO; пусто — успех).
    pub spawn_results: Vec<Result<(), CoreProcessError>>,
    /// Очередь результатов `wait_ready` в порядке вызовов (FIFO; пусто —
    /// успех с `default_ready_endpoint`).
    pub ready_results: Vec<Result<CoreEndpoint, CoreProcessError>>,
    /// Очередь результатов `kill` в порядке вызовов (FIFO; пусто — успех).
    pub kill_results: Vec<Result<(), CoreProcessError>>,
    /// Endpoint для `wait_ready`, когда `ready_results` пуст.
    pub default_ready_endpoint: CoreEndpoint,
    /// Очередь ответов `is_alive` (FIFO); когда пуста, процесс считается живым.
    pub alive_results: Vec<bool>,
    /// Строки «кольца логов» для `log_lines`.
    pub log_lines: Vec<String>,
    /// Все вызовы `spawn` (без токенов).
    pub spawn_calls: Vec<SpawnCall>,
    /// Бюджеты всех вызовов `wait_ready`.
    pub ready_calls: Vec<Duration>,
    /// Дедлайны всех вызовов `kill`.
    pub kill_calls: Vec<Duration>,
    /// Флаг отмены (как у `SupervisorHandle`): тест ставит его сам.
    pub cancel: Arc<AtomicBool>,
    /// Поставить `cancel` внутри `wait_ready` (Stop выиграл гонку у READY).
    pub cancel_during_ready: bool,
    /// Ответ `verify_teardown`; `None` — все пять проб `Clean`.
    pub teardown_report: Option<TeardownReport>,
    /// Сколько раз вызвана `verify_teardown`.
    pub teardown_calls: usize,
}

impl Default for MockCoreProcess {
    fn default() -> Self {
        Self {
            spawn_results: Vec::new(),
            ready_results: Vec::new(),
            kill_results: Vec::new(),
            default_ready_endpoint: CoreEndpoint {
                transport_url: MOCK_ENDPOINT_URL.to_owned(),
            },
            alive_results: Vec::new(),
            log_lines: Vec::new(),
            spawn_calls: Vec::new(),
            ready_calls: Vec::new(),
            kill_calls: Vec::new(),
            cancel: Arc::new(AtomicBool::new(false)),
            cancel_during_ready: false,
            teardown_report: None,
            teardown_calls: 0,
        }
    }
}

impl MockCoreProcess {
    /// Мок, у которого всё успешно; КАЖДЫЙ `wait_ready` возвращает endpoint
    /// с данным `transport_url`.
    pub fn always_ok(transport_url: &str) -> Self {
        Self {
            default_ready_endpoint: CoreEndpoint {
                transport_url: transport_url.to_owned(),
            },
            ..Self::default()
        }
    }
}

impl CoreProcess for MockCoreProcess {
    fn spawn(&mut self, config: &CoreSpawnConfig) -> Result<(), CoreProcessError> {
        self.spawn_calls.push(SpawnCall {
            binary: config.binary.clone(),
            listen_socket: config.listen_socket.clone(),
            data_dir: config.data_dir.clone(),
            extra_args: config.extra_args.clone(),
        });
        pop_front_or_ok(&mut self.spawn_results)
    }

    fn wait_ready(&mut self, budget: Duration) -> Result<CoreEndpoint, CoreProcessError> {
        self.ready_calls.push(budget);
        if self.cancel_during_ready {
            self.cancel.store(true, Ordering::SeqCst);
        }
        // FIFO-очередь сценариев; пустая — успех с endpoint'ом мока
        // (`default_ready_endpoint`, у `always_ok` — его transport_url).
        if self.ready_results.is_empty() {
            Ok(self.default_ready_endpoint.clone())
        } else {
            self.ready_results.remove(0)
        }
    }

    fn kill(&mut self, graceful_deadline: Duration) -> Result<(), CoreProcessError> {
        self.kill_calls.push(graceful_deadline);
        pop_front_or_ok(&mut self.kill_results)
    }

    fn is_alive(&mut self) -> bool {
        self.alive_results.is_empty() || self.alive_results.remove(0)
    }

    fn log_lines(&self, n: usize) -> Vec<String> {
        self.log_lines[self.log_lines.len().saturating_sub(n)..].to_vec()
    }

    fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    fn verify_teardown(&mut self) -> TeardownReport {
        self.teardown_calls += 1;
        self.teardown_report.clone().unwrap_or_else(|| {
            TeardownReport::from_findings(
                StaleResource::ALL
                    .iter()
                    .map(|&resource| (resource, ProbeOutcome::Clean))
                    .collect(),
            )
        })
    }
}

/// Достать СЛЕДУЮЩИЙ по порядку запланированный результат (FIFO,
/// `remove(0)`); пустая очередь — успех по умолчанию.
fn pop_front_or_ok(queue: &mut Vec<Result<(), CoreProcessError>>) -> Result<(), CoreProcessError> {
    if queue.is_empty() {
        Ok(())
    } else {
        queue.remove(0)
    }
}
