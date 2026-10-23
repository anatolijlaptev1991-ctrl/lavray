//! Конечный автомат (FSM) жизненного цикла Go-ядра `lavray-core`.
//!
//! Спек: `docs/stage3/shell-lifecycle.md` §2 (диаграмма, состояния, тайминги),
//! §3 (spawn/токен/ready-протокол), §5 (graceful shutdown), §6
//! (teardown-детекторы — [`teardown`]). Реальный запуск бинарника будет
//! через трейт [`CoreProcess`]; пока интеграция покрыта моком
//! [`MockCoreProcess`], поэтому каркас не зависит от Go-ядра.

pub mod backoff;
pub mod logs;
pub mod teardown;

use std::cell::RefCell;
use std::fmt;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Тайминги FSM (§2.2). `t_ready` — бюджет готовности ядра, > 5 с — warning.
pub const T_READY_BUDGET: Duration = Duration::from_secs(2);
/// Порог предупреждения готовности (TEST-PLAN §2: старт до готовности ≤ 1500 мс).
pub const T_READY_WARNING: Duration = Duration::from_secs(5);
/// Таймаут фазы Spawning: нет ready за 10 с → SpawnErr (§2.2).
pub const T_SPAWN: Duration = Duration::from_secs(10);
/// Таймаут `CoreService.Disconnect` (LNB-06).
pub const T_DISCONNECT_RPC: Duration = Duration::from_secs(10);
/// Ожидание выхода после SIGTERM/TerminateProcess по хэндлу/pgid (§5 шаг 3).
pub const T_SIGTERM_WAIT: Duration = Duration::from_secs(5);
/// Grace после SIGKILL/TerminateProcess(force) (§5 шаг 3).
pub const T_KILL_GRACE: Duration = Duration::from_secs(3);
/// Бюджет teardown-верификации сети (§6).
pub const T_TEARDOWN_VERIFY: Duration = Duration::from_secs(3);
/// Общий таймаут graceful-стопа (§2.2, Stopping).
pub const GRACEFUL_SHUTDOWN_TOTAL: Duration = Duration::from_secs(15);
/// Ретраев спавна ПОСЛЕ первой неудачной попытки до RateLimited
/// (§2.1–2.2: «spawn failed (3 ретрая, потом) rate-limited»,
/// «ретрай ×3» — суммарно [`SPAWN_ATTEMPTS_TOTAL`] попыток запуска).
pub const SPAWN_RETRIES: u32 = 3;
/// Суммарное число попыток запуска до RateLimited: первая + 3 ретрая (§2.2).
pub const SPAWN_ATTEMPTS_TOTAL: u32 = SPAWN_RETRIES + 1;
/// Rate-limit: ≥ 3 падения за окно 60 с (§2.2, Crashed).
pub const CRASH_RATE_LIMIT_COUNT: usize = 3;
/// Окно rate-limit рестартов (§2.2, Crashed).
pub const CRASH_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);
/// Стабильный аптайм, после которого эскалация backoff сбрасывается:
/// ядро, проживший это время без падений, считается здоровым, и следующий
/// крах начинается снова с шага 1 с (значение спеком не зафиксировано —
/// выбрано 300 с: на порядок больше окна rate-limit 60 с и всех шагов
/// backoff).
pub const BACKOFF_RESET_AFTER: Duration = Duration::from_secs(300);

/// Состояния FSM ядра (§2.2, все 9 состояний спека).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoreState {
    /// Процесса нет, сеть чиста (проверено).
    Idle,
    /// Процесс запущен, ждём ready-строку + `/healthz`.
    Spawning,
    /// Процесс мёртв → прогон teardown-проверки §6.
    SpawnErr,
    /// ConnectRPC жив, инстанс не активен.
    Ready,
    /// Инстанс активен (SystemProxy/TUN).
    Connected,
    /// Процесс мёртв не по команде.
    Crashed,
    /// Рестарты прекращены, ждём ручной «Перезапустить».
    RateLimited,
    /// Graceful-стоп §5, общий таймаут 15 с.
    Stopping,
    /// Мёртв по команде, сеть чиста.
    Stopped,
}

impl CoreState {
    /// Каноническое имя состояния (совпадает с serde-представлением).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Spawning => "spawning",
            Self::SpawnErr => "spawn_err",
            Self::Ready => "ready",
            Self::Connected => "connected",
            Self::Crashed => "crashed",
            Self::RateLimited => "rate_limited",
            Self::Stopping => "stopping",
            Self::Stopped => "stopped",
        }
    }
}

impl fmt::Display for CoreState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// События, управляющие FSM (входы автомата; источники — рантайм-слои).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CoreEvent {
    /// spawn() из Idle (§3).
    SpawnRequested,
    /// Ready-строка `LAVRAY_CORE_READY <url>` + `/healthz` 200 (§3.4).
    ReadyConfirmed,
    /// Таймаут t_spawn=10 с или ранний exit процесса.
    SpawnFailed,
    /// Backoff-рестарт тем же профилем (FR-UI-232).
    RetryScheduled,
    /// Ретраи исчерпаны / n ≥ N падений за окно T.
    RetryExhausted,
    /// Teardown-проверка §6 прошла (сеть чиста).
    TeardownVerified,
    /// Connect() ok — событие ядра (FR-UI-261).
    CoreConnected,
    /// Disconnect() ok.
    CoreDisconnected,
    /// Exit не по команде (крах).
    CoreExited,
    /// stop() graceful (§5).
    StopRequested,
    /// Ручной «Перезапустить» из RateLimited.
    ManualRestart,
    /// Stopped → Idle (сброс к исходному).
    Reset,
}

impl fmt::Display for CoreEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

/// Нелегальный переход FSM: ядро отказывается менять состояние.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("illegal core FSM transition: {from} + {event}")]
pub struct TransitionError {
    /// Состояние, из которого пытались уйти.
    pub from: CoreState,
    /// Событие, которое не применимо в этом состоянии.
    pub event: CoreEvent,
}

/// Таблица переходов FSM §2.1–2.2. Нелегальная пара → `Err`.
pub fn transition(from: CoreState, event: CoreEvent) -> Result<CoreState, TransitionError> {
    use CoreEvent as E;
    use CoreState as S;

    let next = match (from, event) {
        (S::Idle, E::SpawnRequested) => S::Spawning,
        (S::Spawning, E::ReadyConfirmed) => S::Ready,
        (S::Spawning, E::SpawnFailed) => S::SpawnErr,
        (S::Spawning, E::StopRequested) => S::Stopping,
        (S::SpawnErr, E::RetryScheduled) => S::Spawning,
        (S::SpawnErr, E::RetryExhausted) => S::RateLimited,
        (S::SpawnErr, E::TeardownVerified) => S::Idle,
        (S::Ready, E::CoreConnected) => S::Connected,
        (S::Ready, E::CoreExited) => S::Crashed,
        (S::Ready, E::StopRequested) => S::Stopping,
        (S::Connected, E::CoreDisconnected) => S::Stopping,
        (S::Connected, E::CoreExited) => S::Crashed,
        (S::Connected, E::StopRequested) => S::Stopping,
        (S::Crashed, E::RetryScheduled) => S::Spawning,
        (S::Crashed, E::RetryExhausted) => S::RateLimited,
        (S::RateLimited, E::ManualRestart) => S::Spawning,
        (S::Stopping, E::TeardownVerified) => S::Stopped,
        (S::Stopped, E::Reset) => S::Idle,
        _ => return Err(TransitionError { from, event }),
    };
    Ok(next)
}

/// Адрес транспорта ядра из ready-строки `LAVRAY_CORE_READY <transport-url>`
/// (§3.4): UDS-путь или `127.0.0.1:<port>` в веб-режиме.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreEndpoint {
    /// transport-url, выделенный ОС порт/сокет (`--port 0`, fix TOCTOU LNB-20).
    pub transport_url: String,
}

/// Длина auth-токена ядра в байтах (§3.2: 32 байта CSPRNG).
pub const AUTH_TOKEN_BYTES: usize = 32;
/// Длина base64url-представления 32 байт без padding (§3.2).
pub const AUTH_TOKEN_B64_LEN: usize = 43;

/// Некорректный auth-токен: не [`AUTH_TOKEN_B64_LEN`] символов base64url.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("invalid auth token: expected 43 base64url chars, got {0}")]
pub struct InvalidAuthToken(
    /// Фактическая длина полученной строки.
    pub usize,
);

/// Секретный auth-токен ядра (§3.2): 32 байта CSPRNG → base64url, 43 символа
/// без padding.
///
/// Обёртка без внешних зависимостей: [`fmt::Debug`] и [`fmt::Display`]
/// печатают только плейсхолдер — токен НИКОГДА не попадает в argv (ps), env,
/// логи и события (fix mt19937, LNB-18). Контракт передачи: драйвер процесса
/// пишет значение (через [`SecretToken::expose`]) в **stdin** ядра + `\n` и
/// держит stdin открытым (закрытие = смерть родителя — страховка).
///
/// Генерация (32 байта CSPRNG → base64url) выполняется в рантайм-драйвере
/// при врезке реального spawn'а; здесь — валидирующий конструктор и
/// редактирующее хранение.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretToken(String);

impl SecretToken {
    /// Из base64url-строки: ровно [`AUTH_TOKEN_B64_LEN`] символов
    /// `[A-Za-z0-9_-]` (32 байта без padding). Иное — [`InvalidAuthToken`].
    pub fn from_base64url(value: impl Into<String>) -> Result<Self, InvalidAuthToken> {
        let value = value.into();
        let charset_ok = value
            .bytes()
            .all(|b| matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_'));
        if value.len() == AUTH_TOKEN_B64_LEN && charset_ok {
            Ok(Self(value))
        } else {
            Err(InvalidAuthToken(value.len()))
        }
    }

    /// Значение токена — ТОЛЬКО для записи в stdin ядра (§3.2); не для
    /// логирования/событий/argv.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretToken([REDACTED])")
    }
}

impl fmt::Display for SecretToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}

/// Параметры запуска ядра (§3): binary, `--listen-socket`, cwd = каталог
/// данных, auth-токен (только stdin — §3.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreSpawnConfig {
    /// Путь к бинарнику `lavray-core`.
    pub binary: PathBuf,
    /// UDS/named-pipe путь во временном каталоге 0700 (оболочка не занимает порт).
    pub listen_socket: PathBuf,
    /// Каталог данных (cwd процесса, права 0700).
    pub data_dir: PathBuf,
    /// Auth-токен ConnectRPC-канала (§3.2): 32 байта CSPRNG → base64url.
    /// Передаётся ТОЛЬКО в stdin ядра + `\n`; НИКОГДА в argv/env/логи/события
    /// (LNB-18) — обёртка [`SecretToken`] редактирует Debug/Display.
    pub auth_token: SecretToken,
}

/// Ошибки драйвера процесса ядра.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CoreProcessError {
    /// spawn(2)/CreateProcess не удался.
    #[error("core spawn failed: {0}")]
    Spawn(String),
    /// ready-строка/`/healthz` не получены за бюджет.
    #[error("core not ready within {budget:?}: {reason}")]
    ReadyTimeout { budget: Duration, reason: String },
    /// Не удалось завершить процесс по хэндлу/pgid (LNB-09).
    #[error("core kill failed: {0}")]
    Kill(String),
    /// Операция требует живого процесса.
    #[error("core process is not running")]
    NotRunning,
}

/// Точка интеграции с реальным процессом `lavray-core` (трейт; продакшн-реализация —
/// `std::process`/tokio + Job Object/setsid — на следующих итерациях §3).
pub trait CoreProcess {
    /// Запустить `lavray-core serve`. Контракт токена §3.2: значение
    /// `config.auth_token` (через `expose()`) пишется в **stdin** ядра + `\n`
    /// и stdin держится открытым; токен НИКОГДА не попадает в argv/env/
    /// логи/события.
    fn spawn(&mut self, config: &CoreSpawnConfig) -> Result<(), CoreProcessError>;
    /// Дождаться ready-строки + `/healthz` 200 в пределах `budget`.
    fn wait_ready(&mut self, budget: Duration) -> Result<CoreEndpoint, CoreProcessError>;
    /// Graceful-kill: SIGTERM → wait → SIGKILL в пределах `graceful_deadline` (§5).
    fn kill(&mut self, graceful_deadline: Duration) -> Result<(), CoreProcessError>;
}

/// transport-url endpoint'а мока по умолчанию (`MockCoreProcess`).
const MOCK_ENDPOINT_URL: &str = "unix:///mock/lavray-core";

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
    /// Все конфиги, переданные в `spawn`.
    pub spawn_calls: Vec<CoreSpawnConfig>,
    /// Бюджеты всех вызовов `wait_ready`.
    pub ready_calls: Vec<Duration>,
    /// Дедлайны всех вызовов `kill`.
    pub kill_calls: Vec<Duration>,
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
            spawn_calls: Vec::new(),
            ready_calls: Vec::new(),
            kill_calls: Vec::new(),
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
        self.spawn_calls.push(config.clone());
        self.spawn_results.pop_front_or_default_ok()
    }

    fn wait_ready(&mut self, budget: Duration) -> Result<CoreEndpoint, CoreProcessError> {
        self.ready_calls.push(budget);
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
        self.kill_results.pop_front_or_default_ok()
    }
}

/// Хелпер мока: достать СЛЕДУЮЩИЙ по порядку запланированный результат
/// (FIFO, `remove(0)`); пустая очередь — успех по умолчанию.
trait PopFrontOrDefaultOk {
    type Ok;
    fn pop_front_or_default_ok(&mut self) -> Result<Self::Ok, CoreProcessError>;
}

impl PopFrontOrDefaultOk for Vec<Result<(), CoreProcessError>> {
    type Ok = ();

    fn pop_front_or_default_ok(&mut self) -> Result<(), CoreProcessError> {
        if self.is_empty() {
            Ok(())
        } else {
            self.remove(0)
        }
    }
}

/// Источник времени для supervisor'а (инжектируется ради детерминизма тестов).
pub trait Clock: fmt::Debug {
    /// Текущий момент.
    fn now(&self) -> Instant;
}

/// Системные часы (продакшн).
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Управляемые часы для тестов (`advance` двигает время вперёд).
/// Клоны делят общее состояние — рантайм и тест двигают одни часы.
#[derive(Debug, Clone)]
pub struct MockClock {
    now: Rc<RefCell<Instant>>,
}

impl MockClock {
    /// Часы, застывшие в `start`.
    pub fn at(start: Instant) -> Self {
        Self {
            now: Rc::new(RefCell::new(start)),
        }
    }

    /// Сдвинуть время на `delta`.
    pub fn advance(&self, delta: Duration) {
        *self.now.borrow_mut() += delta;
    }
}

impl Clock for MockClock {
    fn now(&self) -> Instant {
        *self.now.borrow()
    }
}

/// Что делать после краха ядра (решение supervisor'а, §2.2 Crashed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrashDecision {
    /// Перезапустить через backoff-задержку (тем же профилем, FR-UI-232).
    /// Значение — БАЗОВАЯ задержка без джиттера: рантайм-планировщик обязан
    /// применить джиттер ±20 % (§2.2) — [`CrashDecision::restart_delay_with`].
    RestartAfter(Duration),
    /// Лимит рестартов исчерпан: честное состояние «Ядро остановлено».
    RateLimited,
}

impl CrashDecision {
    /// Задержка рестарта с джиттером §2.2 (хелпер для рантайм-планировщика):
    /// `Some(база ± 20 %)` для [`CrashDecision::RestartAfter`], `None` для
    /// [`CrashDecision::RateLimited`]. Источник случайности передаётся
    /// снаружи (CSPRNG-реализация — при врезке рестартера).
    pub fn restart_delay_with<J: backoff::JitterSource>(&self, jitter: &mut J) -> Option<Duration> {
        match self {
            Self::RestartAfter(base) => Some(backoff::apply_jitter(*base, jitter.unit())),
            Self::RateLimited => None,
        }
    }
}

/// Ошибки supervisor'а.
#[derive(Debug, thiserror::Error)]
pub enum SupervisorError {
    /// Нелегальный переход FSM (внутренняя рассинхронизация рантайма).
    #[error(transparent)]
    Illegal(#[from] TransitionError),
    /// Ошибка драйвера процесса.
    #[error(transparent)]
    Process(#[from] CoreProcessError),
}

/// Нянька процесса ядра: ведёт FSM, backoff и rate-limit рестартов.
///
/// Синхронный одношаговый API: реальный рантайм (tokio) вызывает методы по
/// событиям процесса/таймерам; вся политика — здесь и покрыта тестами.
#[derive(Debug)]
pub struct CoreSupervisor<P, C = SystemClock> {
    process: P,
    clock: C,
    state: CoreState,
    spawn_failures: u32,
    crash_times: Vec<Instant>,
    backoff: backoff::BackoffSchedule,
}

impl<P: CoreProcess, C: Clock> CoreSupervisor<P, C> {
    /// Новый supervisor в состоянии Idle.
    pub fn new(process: P, clock: C) -> Self {
        Self {
            process,
            clock,
            state: CoreState::Idle,
            spawn_failures: 0,
            crash_times: Vec::new(),
            backoff: backoff::BackoffSchedule::new(),
        }
    }

    /// Текущее состояние FSM.
    pub fn state(&self) -> CoreState {
        self.state
    }

    /// Текущее backoff-расписание (для наблюдения/тестов).
    pub fn backoff(&self) -> &backoff::BackoffSchedule {
        &self.backoff
    }

    /// Число зарегистрированных падений в окне rate-limit.
    pub fn crashes_in_window(&self) -> usize {
        self.crash_times.len()
    }

    fn apply(&mut self, event: CoreEvent) -> Result<CoreState, SupervisorError> {
        let next = transition(self.state, event)?;
        self.state = next;
        Ok(next)
    }

    /// §3: запуск из Idle → Spawning. Ошибка spawn → SpawnErr (+ учёт ретрая).
    pub fn start(&mut self, config: &CoreSpawnConfig) -> Result<CoreState, SupervisorError> {
        if self.state == CoreState::Idle {
            self.spawn_failures = 0;
            self.backoff.reset();
        }
        self.apply(CoreEvent::SpawnRequested)?;
        if let Err(err) = self.process.spawn(config) {
            self.register_failed_attempt();
            return Err(SupervisorError::Process(err));
        }
        Ok(self.state)
    }

    /// §3.4: ждать ready-строку + `/healthz` в пределах `T_SPAWN`.
    /// Легальность перехода Spawning → Ready проверяется ДО вызова драйвера:
    /// процесс не получает вызовов вне своей фазы (нелегальный вызов —
    /// [`SupervisorError::Illegal`] без побочных эффектов).
    pub fn wait_ready(&mut self) -> Result<CoreEndpoint, SupervisorError> {
        transition(self.state, CoreEvent::ReadyConfirmed)?;
        match self.process.wait_ready(T_SPAWN) {
            Ok(endpoint) => {
                self.apply(CoreEvent::ReadyConfirmed)?;
                Ok(endpoint)
            }
            Err(err) => {
                self.register_failed_attempt();
                Err(SupervisorError::Process(err))
            }
        }
    }

    /// Ретрай из SpawnErr: пока не исчерпаны [`SPAWN_RETRIES`] ретраев ПОСЛЕ
    /// первой попытки (суммарно ≤ [`SPAWN_ATTEMPTS_TOTAL`] запусков) — снова
    /// Spawning, иначе → RateLimited (§2.2 «ретрай ×3, потом RateLimited»).
    pub fn retry_spawn(&mut self, config: &CoreSpawnConfig) -> Result<CoreState, SupervisorError> {
        if self.spawn_failures >= SPAWN_ATTEMPTS_TOTAL {
            self.spawn_failures = 0;
            return self.apply(CoreEvent::RetryExhausted);
        }
        self.apply(CoreEvent::RetryScheduled)?;
        if let Err(err) = self.process.spawn(config) {
            self.register_failed_attempt();
            return Err(SupervisorError::Process(err));
        }
        Ok(self.state)
    }

    /// Событие ядра Connect() ok → Connected (FR-UI-261).
    pub fn mark_connected(&mut self) -> Result<CoreState, SupervisorError> {
        self.apply(CoreEvent::CoreConnected)
    }

    /// Disconnect() ok → Stopping (§2.2 Connected).
    pub fn mark_disconnected(&mut self) -> Result<CoreState, SupervisorError> {
        self.apply(CoreEvent::CoreDisconnected)
    }

    /// §5: запросить graceful-стоп из Ready/Connected/Spawning → Stopping.
    ///
    /// Честная оговорка: ПОЛНАЯ лестница §5 (1. `CoreService.Disconnect`
    /// [10 с] → 2. `CoreService.Shutdown` → 3. SIGTERM по хэндлу/pgid
    /// [5 с] → SIGKILL [3 с] → 4..6 прокси/DNS-снимок, verify §6) реализуется
    /// в рантайм-драйвере (Connect-клиент + ОС-интеграция — следующие
    /// итерации). Текущий supervisor после перехода в Stopping вызывает
    /// только страховочный [`CoreProcess::kill`] трейта с общим таймаутом
    /// [`GRACEFUL_SHUTDOWN_TOTAL`].
    pub fn request_stop(&mut self) -> Result<CoreState, SupervisorError> {
        self.apply(CoreEvent::StopRequested)?;
        self.process
            .kill(GRACEFUL_SHUTDOWN_TOTAL)
            .map_err(SupervisorError::Process)?;
        Ok(self.state)
    }

    /// §6: teardown-верификация прошла → Stopped.
    pub fn mark_teardown_verified(&mut self) -> Result<CoreState, SupervisorError> {
        self.apply(CoreEvent::TeardownVerified)
    }

    /// Stopped → Idle (сброс счётчиков ретраев/крахов).
    pub fn reset(&mut self) -> Result<CoreState, SupervisorError> {
        let state = self.apply(CoreEvent::Reset)?;
        self.spawn_failures = 0;
        self.backoff.reset();
        self.crash_times.clear();
        Ok(state)
    }

    /// Exit не по команде → Crashed + решение о рестарте:
    /// ≥ [`CRASH_RATE_LIMIT_COUNT`] падений за окно
    /// [`CRASH_RATE_LIMIT_WINDOW`] → RateLimited, иначе backoff-рестарт.
    pub fn notify_unexpected_exit(
        &mut self,
    ) -> Result<(CoreState, CrashDecision), SupervisorError> {
        self.apply(CoreEvent::CoreExited)?;
        self.register_crash();
        if self.crash_times.len() >= CRASH_RATE_LIMIT_COUNT {
            let state = self.apply(CoreEvent::RetryExhausted)?;
            Ok((state, CrashDecision::RateLimited))
        } else {
            Ok((
                self.state,
                CrashDecision::RestartAfter(self.backoff.delay()),
            ))
        }
    }

    /// Политика сброса эскалации (§2.2): ядро, стабильно проработавшее
    /// ≥ [`BACKOFF_RESET_AFTER`] после рестарта, считается здоровым —
    /// расписание backoff и окно крахов сбрасываются, следующий крах
    /// начинается снова с шага 1 с. Возвращает `true`, если сброс выполнен.
    /// Рантайм вызывает по таймеру аптайма (uptime = now − момент Ready).
    pub fn note_stable_uptime(&mut self, uptime: Duration) -> bool {
        if uptime >= BACKOFF_RESET_AFTER {
            self.backoff.reset();
            self.crash_times.clear();
            true
        } else {
            false
        }
    }

    /// Backoff-рестарт из Crashed тем же профилем (FR-UI-232). Задержку из
    /// решения [`CrashDecision::RestartAfter`] выдерживает рантайм-планировщик
    /// (с джиттером — [`CrashDecision::restart_delay_with`]).
    pub fn restart_after_crash(
        &mut self,
        config: &CoreSpawnConfig,
    ) -> Result<CoreState, SupervisorError> {
        self.apply(CoreEvent::RetryScheduled)?;
        if let Err(err) = self.process.spawn(config) {
            self.register_failed_attempt();
            return Err(SupervisorError::Process(err));
        }
        Ok(self.state)
    }

    /// Ручной «Перезапустить» из RateLimited: сброс лимитов и новый spawn.
    pub fn manual_restart(
        &mut self,
        config: &CoreSpawnConfig,
    ) -> Result<CoreState, SupervisorError> {
        self.apply(CoreEvent::ManualRestart)?;
        self.spawn_failures = 0;
        self.backoff.reset();
        self.crash_times.clear();
        if let Err(err) = self.process.spawn(config) {
            self.register_failed_attempt();
            return Err(SupervisorError::Process(err));
        }
        Ok(self.state)
    }

    /// Зафиксировать неудачную попытку (SpawnErr): рост backoff-шага.
    fn register_failed_attempt(&mut self) {
        let _ = self.apply(CoreEvent::SpawnFailed);
        self.spawn_failures += 1;
        self.backoff.record_failure();
    }

    /// Зафиксировать крах: окно 60 с + рост backoff-шага.
    fn register_crash(&mut self) {
        let now = self.clock.now();
        self.crash_times
            .retain(|&t| now.duration_since(t) < CRASH_RATE_LIMIT_WINDOW);
        self.crash_times.push(now);
        self.backoff.record_failure();
    }
}

/// Тестовым хелперам нужен доступ к внутренностям (приватные поля) —
/// реализуем доступ здесь, в том же модуле, до тестового модуля.
#[cfg(test)]
impl CoreSupervisor<MockCoreProcess, MockClock> {
    fn process_ref(&self) -> &MockCoreProcess {
        &self.process
    }

    fn spawn_failures_hint(&self) -> u32 {
        self.spawn_failures
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Полная легальная таблица переходов §2.1–2.2 (параметризованно).
    #[test]
    fn transition_table_legal() {
        let table: &[(CoreState, CoreEvent, CoreState)] = &[
            (
                CoreState::Idle,
                CoreEvent::SpawnRequested,
                CoreState::Spawning,
            ),
            (
                CoreState::Spawning,
                CoreEvent::ReadyConfirmed,
                CoreState::Ready,
            ),
            (
                CoreState::Spawning,
                CoreEvent::SpawnFailed,
                CoreState::SpawnErr,
            ),
            (
                CoreState::Spawning,
                CoreEvent::StopRequested,
                CoreState::Stopping,
            ),
            (
                CoreState::SpawnErr,
                CoreEvent::RetryScheduled,
                CoreState::Spawning,
            ),
            (
                CoreState::SpawnErr,
                CoreEvent::RetryExhausted,
                CoreState::RateLimited,
            ),
            (
                CoreState::SpawnErr,
                CoreEvent::TeardownVerified,
                CoreState::Idle,
            ),
            (
                CoreState::Ready,
                CoreEvent::CoreConnected,
                CoreState::Connected,
            ),
            (CoreState::Ready, CoreEvent::CoreExited, CoreState::Crashed),
            (
                CoreState::Ready,
                CoreEvent::StopRequested,
                CoreState::Stopping,
            ),
            (
                CoreState::Connected,
                CoreEvent::CoreDisconnected,
                CoreState::Stopping,
            ),
            (
                CoreState::Connected,
                CoreEvent::CoreExited,
                CoreState::Crashed,
            ),
            (
                CoreState::Connected,
                CoreEvent::StopRequested,
                CoreState::Stopping,
            ),
            (
                CoreState::Crashed,
                CoreEvent::RetryScheduled,
                CoreState::Spawning,
            ),
            (
                CoreState::Crashed,
                CoreEvent::RetryExhausted,
                CoreState::RateLimited,
            ),
            (
                CoreState::RateLimited,
                CoreEvent::ManualRestart,
                CoreState::Spawning,
            ),
            (
                CoreState::Stopping,
                CoreEvent::TeardownVerified,
                CoreState::Stopped,
            ),
            (CoreState::Stopped, CoreEvent::Reset, CoreState::Idle),
        ];
        assert_eq!(table.len(), 18, "покрытие всех легальных рёбер §2.1");
        for (from, event, expected) in table {
            let got = transition(*from, *event)
                .unwrap_or_else(|err| panic!("legal edge rejected: {err}"));
            assert_eq!(got, *expected, "{from} + {event}");
        }
    }

    /// Нелегальные переходы дают ошибку (а не панику/молчание).
    #[test]
    fn transition_table_illegal() {
        let illegal: &[(CoreState, CoreEvent)] = &[
            (CoreState::Idle, CoreEvent::CoreExited),
            (CoreState::Idle, CoreEvent::ReadyConfirmed),
            (CoreState::Idle, CoreEvent::StopRequested),
            (CoreState::Spawning, CoreEvent::CoreConnected),
            (CoreState::Spawning, CoreEvent::CoreExited),
            (CoreState::SpawnErr, CoreEvent::ReadyConfirmed),
            (CoreState::Ready, CoreEvent::SpawnRequested),
            (CoreState::Ready, CoreEvent::RetryScheduled),
            (CoreState::Connected, CoreEvent::CoreConnected),
            (CoreState::Crashed, CoreEvent::CoreExited),
            (CoreState::RateLimited, CoreEvent::RetryScheduled),
            (CoreState::Stopping, CoreEvent::StopRequested),
            (CoreState::Stopped, CoreEvent::SpawnRequested),
        ];
        for (from, event) in illegal {
            let err = transition(*from, *event)
                .expect_err(&format!("illegal edge accepted: {from} + {event}"));
            assert_eq!(
                err,
                TransitionError {
                    from: *from,
                    event: *event
                }
            );
        }
    }

    fn config() -> CoreSpawnConfig {
        CoreSpawnConfig {
            binary: PathBuf::from("/opt/lavray/lavray-core"),
            listen_socket: PathBuf::from("/tmp/lavray-XXXX/ctrl.sock"),
            data_dir: PathBuf::from("/tmp/lavray-data"),
            auth_token: SecretToken::from_base64url("A".repeat(AUTH_TOKEN_B64_LEN)).unwrap(),
        }
    }

    /// Токен §3.2 не утекает через Debug/Display — ни сам, ни внутри конфига.
    #[test]
    fn secret_token_never_leaks_through_debug_or_display() {
        let token = SecretToken::from_base64url("Q".repeat(AUTH_TOKEN_B64_LEN)).unwrap();
        assert!(!format!("{token:?}").contains('Q'), "Debug редактирован");
        assert!(!format!("{token}").contains('Q'), "Display редактирован");
        assert!(format!("{token:?}").contains("REDACTED"));
        // Конфиг с токеном тоже безопасно логируется (поле редацировано).
        let cfg = config();
        let dumped = format!("{cfg:?}");
        assert!(
            !dumped.contains("AAAA"),
            "токен не должен попадать в Debug конфига"
        );
        assert!(dumped.contains("REDACTED"));
    }

    /// Конструктор валидирует форму base64url-токена (32 байта → 43 символа).
    #[test]
    fn secret_token_validates_base64url_shape() {
        // '-' и '_' — легальные base64url-символы (в отличие от '+' и '/').
        let url_safe = format!("{}-_", "A".repeat(AUTH_TOKEN_B64_LEN - 2));
        assert_eq!(url_safe.len(), AUTH_TOKEN_B64_LEN);
        assert!(SecretToken::from_base64url(url_safe).is_ok());

        // Короткая/длинная строка.
        assert_eq!(
            SecretToken::from_base64url("A".repeat(AUTH_TOKEN_B64_LEN - 1)).unwrap_err(),
            InvalidAuthToken(AUTH_TOKEN_B64_LEN - 1)
        );
        assert_eq!(
            SecretToken::from_base64url("A".repeat(AUTH_TOKEN_B64_LEN + 1)).unwrap_err(),
            InvalidAuthToken(AUTH_TOKEN_B64_LEN + 1)
        );
        // Символы стандартного base64 ('+', '/', '=') запрещены (§3.2 base64url).
        assert!(
            SecretToken::from_base64url(format!("{}+A", "B".repeat(AUTH_TOKEN_B64_LEN - 2)))
                .is_err()
        );
        assert!(
            SecretToken::from_base64url(format!("{}=", "B".repeat(AUTH_TOKEN_B64_LEN - 1)))
                .is_err()
        );
    }

    fn supervisor(
        spawn: Vec<Result<(), CoreProcessError>>,
    ) -> (CoreSupervisor<MockCoreProcess, MockClock>, MockClock) {
        let clock = MockClock::at(Instant::now());
        let process = MockCoreProcess {
            spawn_results: spawn,
            ..MockCoreProcess::default()
        };
        // Клон часов делит состояние с supervisor'ом — advance двигает обоих.
        (CoreSupervisor::new(process, clock.clone()), clock)
    }

    /// Happy path §2: Idle → Spawning → Ready → Connected → (stop §5) →
    /// Stopping → Stopped → Idle; kill вызывается с общим таймаутом §5 (15 с).
    #[test]
    fn supervisor_happy_path() {
        let (mut sup, _clock) = supervisor(vec![]);
        assert_eq!(sup.state(), CoreState::Idle);

        assert_eq!(sup.start(&config()).unwrap(), CoreState::Spawning);
        let endpoint = sup.wait_ready().unwrap();
        assert_eq!(endpoint.transport_url, "unix:///mock/lavray-core");
        assert_eq!(sup.state(), CoreState::Ready);

        assert_eq!(sup.mark_connected().unwrap(), CoreState::Connected);
        assert_eq!(sup.request_stop().unwrap(), CoreState::Stopping);
        assert_eq!(sup.mark_teardown_verified().unwrap(), CoreState::Stopped);
        assert_eq!(sup.reset().unwrap(), CoreState::Idle);

        assert_eq!(sup.process_ref().kill_calls, vec![GRACEFUL_SHUTDOWN_TOTAL]);
        assert_eq!(sup.process_ref().ready_calls, vec![T_SPAWN]);
        assert_eq!(sup.process_ref().spawn_calls.len(), 1);
    }

    /// Disconnect()-путь: переход в Stopping БЕЗ kill — Shutdown делает ядро
    /// само (§5 шаг 2), kill — только страховка, если процесс жив (шаг 3).
    #[test]
    fn supervisor_disconnect_path_does_not_kill() {
        let (mut sup, _clock) = supervisor(vec![]);
        sup.start(&config()).unwrap();
        sup.wait_ready().unwrap();
        sup.mark_connected().unwrap();
        assert_eq!(sup.mark_disconnected().unwrap(), CoreState::Stopping);
        assert_eq!(sup.mark_teardown_verified().unwrap(), CoreState::Stopped);
        assert!(
            sup.process_ref().kill_calls.is_empty(),
            "Disconnect-путь не убивает процесс принудительно"
        );
    }

    /// Краш-цикл: 3 падения за окно 60 с → RateLimited; ручной перезапуск
    /// возвращает к Spawning (§2.2 Crashed/RateLimited).
    #[test]
    fn supervisor_crash_cycle_hits_rate_limit() {
        let (mut sup, clock) = supervisor(vec![]);
        sup.start(&config()).unwrap();
        sup.wait_ready().unwrap();
        assert_eq!(sup.state(), CoreState::Ready);

        // Падение 1: рестарт с backoff 1 с.
        let (state, decision) = sup.notify_unexpected_exit().unwrap();
        assert_eq!(state, CoreState::Crashed);
        assert_eq!(
            decision,
            CrashDecision::RestartAfter(Duration::from_secs(1))
        );
        assert_eq!(
            sup.restart_after_crash(&config()).unwrap(),
            CoreState::Spawning
        );
        sup.wait_ready().unwrap();

        // Падение 2 (внутри окна 60 с): backoff растёт до 2 с.
        clock.advance(Duration::from_secs(10));
        let (state, decision) = sup.notify_unexpected_exit().unwrap();
        assert_eq!(state, CoreState::Crashed);
        assert_eq!(
            decision,
            CrashDecision::RestartAfter(Duration::from_secs(2))
        );
        assert_eq!(
            sup.restart_after_crash(&config()).unwrap(),
            CoreState::Spawning
        );
        sup.wait_ready().unwrap();

        // Падение 3 в том же окне: ≥ 3 за 60 с → RateLimited.
        clock.advance(Duration::from_secs(10));
        let (state, decision) = sup.notify_unexpected_exit().unwrap();
        assert_eq!(state, CoreState::RateLimited);
        assert_eq!(decision, CrashDecision::RateLimited);

        // Ручной «Перезапустить» сбрасывает лимит.
        assert_eq!(sup.manual_restart(&config()).unwrap(), CoreState::Spawning);
    }

    /// Падения реже, чем окно rate-limit, лимит не включают.
    #[test]
    fn supervisor_crashes_outside_window_no_rate_limit() {
        let (mut sup, clock) = supervisor(vec![]);
        sup.start(&config()).unwrap();
        sup.wait_ready().unwrap();

        for expected_delay in [1u64, 2, 4] {
            let (state, decision) = sup.notify_unexpected_exit().unwrap();
            assert_eq!(state, CoreState::Crashed);
            assert_eq!(
                decision,
                CrashDecision::RestartAfter(Duration::from_secs(expected_delay))
            );
            assert_eq!(
                sup.restart_after_crash(&config()).unwrap(),
                CoreState::Spawning
            );
            sup.wait_ready().unwrap();
            // Между крахами проходит больше окна 60 с — окно пустеет.
            clock.advance(CRASH_RATE_LIMIT_WINDOW + Duration::from_secs(1));
        }
        assert_eq!(sup.state(), CoreState::Ready);
    }

    /// SpawnErr §2.2: первая попытка + 3 ретрая (суммарно 4 запуска),
    /// следующий вызов → RateLimited без обращения к процессу.
    #[test]
    fn supervisor_spawn_retries_exhausted() {
        let spawn_err = Err(CoreProcessError::Spawn("no such file".to_owned()));
        let (mut sup, _clock) = supervisor(vec![
            spawn_err.clone(),
            spawn_err.clone(),
            spawn_err.clone(),
            spawn_err.clone(),
        ]);

        assert!(sup.start(&config()).is_err());
        assert_eq!(sup.state(), CoreState::SpawnErr);
        assert_eq!(sup.spawn_failures_hint(), 1);

        // Ретраи 1–3 после первой попытки — все вызывают spawn и падают.
        assert!(sup.retry_spawn(&config()).is_err());
        assert_eq!(sup.state(), CoreState::SpawnErr);
        assert!(sup.retry_spawn(&config()).is_err());
        assert_eq!(sup.state(), CoreState::SpawnErr);
        assert!(sup.retry_spawn(&config()).is_err());
        assert_eq!(sup.state(), CoreState::SpawnErr);

        // Бюджет «3 ретрая» исчерпан → RateLimited (spawn НЕ вызывается).
        assert_eq!(sup.retry_spawn(&config()).unwrap(), CoreState::RateLimited);
        assert_eq!(
            sup.process_ref().spawn_calls.len(),
            SPAWN_ATTEMPTS_TOTAL as usize,
            "суммарно: первая попытка + 3 ретрая"
        );
    }

    /// Teardown-успех из SpawnErr возвращает Idle (§2.2 «успех → Idle»).
    #[test]
    fn supervisor_spawn_err_teardown_to_idle() {
        let spawn_err = Err(CoreProcessError::Spawn("boom".to_owned()));
        let (mut sup, _clock) = supervisor(vec![spawn_err]);
        assert!(sup.start(&config()).is_err());
        assert_eq!(sup.state(), CoreState::SpawnErr);
        assert_eq!(
            transition(CoreState::SpawnErr, CoreEvent::TeardownVerified).unwrap(),
            CoreState::Idle
        );
    }

    /// Graceful-стоп можно запросить и во время Spawning (§5 применяется к
    /// живому процессу на любом этапе).
    #[test]
    fn supervisor_stop_from_spawning() {
        let (mut sup, _clock) = supervisor(vec![]);
        sup.start(&config()).unwrap();
        assert_eq!(sup.state(), CoreState::Spawning);
        assert_eq!(sup.request_stop().unwrap(), CoreState::Stopping);
        assert_eq!(sup.mark_teardown_verified().unwrap(), CoreState::Stopped);
    }

    /// Операции не в своём состоянии дают Illegal-ошибку (рассинхрон рантайма).
    #[test]
    fn supervisor_rejects_out_of_phase_calls() {
        let (mut sup, _clock) = supervisor(vec![]);
        let err = sup.mark_connected().unwrap_err();
        assert!(matches!(err, SupervisorError::Illegal(_)));

        let (mut sup2, _clock2) = supervisor(vec![]);
        let err = sup2.notify_unexpected_exit().unwrap_err();
        assert!(matches!(err, SupervisorError::Illegal(_)));
    }

    /// Очереди мока — честный FIFO: результаты потребляются в порядке
    /// планирования, а не с конца.
    #[test]
    fn mock_result_queues_are_fifo() {
        let first = CoreEndpoint {
            transport_url: "unix:///mock/first".to_owned(),
        };
        let second = CoreEndpoint {
            transport_url: "unix:///mock/second".to_owned(),
        };
        let mut process = MockCoreProcess {
            ready_results: vec![Ok(first.clone()), Ok(second.clone())],
            ..MockCoreProcess::default()
        };

        assert_eq!(
            process.wait_ready(T_SPAWN).unwrap(),
            first,
            "первым — первый"
        );
        assert_eq!(
            process.wait_ready(T_SPAWN).unwrap(),
            second,
            "вторым — второй"
        );
        // Очередь пуста — успех с endpoint'ом по умолчанию.
        assert_eq!(
            process.wait_ready(T_SPAWN).unwrap(),
            CoreEndpoint {
                transport_url: MOCK_ENDPOINT_URL.to_owned()
            }
        );
    }

    /// always_ok: кастомный endpoint возвращается ВСЕМ вызовам wait_ready,
    /// а не только первому.
    #[test]
    fn mock_always_ok_endpoint_serves_every_wait_ready() {
        let mut process = MockCoreProcess::always_ok("unix:///mock/custom");
        for _ in 0..3 {
            assert_eq!(
                process.wait_ready(T_SPAWN).unwrap().transport_url,
                "unix:///mock/custom"
            );
        }
        assert_eq!(process.ready_calls.len(), 3);
    }

    /// wait_ready вне фазы Spawning отклоняется ДО обращения к драйверу
    /// процесса (валидация перехода впереди побочных эффектов).
    #[test]
    fn wait_ready_out_of_phase_rejects_before_driver_call() {
        let (mut sup, _clock) = supervisor(vec![]);
        let err = sup.wait_ready().unwrap_err();
        assert!(matches!(err, SupervisorError::Illegal(_)));
        assert!(
            sup.process_ref().ready_calls.is_empty(),
            "драйвер не должен получать вызов вне фазы"
        );
    }

    /// Политика сброса эскалации: аптайм ≥ BACKOFF_RESET_AFTER сбрасывает
    /// backoff и окно крахов — следующий крах снова с шага 1 с (§2.2).
    /// (Падения разнесены > окна 60 с, чтобы не мешал rate-limit.)
    #[test]
    fn backoff_resets_after_stable_uptime() {
        let (mut sup, clock) = supervisor(vec![]);
        sup.start(&config()).unwrap();
        sup.wait_ready().unwrap();

        // Крах 1 → backoff 1 с; крах 2 (окно пустело) → 2 с.
        sup.notify_unexpected_exit().unwrap();
        sup.restart_after_crash(&config()).unwrap();
        sup.wait_ready().unwrap();
        clock.advance(CRASH_RATE_LIMIT_WINDOW + Duration::from_secs(1));
        let (_, decision) = sup.notify_unexpected_exit().unwrap();
        assert_eq!(
            decision,
            CrashDecision::RestartAfter(Duration::from_secs(2))
        );
        sup.restart_after_crash(&config()).unwrap();
        sup.wait_ready().unwrap();

        // Аптайм ниже порога — эскалация сохраняется (следующий крах → 4 с).
        assert!(!sup.note_stable_uptime(BACKOFF_RESET_AFTER - Duration::from_secs(1)));
        clock.advance(CRASH_RATE_LIMIT_WINDOW + Duration::from_secs(1));
        let (_, decision) = sup.notify_unexpected_exit().unwrap();
        assert_eq!(
            decision,
            CrashDecision::RestartAfter(Duration::from_secs(4))
        );
        sup.restart_after_crash(&config()).unwrap();
        sup.wait_ready().unwrap();

        // Стабильный аптайм ≥ 300 с — сброс; следующий крах снова с 1 с.
        clock.advance(BACKOFF_RESET_AFTER);
        assert!(sup.note_stable_uptime(BACKOFF_RESET_AFTER));
        let (_, decision) = sup.notify_unexpected_exit().unwrap();
        assert_eq!(
            decision,
            CrashDecision::RestartAfter(Duration::from_secs(1))
        );
    }

    /// CrashDecision::restart_delay_with — джиттер §2.2 поверх базовой
    /// задержки; RateLimited задержки не имеет (контракт рантайм-планировщика).
    #[test]
    fn crash_decision_applies_jitter_to_base_delay() {
        let base = Duration::from_secs(4);
        let decision = CrashDecision::RestartAfter(base);
        let mut low = backoff::FixedJitter { value: 0.0 };
        let mut mid = backoff::FixedJitter { value: 0.5 };
        let mut high = backoff::FixedJitter { value: 1.0 };
        assert_eq!(
            decision.restart_delay_with(&mut low),
            Some(Duration::from_millis(3200))
        );
        assert_eq!(decision.restart_delay_with(&mut mid), Some(base));
        assert_eq!(
            decision.restart_delay_with(&mut high),
            Some(Duration::from_millis(4800))
        );
        assert_eq!(
            CrashDecision::RateLimited.restart_delay_with(&mut mid),
            None
        );
    }
}
