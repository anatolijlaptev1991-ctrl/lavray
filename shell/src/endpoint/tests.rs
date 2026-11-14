// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::coreproc::backoff::FixedJitter;
use crate::coreproc::runner::{run, Command, Waiter, POLL_INTERVAL};
use crate::coreproc::{
    CoreProcessError, CoreSpawnConfig, CoreSupervisor, MockClock, MockCoreProcess,
};
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

/// Что видел хост: события жизни ядра, сбои и состояния FSM.
#[derive(Default)]
struct Seen {
    log: Vec<String>,
    failures: Vec<Failure>,
    states: Vec<CoreState>,
    /// События агентского доступа: «up адрес токен» и «down».
    agent: Vec<String>,
}

/// Окружение, записывающее действия адаптера.
struct FakeHost(Rc<RefCell<Seen>>);

impl SupervisorHost for FakeHost {
    fn state_changed(&self, state: CoreState) {
        self.0.borrow_mut().states.push(state);
    }

    fn core_up(&self, endpoint: &EndpointEvent) {
        let line = format!("up {} {}", endpoint.url, endpoint.token);
        self.0.borrow_mut().log.push(line);
    }

    fn core_down(&self, reason: &str) {
        self.0.borrow_mut().log.push(format!("down {reason}"));
    }

    fn core_restarting(&self) {
        self.0.borrow_mut().log.push("restarting".to_owned());
    }

    fn spawn_failed(&self, reason: &str) {
        self.0
            .borrow_mut()
            .log
            .push(format!("spawn_failed {reason}"));
    }

    fn failure(&self, failure: &Failure) {
        self.0.borrow_mut().failures.push(failure.clone());
    }

    fn agent_core_up(&self, url: &str, agent_token: &str) {
        let line = format!("up {url} {agent_token}");
        self.0.borrow_mut().agent.push(line);
    }

    fn agent_core_down(&self) {
        self.0.borrow_mut().agent.push("down".to_owned());
    }
}

/// Ожидание без сна: двигает часы, пишет паузы и то, виден ли UI адрес ядра
/// в этот момент; остановку подаёт `quit` (получает число запусков ядра).
struct Script<Q> {
    clock: MockClock,
    hub: Arc<EndpointHub>,
    seen: Rc<RefCell<Seen>>,
    waits: Vec<(Duration, bool)>,
    quit: Q,
}

impl<Q: FnMut(&Seen) -> bool> Waiter for Script<Q> {
    fn wait(&mut self, delay: Duration) -> Option<Command> {
        self.waits.push((delay, self.hub.current().is_some()));
        assert!(self.waits.len() < 5_000, "цикл не останавливается");
        self.clock.advance(delay);
        (self.quit)(&self.seen.borrow()).then_some(Command::Stop)
    }
}

struct Outcome {
    hub: Arc<EndpointHub>,
    seen: Seen,
    waits: Vec<(Duration, bool)>,
}

fn ups(seen: &Seen) -> usize {
    seen.log.iter().filter(|l| l.starts_with("up ")).count()
}

/// Прогон `runner::run` с адаптером на моке процесса; токен у каждого
/// запуска свой (по номеру вызова фабрики), `quit` решает, когда выходить.
fn simulate(process: MockCoreProcess, quit: impl FnMut(&Seen) -> bool) -> Outcome {
    let hub = Arc::new(EndpointHub::default());
    let seen = Rc::new(RefCell::new(Seen::default()));
    let clock = MockClock::at(Instant::now());
    let mut sup = CoreSupervisor::new(process, clock.clone());
    let mut calls = 0usize;
    let mut factory = move || {
        calls += 1;
        Ok(CoreSpawnConfig {
            binary: PathBuf::from("lavray-core"),
            listen_socket: PathBuf::from("127.0.0.1:0"),
            data_dir: PathBuf::from("data"),
            auth_token: SecretToken::from_base64url(token(calls)).unwrap(),
            agent_token: Some(SecretToken::from_base64url(agent_token(calls)).unwrap()),
            extra_args: Vec::new(),
        })
    };
    let mut waiter = Script {
        clock,
        hub: Arc::clone(&hub),
        seen: Rc::clone(&seen),
        waits: Vec::new(),
        quit,
    };
    let mut observer = HostObserver::new(Arc::clone(&hub), FakeHost(Rc::clone(&seen)));
    run(
        &mut sup,
        &mut factory,
        &mut observer,
        &mut waiter,
        &mut FixedJitter { value: 0.5 },
    );
    drop(observer);
    let waits = std::mem::take(&mut waiter.waits);
    drop(waiter);
    let seen = Rc::try_unwrap(seen).ok().unwrap().into_inner();
    Outcome { hub, seen, waits }
}

fn endpoint(url: &str) -> CoreEndpoint {
    CoreEndpoint {
        transport_url: url.to_owned(),
    }
}

fn token(n: usize) -> String {
    format!("{n:A>43}")
}

fn agent_token(n: usize) -> String {
    format!("{n:G>43}")
}

/// Ждёт первого запуска, подаёт один «Перезапустить», после второго выходит.
struct RestartOnce {
    clock: MockClock,
    seen: Rc<RefCell<Seen>>,
    sent: bool,
}

impl Waiter for RestartOnce {
    fn wait(&mut self, delay: Duration) -> Option<Command> {
        self.clock.advance(delay);
        let ups = ups(&self.seen.borrow());
        if ups >= 2 {
            Some(Command::Stop)
        } else if ups == 1 && !self.sent {
            self.sent = true;
            Some(Command::ManualRestart)
        } else {
            None
        }
    }
}

/// Перезапуск здорового ядра: UI получает «адреса нет» (`restarting`, а не
/// `down` краха), kill switch (`core_down`) не вызывается, после READY — новый
/// адрес; «ядро упало» нигде не записано.
#[test]
fn a_healthy_restart_reports_no_address_but_is_not_a_crash() {
    let hub = Arc::new(EndpointHub::default());
    let seen = Rc::new(RefCell::new(Seen::default()));
    let clock = MockClock::at(Instant::now());
    let process = MockCoreProcess {
        ready_results: vec![
            Ok(endpoint("tcp://127.0.0.1:50001")),
            Ok(endpoint("tcp://127.0.0.1:50002")),
        ],
        ..MockCoreProcess::default()
    };
    let mut sup = CoreSupervisor::new(process, clock.clone());
    let mut calls = 0usize;
    let mut factory = move || {
        calls += 1;
        Ok(CoreSpawnConfig {
            binary: PathBuf::from("lavray-core"),
            listen_socket: PathBuf::from("127.0.0.1:0"),
            data_dir: PathBuf::from("data"),
            auth_token: SecretToken::from_base64url(token(calls)).unwrap(),
            agent_token: None,
            extra_args: Vec::new(),
        })
    };
    let mut waiter = RestartOnce {
        clock,
        seen: Rc::clone(&seen),
        sent: false,
    };
    let mut observer = HostObserver::new(Arc::clone(&hub), FakeHost(Rc::clone(&seen)));
    run(
        &mut sup,
        &mut factory,
        &mut observer,
        &mut waiter,
        &mut FixedJitter { value: 0.5 },
    );
    drop(observer);
    drop(waiter);
    let seen = Rc::try_unwrap(seen).ok().unwrap().into_inner();
    assert_eq!(
        seen.log,
        [
            format!("up tcp://127.0.0.1:50001 {}", token(1)),
            "restarting".to_owned(),
            format!("up tcp://127.0.0.1:50002 {}", token(2)),
        ]
    );
    assert!(!seen.states.contains(&CoreState::Crashed));
    assert!(seen.failures.is_empty());
    assert_eq!(sup.crashes_in_window(), 0);
}

#[test]
fn restarted_core_gets_new_endpoint_and_proxy_is_released_in_between() {
    // ядро №1 умирает на 3-й проверке живости, ядро №2 живёт до выхода
    let process = MockCoreProcess {
        ready_results: vec![
            Ok(endpoint("tcp://127.0.0.1:50001")),
            Ok(endpoint("tcp://127.0.0.1:50002")),
        ],
        alive_results: vec![true, true, false],
        ..MockCoreProcess::default()
    };
    let out = simulate(process, |seen| ups(seen) >= 2);
    assert_eq!(
        out.seen.log,
        [
            format!("up tcp://127.0.0.1:50001 {}", token(1)),
            format!("down {REASON_CORE_DIED}"),
            format!("up tcp://127.0.0.1:50002 {}", token(2)),
        ],
        "прокси снимается (down) ДО запуска нового ядра; у каждого запуска свой токен"
    );
    let pause = out.waits.iter().find(|(d, _)| *d != POLL_INTERVAL).unwrap();
    assert!(
        !pause.1,
        "пока ядро мертво и ждёт перезапуска, адреса в хабе нет"
    );
    assert!(
        out.seen.states.contains(&CoreState::Crashed),
        "хост видит и сами состояния FSM"
    );
    assert!(
        out.seen.failures[0]
            .message
            .contains("неожиданно завершилось"),
        "причина смерти и хвост логов уходят в диагностику"
    );
    assert!(out.hub.current().is_none(), "после выхода адреса нет");
    assert!(
        out.hub.wait_ready(Duration::from_secs(5)).is_none(),
        "после выхода ожидающие не ждут: хаб закрыт"
    );
}

#[test]
fn agent_token_follows_the_core_and_main_token_never_reaches_the_agent_file() {
    let process = MockCoreProcess {
        ready_results: vec![
            Ok(endpoint("tcp://127.0.0.1:50001")),
            Ok(endpoint("tcp://127.0.0.1:50002")),
        ],
        alive_results: vec![true, true, false],
        ..MockCoreProcess::default()
    };
    let out = simulate(process, |seen| ups(seen) >= 2);
    // запуск → смерть (файл убирается до нового запуска) → запуск → выход
    // (Stopping, Stopped и конец надзора убирают файл по разу: повтор безвреден)
    assert_eq!(
        out.seen.agent,
        [
            format!("up tcp://127.0.0.1:50001 {}", agent_token(1)),
            "down".to_owned(),
            format!("up tcp://127.0.0.1:50002 {}", agent_token(2)),
            "down".to_owned(),
            "down".to_owned(),
            "down".to_owned(),
        ],
        "у каждого запуска свой агентский токен; на остановке и выходе файл убирается"
    );
    for line in &out.seen.agent {
        assert!(
            !line.contains(&token(1)) && !line.contains(&token(2)),
            "основной токен ядра агентам не отдаётся: {line}"
        );
    }
}

#[test]
fn exit_closes_the_hub_without_reporting_the_core_as_dead() {
    let out = simulate(MockCoreProcess::default(), |seen| ups(seen) >= 1);
    assert_eq!(out.seen.log.len(), 1, "только запуск: {:?}", out.seen.log);
    assert!(
        out.seen
            .states
            .ends_with(&[CoreState::Stopping, CoreState::Stopped]),
        "ядро остановлено лестницей §5: {:?}",
        out.seen.states
    );
    assert!(out.hub.current().is_none());
    assert!(out.hub.wait_ready(Duration::from_secs(5)).is_none());
}

#[test]
fn spawn_failures_reach_the_host_and_never_publish_an_address() {
    let fail = || Err(CoreProcessError::Spawn("ядро изменено".to_owned()));
    let process = MockCoreProcess {
        spawn_results: vec![fail(), fail(), fail(), fail()],
        ..MockCoreProcess::default()
    };
    // 4 неудачных запуска подряд ведут в RateLimited (T-56); дальше цикл
    // ждёт ручного перезапуска, и тест подаёт выход.
    let out = simulate(process, |seen| {
        seen.states.contains(&CoreState::RateLimited)
    });
    assert!(
        out.seen.log.iter().all(|l| l.starts_with("spawn_failed ")),
        "ядро не поднялось: {:?}",
        out.seen.log
    );
    assert!(
        out.seen.log[0].contains("ядро изменено"),
        "причина доходит до UI: {}",
        out.seen.log[0]
    );
    assert_eq!(out.seen.failures.len(), out.seen.log.len());
    assert!(out.hub.current().is_none());
}

#[test]
fn wait_ready_blocks_until_core_is_published_then_follows_restarts() {
    let hub = Arc::new(EndpointHub::default());
    let publisher = Arc::clone(&hub);
    let started = Instant::now();
    let thread = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        publisher.publish("tcp://127.0.0.1:50001".into(), "tokenA".into());
    });
    let first = hub.wait_ready(Duration::from_secs(10)).unwrap();
    thread.join().unwrap();
    assert_eq!(first.url, "tcp://127.0.0.1:50001");
    assert!(
        started.elapsed() >= Duration::from_millis(100),
        "ответ пришёл раньше ядра"
    );

    hub.clear();
    assert!(
        hub.wait_ready(Duration::from_millis(30)).is_none(),
        "ядро мертво"
    );
    hub.publish("tcp://127.0.0.1:50002".into(), "tokenB".into());
    assert_eq!(
        hub.wait_ready(Duration::from_secs(1)).unwrap().token,
        "tokenB"
    );
}
