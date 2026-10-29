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
    Clock, CoreEndpoint, CoreProcess, CoreSpawnConfig, CoreState, CoreSupervisor, CrashDecision,
    SecretToken, SupervisorError, SystemClock, GRACEFUL_SHUTDOWN_TOTAL, SPAWN_ATTEMPTS_TOTAL,
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
    fn on_failure(&mut self, failure: &Failure);
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
            Ok(endpoint) => {
                if let Some(config) = &self.config {
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

    /// Остановка по команде: лестница §5 для живого ядра, иначе идемпотентный kill.
    fn stop(&mut self) {
        if matches!(
            self.sup.state(),
            CoreState::Spawning | CoreState::Ready | CoreState::Connected
        ) {
            let _ = self.sup.request_stop();
            self.publish(self.sup.state());
            let _ = self.sup.mark_teardown_verified();
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
}

impl SupervisorHandle {
    /// Остановить ядро и завершить надзор. Не блокирует.
    pub fn stop(&self) {
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
    thread::Builder::new()
        .name("lavray-core-supervisor".to_owned())
        .spawn(move || {
            let _flag = flag;
            let mut sup = CoreSupervisor::new(RealCoreProcess::new(), SystemClock);
            let mut waiter = ChannelWaiter(rx);
            run(
                &mut sup,
                &mut factory,
                &mut observer,
                &mut waiter,
                &mut OsJitter,
            );
        })?;
    Ok(SupervisorHandle { tx, stopped })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coreproc::backoff::FixedJitter;
    use crate::coreproc::{CoreProcessError, MockClock, MockCoreProcess, BACKOFF_RESET_AFTER};
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::rc::Rc;

    #[derive(Default)]
    struct Events {
        states: Vec<CoreState>,
        tokens: Vec<String>,
        failures: Vec<Failure>,
    }

    impl Events {
        fn saw(&self, state: CoreState) -> bool {
            self.states.contains(&state)
        }
    }

    struct Recorder(Rc<RefCell<Events>>);

    impl Observer for Recorder {
        fn on_state(&mut self, state: CoreState) {
            self.0.borrow_mut().states.push(state);
        }
        fn on_ready(&mut self, _endpoint: &CoreEndpoint, token: &SecretToken) {
            self.0.borrow_mut().tokens.push(token.expose().to_owned());
        }
        fn on_failure(&mut self, failure: &Failure) {
            self.0.borrow_mut().failures.push(failure.clone());
        }
    }

    /// Ожидание без сна: двигает управляемые часы, пишет паузы, команду выбирает `decide`.
    struct ScriptWaiter<D> {
        clock: MockClock,
        waits: Vec<Duration>,
        events: Rc<RefCell<Events>>,
        decide: D,
    }

    impl<D: FnMut(&Events) -> Option<Command>> Waiter for ScriptWaiter<D> {
        fn wait(&mut self, delay: Duration) -> Option<Command> {
            self.waits.push(delay);
            assert!(self.waits.len() < 20_000, "цикл не останавливается");
            self.clock.advance(delay);
            (self.decide)(&self.events.borrow())
        }
    }

    struct Outcome {
        sup: CoreSupervisor<MockCoreProcess, MockClock>,
        events: Events,
        /// Паузы backoff: без опроса живости и без ожидания ручного перезапуска.
        pauses: Vec<Duration>,
    }

    /// Прогон цикла на моке; токен у каждого запуска свой (по номеру вызова
    /// фабрики), первые `factory_failures` вызовов фабрики возвращают ошибку.
    fn simulate(
        process: MockCoreProcess,
        factory_failures: usize,
        decide: impl FnMut(&Events) -> Option<Command>,
    ) -> Outcome {
        let clock = MockClock::at(Instant::now());
        let mut sup = CoreSupervisor::new(process, clock.clone());
        let events = Rc::new(RefCell::new(Events::default()));
        let mut calls = 0usize;
        let mut factory = move || {
            calls += 1;
            if calls <= factory_failures {
                return Err("ядро lavray-core не найдено".to_owned());
            }
            Ok(CoreSpawnConfig {
                binary: PathBuf::from("lavray-core"),
                listen_socket: PathBuf::from("127.0.0.1:0"),
                data_dir: PathBuf::from("data"),
                auth_token: SecretToken::from_base64url(format!("{calls:A>43}")).unwrap(),
                extra_args: Vec::new(),
            })
        };
        let mut waiter = ScriptWaiter {
            clock,
            waits: Vec::new(),
            events: Rc::clone(&events),
            decide,
        };
        run(
            &mut sup,
            &mut factory,
            &mut Recorder(Rc::clone(&events)),
            &mut waiter,
            &mut FixedJitter { value: 0.5 },
        );
        let pauses = waiter
            .waits
            .iter()
            .copied()
            .filter(|d| *d != POLL_INTERVAL && *d != AWAIT_MANUAL_WAIT)
            .collect();
        drop(waiter);
        let events = Rc::try_unwrap(events).ok().unwrap().into_inner();
        Outcome {
            sup,
            events,
            pauses,
        }
    }

    fn secs(list: &[u64]) -> Vec<Duration> {
        list.iter().copied().map(Duration::from_secs).collect()
    }

    /// A2-11: ядро, умирающее сразу после READY, перезапускается с растущей
    /// паузой 1 с → 2 с и после 3 падений за минуту больше не перезапускается
    /// (раньше пауза сбрасывалась в 1 с, и перезапуски шли вечно); ручной
    /// «Перезапустить» выводит из RateLimited; токен у каждого запуска новый;
    /// к сбою прикладывается хвост кольца логов ядра.
    #[test]
    fn crash_loop_stops_after_three_crashes_and_manual_restart_resumes() {
        let process = MockCoreProcess {
            alive_results: vec![false; 20],
            log_lines: (1..=100).map(|i| format!("line {i}")).collect(),
            ..MockCoreProcess::default()
        };
        let mut asked = false;
        let out = simulate(process, 0, |events| {
            if events.tokens.len() >= 4 {
                Some(Command::Stop)
            } else if events.saw(CoreState::RateLimited) && !asked {
                asked = true;
                Some(Command::ManualRestart)
            } else {
                None
            }
        });

        assert_eq!(
            out.pauses,
            secs(&[1, 2]),
            "пауза растёт, а не «1 с каждый раз»"
        );
        // 3 запуска до лимита + 1 после ручного перезапуска
        assert_eq!(out.sup.process().spawn_calls.len(), 4);
        let unique: std::collections::HashSet<_> = out.events.tokens.iter().collect();
        assert_eq!(unique.len(), 4, "токены не повторяются");
        let tail = &out.events.failures[0].log_tail;
        assert_eq!(
            (tail.len(), tail.last().map(String::as_str)),
            (FAILURE_LOG_LINES, Some("line 100"))
        );
    }

    /// Ядро не стартует: 4 попытки с паузами 1/2/4/8 с, затем RateLimited.
    #[test]
    fn spawn_failures_back_off_and_end_in_rate_limited() {
        let fail = || Err(CoreProcessError::Spawn("нет такого файла".to_owned()));
        let process = MockCoreProcess {
            spawn_results: vec![fail(), fail(), fail(), fail()],
            ..MockCoreProcess::default()
        };
        let out = simulate(process, 0, |events| {
            events.saw(CoreState::RateLimited).then_some(Command::Stop)
        });
        assert_eq!(out.sup.process().spawn_calls.len(), 4);
        assert_eq!(out.pauses, secs(&[1, 2, 4, 8]));
        assert!(out.events.tokens.is_empty(), "ядро так и не стало готовым");
    }

    /// «Остановить» прерывает наблюдение сразу и запускает лестницу §5.
    #[test]
    fn stop_command_runs_the_graceful_ladder() {
        let mut polls = 0;
        let out = simulate(MockCoreProcess::default(), 0, |_| {
            polls += 1;
            (polls == 3).then_some(Command::Stop)
        });
        assert_eq!(out.sup.process().kill_calls, [GRACEFUL_SHUTDOWN_TOTAL]);
        let states = [
            CoreState::Spawning,
            CoreState::Ready,
            CoreState::Stopping,
            CoreState::Stopped,
        ];
        assert_eq!(out.events.states, states);
    }

    /// Нет бинарника ядра: сбой передан наблюдателю, запуска нет; после ручного
    /// «Перезапустить» ядро стартует.
    #[test]
    fn missing_core_binary_waits_for_a_manual_restart() {
        let mut asked = false;
        let out = simulate(MockCoreProcess::default(), 1, |events| {
            if !events.tokens.is_empty() {
                Some(Command::Stop)
            } else if !asked {
                asked = true;
                Some(Command::ManualRestart)
            } else {
                None
            }
        });
        assert_eq!(
            out.events.failures[0].message,
            "ядро lavray-core не найдено"
        );
        assert_eq!(out.events.states[0], CoreState::SpawnErr);
        assert_eq!(out.sup.process().spawn_calls.len(), 1);
    }

    /// Стабильная работа ≥ 300 с сбрасывает эскалацию: следующий крах снова ждёт 1 с.
    #[test]
    fn stable_uptime_resets_the_backoff_escalation() {
        let polls = (BACKOFF_RESET_AFTER.as_millis() / POLL_INTERVAL.as_millis()) as usize + 2;
        let mut alive = vec![false]; // поколение 1 падает сразу
        alive.extend(std::iter::repeat_n(true, polls)); // поколение 2 живёт дольше сброса
        alive.push(false);
        let process = MockCoreProcess {
            alive_results: alive,
            ..MockCoreProcess::default()
        };
        let out = simulate(process, 0, |events| {
            (events.tokens.len() >= 3).then_some(Command::Stop)
        });
        assert_eq!(
            out.pauses,
            secs(&[1, 1]),
            "после стабильной работы пауза снова 1 с"
        );
    }
}
