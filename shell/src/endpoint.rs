// SPDX-License-Identifier: GPL-3.0-only

//! Адрес и токен ядра для UI + адаптер надзирателя (T-03, T-56).
//!
//! Упавшее ядро оболочка поднимает на НОВОМ порту с НОВЫМ токеном. UI узнаёт
//! об этом командой `core_endpoint` (ждёт готовности ядра) и событием
//! `core-endpoint` (при каждом запуске и при смерти ядра; пустой `url` =
//! «ядра нет»). При смерти ядра возвращается системный прокси (shell-lifecycle
//! §6). Цикл надзора — `coreproc::runner` (T-56: backoff, предел рестартов);
//! [`HostObserver`] переводит его события в публикацию адреса, события UI и
//! возврат прокси. Модуль не зависит от Tauri: адаптер проверяется на моке
//! процесса.

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::coreproc::runner::{Failure, Observer};
use crate::coreproc::{CoreEndpoint, CoreState, SecretToken};

/// Имя события Tauri с адресом ядра.
pub const CORE_ENDPOINT_EVENT: &str = "core-endpoint";
/// Сколько `core_endpoint` ждёт готовности ядра (больше `T_SPAWN` = 10 с).
pub const ENDPOINT_WAIT: Duration = Duration::from_secs(15);
/// `last_error`, когда ядро умерло само.
pub const REASON_CORE_DIED: &str = "ядро неожиданно завершилось — перезапуск";

/// Содержимое события `core-endpoint` и ответа `core_endpoint`.
#[derive(Clone, PartialEq, Eq, serde::Serialize)]
pub struct EndpointEvent {
    /// Адрес из READY-строки (`tcp://127.0.0.1:<порт>`); пусто — ядра нет.
    pub url: String,
    /// Bearer-токен этого запуска; пусто, когда `url` пуст.
    pub token: String,
}

impl EndpointEvent {
    /// «Ядро остановлено, ждите следующее событие».
    #[must_use]
    pub fn down() -> Self {
        Self {
            url: String::new(),
            token: String::new(),
        }
    }
}

#[derive(Default)]
struct Slot {
    current: Option<EndpointEvent>,
    closed: bool,
}

/// Текущий адрес ядра: надзиратель публикует, `core_endpoint` ждёт.
#[derive(Default)]
pub struct EndpointHub {
    slot: Mutex<Slot>,
    changed: Condvar,
}

impl EndpointHub {
    fn lock(&self) -> MutexGuard<'_, Slot> {
        self.slot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Ядро запущено: запомнить адрес и разбудить ожидающих.
    pub fn publish(&self, url: String, token: String) -> EndpointEvent {
        let event = EndpointEvent { url, token };
        self.lock().current = Some(event.clone());
        self.changed.notify_all();
        event
    }

    /// Ядро умерло: до следующего `publish` ожидающие ждут.
    pub fn clear(&self) {
        self.lock().current = None;
    }

    /// Выход из приложения: ядра больше не будет, ожидающие получают `None`.
    pub fn close(&self) {
        let mut slot = self.lock();
        slot.current = None;
        slot.closed = true;
        drop(slot);
        self.changed.notify_all();
    }

    /// Текущий адрес без ожидания.
    pub fn current(&self) -> Option<EndpointEvent> {
        self.lock().current.clone()
    }

    /// Дождаться ядра, но не дольше `timeout`. `None` — не поднялось за срок
    /// или приложение закрывается.
    pub fn wait_ready(&self, timeout: Duration) -> Option<EndpointEvent> {
        let deadline = Instant::now() + timeout;
        let mut slot = self.lock();
        loop {
            if let Some(event) = &slot.current {
                return Some(event.clone());
            }
            let left = deadline.checked_duration_since(Instant::now())?;
            if slot.closed || left.is_zero() {
                return None;
            }
            slot = self
                .changed
                .wait_timeout(slot, left)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
    }
}

/// Окружение надзирателя: состояние оболочки, события UI, системный прокси.
pub trait SupervisorHost {
    /// Состояние FSM ядра изменилось (любое, в том числе Spawning и Stopping).
    fn state_changed(&self, state: CoreState);
    /// Ядро запущено: записать состояние, отправить UI событие.
    fn core_up(&self, endpoint: &EndpointEvent);
    /// Ядро умерло само: записать причину, отправить UI
    /// [`EndpointEvent::down`], вернуть системный прокси из снимка.
    fn core_down(&self, reason: &str);
    /// Ядро не запустилось (сборка конфигурации, spawn, ожидание READY).
    fn spawn_failed(&self, reason: &str);
    /// Любой сбой: причина и хвост кольца логов ядра для диагностики (T-56).
    fn failure(&self, failure: &Failure);
    /// Ядро запущено, и у него есть агентский токен (MCP): адрес и токен этого
    /// запуска. Основной токен ядра сюда не приходит.
    fn agent_core_up(&self, _url: &str, _agent_token: &str) {}
    /// Ядра больше нет (умерло, остановлено, выход): агентский токен недействителен.
    fn agent_core_down(&self) {}
}

/// Адаптер `coreproc::runner::Observer` к оболочке: публикует адрес и токен
/// в [`EndpointHub`], а хосту отдаёт события жизни ядра (T-03 поверх T-56).
pub struct HostObserver<H: SupervisorHost> {
    hub: Arc<EndpointHub>,
    host: H,
    /// Адрес опубликован: ядро готово и его ещё не потеряли.
    up: bool,
    /// Ядро только что умерло: ближайший сбой — сообщение о смерти, а не об
    /// ошибке запуска.
    death_pending: bool,
    /// Агентский токен запуска, который сейчас поднимается (MCP).
    agent_token: Option<String>,
}

impl<H: SupervisorHost> HostObserver<H> {
    pub fn new(hub: Arc<EndpointHub>, host: H) -> Self {
        Self {
            hub,
            host,
            up: false,
            death_pending: false,
            agent_token: None,
        }
    }
}

impl<H: SupervisorHost> Observer for HostObserver<H> {
    fn on_state(&mut self, state: CoreState) {
        self.host.state_changed(state);
        match state {
            CoreState::Ready | CoreState::Connected => {}
            // Выход из приложения: ядра больше не будет. Событие `down` и
            // возврат прокси здесь не нужны, выход делает это сам.
            CoreState::Stopping => {
                self.up = false;
                self.hub.clear();
                self.host.agent_core_down();
            }
            CoreState::Stopped => {
                self.up = false;
                self.hub.close();
                self.host.agent_core_down();
            }
            // Ядро было готово и перестало: убрать адрес, сообщить UI и
            // вернуть прокси ДО запуска нового ядра.
            _ => {
                if std::mem::take(&mut self.up) {
                    self.death_pending = true;
                    self.hub.clear();
                    // Агентский токен умершего ядра недействителен: файл с ним
                    // убирается до запуска нового ядра.
                    self.host.agent_core_down();
                    self.host.core_down(REASON_CORE_DIED);
                }
            }
        }
    }

    fn on_agent_token(&mut self, token: &SecretToken) {
        self.agent_token = Some(token.expose().to_owned());
    }

    fn on_ready(&mut self, endpoint: &CoreEndpoint, token: &SecretToken) {
        let event = self
            .hub
            .publish(endpoint.transport_url.clone(), token.expose().to_owned());
        self.up = true;
        self.death_pending = false;
        self.host.core_up(&event);
        if let Some(agent) = self.agent_token.take() {
            self.host.agent_core_up(&event.url, &agent);
        }
    }

    fn on_failure(&mut self, failure: &Failure) {
        self.host.failure(failure);
        if !std::mem::take(&mut self.death_pending) {
            self.host.spawn_failed(&failure.message);
        }
    }
}

impl<H: SupervisorHost> Drop for HostObserver<H> {
    /// Надзор закончен (выход или паника потока): ядра больше не будет,
    /// ожидающие `core_endpoint` получают `None`.
    fn drop(&mut self) {
        self.hub.close();
        self.host.agent_core_down();
    }
}

#[cfg(test)]
mod tests {
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
}
