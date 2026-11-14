// SPDX-License-Identifier: GPL-3.0-only

//! Тесты цикла надзора ядра.

use super::*;
use crate::coreproc::backoff::FixedJitter;
use crate::coreproc::teardown::{ProbeOutcome, StaleResource, TeardownReport};
use crate::coreproc::{
    CoreProcessError, MockClock, MockCoreProcess, BACKOFF_RESET_AFTER, RESTART_SHUTDOWN_TOTAL,
};
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

#[derive(Default)]
struct Events {
    states: Vec<CoreState>,
    tokens: Vec<String>,
    failures: Vec<Failure>,
    unconfirmed: Vec<String>,
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
    fn on_teardown_unconfirmed(&mut self, detail: &str) {
        self.0.borrow_mut().unconfirmed.push(detail.to_owned());
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
            agent_token: None,
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
/// «Перезапустить» выводит из `RateLimited`; токен у каждого запуска новый;
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

/// Ядро не стартует: 4 попытки с паузами 1/2/4/8 с, затем `RateLimited`.
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

/// Stop во время ожидания ready: не сбой запуска — ни `SpawnErr`, ни ретрая,
/// ни нового spawn; ровно один shutdown и обычный Stopped.
#[test]
fn stop_during_the_ready_wait_is_a_cancel_not_a_retry() {
    let process = MockCoreProcess {
        ready_results: vec![Err(CoreProcessError::Cancelled)],
        ..MockCoreProcess::default()
    };
    let out = simulate(process, 0, |_| panic!("ожидание команд не нужно"));
    let p = out.sup.process();
    assert_eq!((p.spawn_calls.len(), p.kill_calls.len()), (1, 1));
    assert_eq!(
        out.events.states,
        [CoreState::Spawning, CoreState::Stopping, CoreState::Stopped]
    );
    assert!(out.events.failures.is_empty() && out.events.tokens.is_empty());
}

/// READY выиграл гонку у Stop: после второй проверки отмены endpoint и токены
/// не публикуются (`on_ready`/`on_agent_token`), состояние Ready не объявлено.
#[test]
fn stop_that_wins_the_race_against_ready_publishes_nothing() {
    let process = MockCoreProcess {
        cancel_during_ready: true,
        ..MockCoreProcess::default()
    };
    let out = simulate(process, 0, |_| panic!("ожидание команд не нужно"));
    assert!(out.events.tokens.is_empty(), "on_ready после Stop");
    assert!(!out.events.saw(CoreState::Ready));
    let p = out.sup.process();
    assert_eq!((p.spawn_calls.len(), p.kill_calls.len()), (1, 1));
    assert_eq!(out.events.states.last(), Some(&CoreState::Stopped));
}

fn report_with(outcome: ProbeOutcome) -> TeardownReport {
    let mut findings: Vec<_> = StaleResource::ALL
        .iter()
        .map(|&r| (r, ProbeOutcome::Clean))
        .collect();
    findings[1].1 = outcome;
    TeardownReport::from_findings(findings)
}

/// Процесс остановлен → `Stopped`; но при Unchecked/Stale/частичном отчёте
/// отметки «сеть проверена» нет, есть предупреждение (не сбой запуска), а после
/// reset новый spawn возможен, как раньше.
#[test]
fn unconfirmed_teardown_stops_without_the_verified_mark() {
    let partial =
        TeardownReport::from_findings(vec![(StaleResource::TunAdapter, ProbeOutcome::Clean)]);
    let cases = [
        (report_with(ProbeOutcome::Unchecked), "routes: unchecked"),
        (
            report_with(ProbeOutcome::Stale("r".into())),
            "routes: stale: r",
        ),
        (partial, "нет пробы"),
    ];
    for (report, expected) in cases {
        let process = MockCoreProcess {
            teardown_report: Some(report),
            ..MockCoreProcess::default()
        };
        let mut polls = 0;
        let out = simulate(process, 0, |_| {
            polls += 1;
            (polls == 2).then_some(Command::Stop)
        });
        assert_eq!(
            out.events.states.last(),
            Some(&CoreState::Stopped),
            "{expected}"
        );
        assert!(!out.sup.network_verified(), "{expected}");
        assert!(
            out.events.unconfirmed[0].contains(expected),
            "{:?}",
            out.events.unconfirmed
        );
        assert!(out.events.failures.is_empty(), "предупреждение, не сбой");
        assert_eq!(out.sup.process().kill_calls.len(), 1);
        let mut sup = out.sup;
        sup.reset().unwrap();
        sup.start(&spawn_config()).unwrap();
        assert_eq!(sup.process().spawn_calls.len(), 2, "новый spawn после Stop");
    }
}

fn spawn_config() -> CoreSpawnConfig {
    CoreSpawnConfig {
        binary: PathBuf::from("lavray-core"),
        listen_socket: PathBuf::from("127.0.0.1:0"),
        data_dir: PathBuf::from("data"),
        auth_token: SecretToken::from_base64url("A".repeat(43)).unwrap(),
        agent_token: None,
        extra_args: Vec::new(),
    }
}

/// Все пробы Clean → Stopped и отметка «сеть проверена», без предупреждений.
#[test]
fn clean_teardown_marks_the_network_verified() {
    let mut polls = 0;
    let out = simulate(MockCoreProcess::default(), 0, |_| {
        polls += 1;
        (polls == 2).then_some(Command::Stop)
    });
    assert_eq!(out.events.states.last(), Some(&CoreState::Stopped));
    assert!(out.sup.network_verified());
    assert!(out.events.unconfirmed.is_empty());
}

/// `ManualRestart` из `RateLimited` не зависит от отметки: spawn происходит.
#[test]
fn manual_restart_does_not_need_the_verified_mark() {
    let mut sup = CoreSupervisor::new(MockCoreProcess::default(), MockClock::at(Instant::now()));
    let cfg = spawn_config();
    sup.start(&cfg).unwrap();
    sup.wait_ready().unwrap();
    for _ in 0..3 {
        sup.notify_unexpected_exit().ok();
        if sup.state() == CoreState::RateLimited {
            break;
        }
        sup.restart_after_crash(&cfg).unwrap();
        sup.wait_ready().unwrap();
    }
    assert_eq!(sup.state(), CoreState::RateLimited);
    assert!(!sup.network_verified());
    assert_eq!(sup.manual_restart(&cfg).unwrap(), CoreState::Spawning);
}

/// Не удался kill — сеть не проверяем и `Stopped` не объявляем.
#[test]
fn a_failed_kill_is_not_confirmed_either() {
    let process = MockCoreProcess {
        kill_results: vec![Err(CoreProcessError::Kill("жив".to_owned()))],
        ..MockCoreProcess::default()
    };
    let mut polls = 0;
    let out = simulate(process, 0, |_| {
        polls += 1;
        (polls == 2).then_some(Command::Stop)
    });
    assert!(!out.events.saw(CoreState::Stopped), "kill не удался");
    assert!(out.events.unconfirmed[0].contains("ядро не остановлено"));
    assert_eq!(out.sup.process().teardown_calls, 0, "сеть не проверяли");
}

/// «Перезапустить» на здоровом ядре: остановка той же лестницей, новый запуск с
/// новым токеном; не крах (нет `Crashed`, счётчик крахов 0), `Stopped` только
/// в конце, чистота сети проверена, сбоев нет.
#[test]
fn restart_on_a_healthy_core_relaunches_without_a_crash() {
    let mut asked = false;
    let out = simulate(MockCoreProcess::default(), 0, |events| {
        if events.tokens.len() >= 2 {
            Some(Command::Stop)
        } else if events.saw(CoreState::Ready) && !asked {
            asked = true;
            Some(Command::ManualRestart)
        } else {
            None
        }
    });
    assert_eq!(out.sup.process().spawn_calls.len(), 2);
    assert_eq!(out.events.tokens.len(), 2);
    assert_ne!(out.events.tokens[0], out.events.tokens[1], "токен новый");
    assert!(!out.events.saw(CoreState::Crashed));
    assert_eq!(out.sup.crashes_in_window(), 0);
    assert!(out.events.failures.is_empty(), "{:?}", out.events.failures);
    let states = [
        CoreState::Spawning,
        CoreState::Ready,
        CoreState::Stopping,
        CoreState::Spawning,
        CoreState::Ready,
        CoreState::Stopping,
        CoreState::Stopped,
    ];
    assert_eq!(out.events.states, states);
    assert_eq!(
        out.sup.process().kill_calls,
        [RESTART_SHUTDOWN_TOTAL, GRACEFUL_SHUTDOWN_TOTAL],
        "перезапуск — укороченная лестница, Stop — обычная"
    );
    assert_eq!(out.sup.crashes_in_window(), 0);
    assert_eq!(out.sup.process().teardown_calls, 2);
}

/// Не остановившееся ядро: предупреждение, обычный ретрай запуска, без крахов.
#[test]
fn restart_with_a_failed_kill_retries_the_spawn() {
    let process = MockCoreProcess {
        kill_results: vec![Err(CoreProcessError::Spawn("kill".to_owned()))],
        ..MockCoreProcess::default()
    };
    let mut asked = false;
    let out = simulate(process, 0, |events| {
        if events.tokens.len() >= 2 {
            Some(Command::Stop)
        } else if events.saw(CoreState::Ready) && !asked {
            asked = true;
            Some(Command::ManualRestart)
        } else {
            None
        }
    });
    assert_eq!(out.events.unconfirmed.len(), 1);
    assert!(!out.events.saw(CoreState::Crashed));
    assert_eq!(out.sup.crashes_in_window(), 0, "это не крах");
    assert!(
        out.events
            .failures
            .iter()
            .any(|f| f.message.contains("перезапуска")),
        "ошибка видна сразу: {:?}",
        out.events.failures
    );
    assert_eq!(out.sup.process().spawn_calls.len(), 2);
}

/// Ожидание с очередью команд: так в тесте «пришло, пока цикл был занят».
struct QueueWaiter {
    clock: MockClock,
    queue: std::collections::VecDeque<Command>,
    polls: usize,
    stop_after_polls: usize,
    /// Команды, пришедшие во время первой команды (пока цикл занят перезапуском).
    late: Vec<Command>,
}

impl Waiter for QueueWaiter {
    fn wait(&mut self, delay: Duration) -> Option<Command> {
        self.clock.advance(delay);
        self.polls += 1;
        if self.polls > self.stop_after_polls {
            return Some(Command::Stop);
        }
        let next = self.queue.pop_front();
        if self.polls == 1 {
            self.queue.extend(self.late.drain(..));
        }
        next
    }

    fn drain_restarts(&mut self) -> bool {
        let stop = self.queue.contains(&Command::Stop);
        self.queue.retain(|c| *c == Command::Stop);
        stop
    }
}

/// Прогон с очередью команд; `cancel_in_kill` — Stop пришёл во время остановки.
fn simulate_queue(
    process: MockCoreProcess,
    queue: &[Command],
    late: &[Command],
    stop_after_polls: usize,
) -> Outcome {
    let clock = MockClock::at(Instant::now());
    let mut sup = CoreSupervisor::new(process, clock.clone());
    let events = Rc::new(RefCell::new(Events::default()));
    let mut calls = 0usize;
    let mut factory = move || {
        calls += 1;
        Ok(CoreSpawnConfig {
            binary: PathBuf::from("lavray-core"),
            listen_socket: PathBuf::from("127.0.0.1:0"),
            data_dir: PathBuf::from("data"),
            auth_token: SecretToken::from_base64url(format!("{calls:A>43}")).unwrap(),
            agent_token: None,
            extra_args: Vec::new(),
        })
    };
    let mut waiter = QueueWaiter {
        clock,
        queue: queue.iter().copied().collect(),
        polls: 0,
        stop_after_polls,
        late: late.to_vec(),
    };
    run(
        &mut sup,
        &mut factory,
        &mut Recorder(Rc::clone(&events)),
        &mut waiter,
        &mut FixedJitter { value: 0.5 },
    );
    drop(waiter);
    let events = Rc::try_unwrap(events).ok().unwrap().into_inner();
    Outcome {
        sup,
        events,
        pauses: Vec::new(),
    }
}

/// Два «Перезапустить» подряд (двойной клик, повтор по таймауту): ровно один
/// перезапуск, второе выброшено при входе в наблюдение.
#[test]
fn a_double_restart_request_restarts_exactly_once() {
    let out = simulate_queue(
        MockCoreProcess::default(),
        &[Command::ManualRestart],
        &[Command::ManualRestart],
        4,
    );
    assert_eq!(out.sup.process().spawn_calls.len(), 2);
    assert_eq!(out.events.tokens.len(), 2);
}

/// «Перезапустить», пришедшее пока ядро поднималось (очередь не пуста ещё до
/// наблюдения), поднявшееся ядро не перезапускает.
#[test]
fn a_restart_queued_while_spawning_does_not_restart_the_new_core() {
    let out = simulate_queue(
        MockCoreProcess::default(),
        &[Command::ManualRestart],
        &[],
        3,
    );
    assert_eq!(out.sup.process().spawn_calls.len(), 1);
    assert_eq!(out.events.tokens.len(), 1);
}

/// Stop, ждущий в очереди вместе с перезапуском, не теряется.
#[test]
fn a_stop_queued_next_to_restarts_survives_the_drain() {
    let out = simulate_queue(
        MockCoreProcess::default(),
        &[Command::ManualRestart, Command::Stop],
        &[],
        99,
    );
    assert_eq!(out.sup.process().spawn_calls.len(), 1);
    assert_eq!(out.events.states.last(), Some(&CoreState::Stopped));
}

/// Stop во время перезапуска: нового ядра нет, конечное состояние Stopped.
#[test]
fn stop_during_a_restart_does_not_spawn_a_second_core() {
    let mut asked = false;
    let process = MockCoreProcess {
        cancel_during_kill: true,
        ..MockCoreProcess::default()
    };
    let out = simulate(process, 0, |events| {
        (events.saw(CoreState::Ready) && !std::mem::replace(&mut asked, true))
            .then_some(Command::ManualRestart)
    });
    assert_eq!(out.sup.process().spawn_calls.len(), 1, "второго ядра нет");
    assert_eq!(out.events.states.last(), Some(&CoreState::Stopped));
    assert_eq!(out.sup.state(), CoreState::Stopped);
    assert!(!out.events.saw(CoreState::Crashed));
}

/// Крах ровно в момент запроса перезапуска — обычный крах: счётчик, сообщение.
#[test]
fn a_crash_at_the_moment_of_the_restart_request_is_a_normal_crash() {
    let process = MockCoreProcess {
        alive_results: vec![false],
        ..MockCoreProcess::default()
    };
    let mut asked = false;
    let out = simulate(process, 0, |events| {
        if events.tokens.len() >= 2 {
            Some(Command::Stop)
        } else if events.saw(CoreState::Ready) && !std::mem::replace(&mut asked, true) {
            Some(Command::ManualRestart)
        } else {
            None
        }
    });
    assert!(out.events.saw(CoreState::Crashed));
    assert!(out
        .events
        .failures
        .iter()
        .any(|f| f.message.contains("неожиданно")));
    assert_eq!(out.sup.process().spawn_calls.len(), 2);
}
