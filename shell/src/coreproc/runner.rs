// SPDX-License-Identifier: GPL-3.0-only

//! Рантайм-цикл надзирателя ядра (T-56, A2-11).
//!
//! Раньше `main.rs` держал свой цикл «спим 500 мс, ядро умерло, перезапуск»:
//! пауза сбрасывалась в 1 с после каждого успешного запуска, и ядро, умирающее
//! сразу после READY, перезапускалось каждые ~1,5 с вечно; политика
//! [`CoreSupervisor`] (backoff 1/2/4/8/15 с ±20 %, RateLimited после 3 падений
//! за 60 с, сброс эскалации после стабильной работы) бинарнику была не нужна.
//! Теперь цикл ведёт именно [`CoreSupervisor`], а `main.rs` лишь подставляет
//! среду ([`Observer`], конфигурацию запуска). Цикл обобщён по процессу, часам,
//! ожиданию и джиттеру, поэтому крах-цикл проверяется без GUI и без пауз.

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::backoff::JitterSource;
use super::driver::RealCoreProcess;
use super::{
    Clock, CoreEndpoint, CoreProcess, CoreProcessError, CoreSpawnConfig, CoreState, CoreSupervisor,
    CrashDecision, SecretToken, SupervisorError, SystemClock, GRACEFUL_SHUTDOWN_TOTAL,
    SPAWN_ATTEMPTS_TOTAL,
};

/// Период опроса «ядро живо» и реакции на команды.
pub const POLL_INTERVAL: Duration = Duration::from_millis(200);
/// Сколько строк кольца логов ядра прикладывается к сообщению о сбое.
pub const FAILURE_LOG_LINES: usize = 40;
const AWAIT_MANUAL_WAIT: Duration = Duration::from_secs(3600);

/// Команда надзирателю из другого потока.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    /// Остановить ядро (лестница §5) и завершить надзор.
    Stop,
    /// Ручной «Перезапустить» (из RateLimited и после ошибки запуска).
    ManualRestart,
}

/// Сбой запуска, крах или исчерпание лимита — для диагностики.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub message: String,
    /// Последние строки stdout/stderr ядра (кольцо §4); может быть пустым.
    pub log_tail: Vec<String>,
}

/// Среда, которой цикл сообщает о жизни ядра (в `main.rs` — состояние для UI
/// и трей; в тестах — запись событий).
pub trait Observer {
    /// Состояние FSM изменилось (публикуется только при смене).
    fn on_state(&mut self, state: CoreState);
    /// Ядро готово: адрес и токен (токен новый при каждом запуске).
    fn on_ready(&mut self, endpoint: &CoreEndpoint, token: &SecretToken);
    /// Агентский токен этого запуска ядра (MCP); вызывается перед `on_ready`,
    /// если запуск его передавал. Наблюдателям, которым он не нужен, достаточно
    /// умолчания.
    fn on_agent_token(&mut self, _token: &SecretToken) {}
    fn on_failure(&mut self, failure: &Failure);
    /// Ядро остановлено, но чистота сети НЕ подтверждена (§6: проба
    /// `Unchecked`/`Stale`, частичный отчёт либо kill не удался): состояние
    /// `Stopped` не объявляется. Выход приложения продолжается — это
    /// предупреждение, не сбой запуска (`on_failure` не вызывается).
    fn on_teardown_unconfirmed(&mut self, _detail: &str) {}
}

/// Ожидание, прерываемое командой: остановка срабатывает сразу, а не на
/// очередном опросе.
pub trait Waiter {
    /// Подождать `delay`; `Some(команда)`, если она пришла раньше.
    fn wait(&mut self, delay: Duration) -> Option<Command>;
}

/// Продакшн-ожидание на канале команд.
#[derive(Debug)]
pub struct ChannelWaiter(Receiver<Command>);

impl Waiter for ChannelWaiter {
    fn wait(&mut self, delay: Duration) -> Option<Command> {
        match self.0.recv_timeout(delay) {
            Ok(command) => Some(command),
            Err(RecvTimeoutError::Timeout) => None,
            Err(RecvTimeoutError::Disconnected) => Some(Command::Stop), // приложение закрыто
        }
    }
}

/// Джиттер из системного генератора случайных чисел.
#[derive(Debug, Clone, Copy, Default)]
pub struct OsJitter;

impl JitterSource for OsJitter {
    fn unit(&mut self) -> f64 {
        let mut bytes = [0u8; 4];
        if getrandom::fill(&mut bytes).is_err() {
            return 0.5;
        }
        f64::from(u32::from_le_bytes(bytes)) / (f64::from(u32::MAX) + 1.0)
    }
}

enum Phase {
    Start,
    WaitReady,
    RetrySpawn,
    Monitor,
    Restart(CrashDecision),
    AwaitManual,
    Stop,
}

struct Runner<'a, P, C, O, W, J, F> {
    sup: &'a mut CoreSupervisor<P, C>,
    factory: &'a mut F,
    observer: &'a mut O,
    waiter: &'a mut W,
    jitter: &'a mut J,
    config: Option<CoreSpawnConfig>,
    published: Option<CoreState>,
    ready_at: Option<Instant>,
    stable_noted: bool,
}

/// Цикл надзора: запускает ядро, ждёт готовности, следит за живостью,
/// перезапускает по политике [`CoreSupervisor`], по [`Command::Stop`] гасит
/// ядро лестницей §5 и возвращается. `factory` вызывается перед КАЖДЫМ
/// запуском (токен новый, §3.2); его ошибка (нет бинарника ядра) повтором не
/// лечится — цикл сообщает о ней и ждёт ручного «Перезапустить».
pub fn run<P, C, O, W, J, F>(
    sup: &mut CoreSupervisor<P, C>,
    factory: &mut F,
    observer: &mut O,
    waiter: &mut W,
    jitter: &mut J,
) where
    P: CoreProcess,
    C: Clock,
    O: Observer,
    W: Waiter,
    J: JitterSource,
    F: FnMut() -> Result<CoreSpawnConfig, String>,
{
    let mut runner = Runner {
        sup,
        factory,
        observer,
        waiter,
        jitter,
        config: None,
        published: None,
        ready_at: None,
        stable_noted: false,
    };
    let mut phase = Phase::Start;
    loop {
        phase = match phase {
            Phase::Start => runner.start(),
            Phase::WaitReady => runner.wait_ready(),
            Phase::RetrySpawn => runner.retry_spawn(),
            Phase::Monitor => runner.monitor(),
            Phase::Restart(decision) => runner.restart(decision),
            Phase::AwaitManual => runner.await_manual(),
            Phase::Stop => return runner.stop(),
        };
    }
}

impl<P, C, O, W, J, F> Runner<'_, P, C, O, W, J, F>
where
    P: CoreProcess,
    C: Clock,
    O: Observer,
    W: Waiter,
    J: JitterSource,
    F: FnMut() -> Result<CoreSpawnConfig, String>,
{
    fn publish(&mut self, state: CoreState) {
        if self.published != Some(state) {
            self.published = Some(state);
            self.observer.on_state(state);
        }
    }

    fn fail(&mut self, message: String) {
        let log_tail = self.sup.process().log_lines(FAILURE_LOG_LINES);
        self.observer.on_failure(&Failure { message, log_tail });
    }

    fn spawn_failed(&mut self, err: &SupervisorError) -> Phase {
        self.fail(format!("не удалось запустить ядро: {err}"));
        self.publish(self.sup.state());
        Phase::RetrySpawn
    }

    /// Новая конфигурация запуска; `None` — собрать не удалось (сбой передан).
    fn fresh_config(&mut self) -> Option<CoreSpawnConfig> {
        match (self.factory)() {
            Ok(config) => Some(config),
            Err(message) => {
                self.fail(message);
                self.publish(CoreState::SpawnErr);
                None
            }
        }
    }

    /// Результат запуска (`start`/`restart`/`manual_restart`) → следующая фаза.
    fn started(
        &mut self,
        config: CoreSpawnConfig,
        result: Result<CoreState, SupervisorError>,
    ) -> Phase {
        self.config = Some(config);
        match result {
            Ok(_) => {
                self.publish(self.sup.state());
                Phase::WaitReady
            }
            Err(err) => self.spawn_failed(&err),
        }
    }

    fn start(&mut self) -> Phase {
        let Some(config) = self.fresh_config() else {
            return Phase::AwaitManual;
        };
        let result = self.sup.start(&config);
        self.started(config, result)
    }

    fn wait_ready(&mut self) -> Phase {
        match self.sup.wait_ready() {
            // Stop пришёл во время ожидания: не сбой запуска, ретрая и нового
            // spawn нет — единственный shutdown выполнит `stop()`.
            Err(SupervisorError::Process(CoreProcessError::Cancelled)) => Phase::Stop,
            // Вторая проверка на границе READY → публикация: если Stop выиграл
            // гонку у READY, endpoint и токены не публикуются.
            Ok(_) if self.sup.process().is_cancelled() => Phase::Stop,
            Ok(endpoint) => {
                if let Some(config) = &self.config {
                    if let Some(agent) = &config.agent_token {
                        self.observer.on_agent_token(agent);
                    }
                    self.observer.on_ready(&endpoint, &config.auth_token);
                }
                self.ready_at = Some(self.sup.now());
                self.stable_noted = false;
                self.publish(self.sup.state());
                Phase::Monitor
            }
            Err(err) => self.spawn_failed(&err),
        }
    }

    /// Ретрай запуска: пауза backoff, затем новый spawn либо RateLimited.
    fn retry_spawn(&mut self) -> Phase {
        if self.sup.state() != CoreState::SpawnErr {
            return Phase::AwaitManual;
        }
        let delay = self.sup.backoff().delay_with(&mut *self.jitter);
        if let Some(Command::Stop) = self.waiter.wait(delay) {
            return Phase::Stop;
        }
        let Some(config) = self.fresh_config() else {
            return Phase::AwaitManual;
        };
        let result = self.sup.retry_spawn(&config);
        if matches!(result, Ok(CoreState::RateLimited)) {
            self.publish(CoreState::RateLimited);
            self.fail(format!(
                "ядро не запустилось за {SPAWN_ATTEMPTS_TOTAL} попыток подряд; перезапуски остановлены"
            ));
            return Phase::AwaitManual;
        }
        self.started(config, result)
    }

    /// Наблюдение за живым ядром до команды или смерти процесса.
    fn monitor(&mut self) -> Phase {
        loop {
            if let Some(Command::Stop) = self.waiter.wait(POLL_INTERVAL) {
                return Phase::Stop;
            }
            if !self.sup.process_mut().is_alive() {
                break;
            }
            // Стабильная работа ≥ BACKOFF_RESET_AFTER сбрасывает эскалацию backoff.
            if let (false, Some(since)) = (self.stable_noted, self.ready_at) {
                let uptime = self.sup.now().saturating_duration_since(since);
                self.stable_noted = self.sup.note_stable_uptime(uptime);
            }
        }
        let exit = self.sup.process().exit_info();
        let Ok((state, decision)) = self.sup.notify_unexpected_exit() else {
            return Phase::AwaitManual;
        };
        self.publish(CoreState::Crashed);
        self.fail(format!(
            "ядро неожиданно завершилось{}",
            exit.map(|e| format!(" ({e})")).unwrap_or_default()
        ));
        if state == CoreState::RateLimited {
            self.publish(state);
            self.fail(
                "ядро падает слишком часто (3 раза за 60 с); перезапуски остановлены".to_owned(),
            );
            return Phase::AwaitManual;
        }
        Phase::Restart(decision)
    }

    fn restart(&mut self, decision: CrashDecision) -> Phase {
        let delay = decision
            .restart_delay_with(&mut *self.jitter)
            .unwrap_or(Duration::ZERO);
        if let Some(Command::Stop) = self.waiter.wait(delay) {
            return Phase::Stop;
        }
        let Some(config) = self.fresh_config() else {
            return Phase::AwaitManual;
        };
        let result = self.sup.restart_after_crash(&config);
        self.started(config, result)
    }

    /// RateLimited или ядро не собрать: ждём ручного «Перезапустить».
    fn await_manual(&mut self) -> Phase {
        loop {
            match self.waiter.wait(AWAIT_MANUAL_WAIT) {
                Some(Command::Stop) => return Phase::Stop,
                Some(Command::ManualRestart) => break,
                None => {}
            }
        }
        if self.sup.state() != CoreState::RateLimited {
            return Phase::Start; // ядро не собиралось: FSM ещё в Idle
        }
        let Some(config) = self.fresh_config() else {
            return Phase::AwaitManual;
        };
        let result = self.sup.manual_restart(&config);
        self.started(config, result)
    }

    /// Жизненный цикл процесса и чистота сети — раздельно. Kill удался →
    /// `Stopped` (факт про процесс). «Сеть чиста» (`mark_teardown_verified`) —
    /// только при `Clean` по ВСЕМ пробам §6; иначе `on_teardown_unconfirmed`
    /// без отметки (выход продолжается). Kill не удался → `Stopped` нет.
    fn confirm_teardown(&mut self, kill_error: Option<SupervisorError>) {
        if let Some(err) = kill_error {
            return self
                .observer
                .on_teardown_unconfirmed(&format!("ядро не остановлено: {err}"));
        }
        let report = self.sup.process_mut().verify_teardown();
        if report.is_clean() {
            let _ = self.sup.mark_teardown_verified();
        } else {
            let _ = self.sup.mark_stopped();
            let detail = report.unconfirmed_summary();
            self.observer.on_teardown_unconfirmed(&detail);
        }
    }

    /// Остановка по команде: лестница §5 для живого ядра, иначе идемпотентный kill.
    fn stop(&mut self) {
        if matches!(
            self.sup.state(),
            CoreState::Spawning | CoreState::Ready | CoreState::Connected
        ) {
            let stopped = self.sup.request_stop();
            self.publish(self.sup.state());
            self.confirm_teardown(stopped.err());
        } else {
            let _ = self.sup.process_mut().kill(GRACEFUL_SHUTDOWN_TOTAL);
        }
        self.publish(self.sup.state());
    }
}

/// Управление запущенным надзирателем из других потоков.
#[derive(Debug)]
pub struct SupervisorHandle {
    tx: Sender<Command>,
    stopped: Arc<AtomicBool>,
    /// Флаг отмены, общий с драйвером процесса: прерывает `wait_ready`.
    cancel: Arc<AtomicBool>,
}

impl SupervisorHandle {
    /// Остановить ядро и завершить надзор. Не блокирует.
    pub fn stop(&self) {
        // Флаг раньше команды: ожидание ready замечает его в пределах опроса.
        self.cancel.store(true, Ordering::SeqCst);
        let _ = self.tx.send(Command::Stop);
    }

    /// Ручной «Перезапустить» (после RateLimited или ошибки запуска).
    pub fn manual_restart(&self) {
        let _ = self.tx.send(Command::ManualRestart);
    }

    /// Надзор закончен: ядро остановлено (или его не было).
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }
}

/// Поднимает флаг «надзор закончен» при любом выходе из потока, в том числе по панике.
struct StoppedFlag(Arc<AtomicBool>);

impl Drop for StoppedFlag {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

/// Запустить надзирателя в отдельном потоке. Процесс ядра создаётся внутри:
/// он держит сырые хэндлы (не `Send`), а `PDEATHSIG` на Unix привязан к потоку,
/// вызвавшему spawn, — поток живёт, пока живёт оболочка.
pub fn spawn_supervisor<O, F>(mut factory: F, mut observer: O) -> io::Result<SupervisorHandle>
where
    O: Observer + Send + 'static,
    F: FnMut() -> Result<CoreSpawnConfig, String> + Send + 'static,
{
    let (tx, rx) = channel();
    let stopped = Arc::new(AtomicBool::new(false));
    let flag = StoppedFlag(Arc::clone(&stopped));
    let cancel = Arc::new(AtomicBool::new(false));
    let process_cancel = Arc::clone(&cancel);
    thread::Builder::new()
        .name("lavray-core-supervisor".to_owned())
        .spawn(move || {
            let _flag = flag;
            let process = RealCoreProcess::new().with_cancel(process_cancel);
            let mut sup = CoreSupervisor::new(process, SystemClock);
            let mut waiter = ChannelWaiter(rx);
            run(
                &mut sup,
                &mut factory,
                &mut observer,
                &mut waiter,
                &mut OsJitter,
            );
        })?;
    Ok(SupervisorHandle {
        tx,
        stopped,
        cancel,
    })
}

#[cfg(test)]
mod tests;
