//! Адрес и токен ядра для UI + цикл надзирателя (T-03).
//!
//! Упавшее ядро оболочка поднимает на НОВОМ порту с НОВЫМ токеном. UI узнаёт
//! об этом командой `core_endpoint` (ждёт готовности ядра) и событием
//! `core-endpoint` (при каждом запуске и при смерти ядра; пустой `url` =
//! «ядра нет»). При смерти ядра возвращается системный прокси (shell-lifecycle
//! §6). Модуль не зависит от Tauri: цикл проверяется на подставном процессе.

use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::coreproc::GRACEFUL_SHUTDOWN_TOTAL;

/// Имя события Tauri с адресом ядра.
pub const CORE_ENDPOINT_EVENT: &str = "core-endpoint";
/// Сколько `core_endpoint` ждёт готовности ядра (больше `T_SPAWN` = 10 с).
pub const ENDPOINT_WAIT: Duration = Duration::from_secs(15);
/// Период проверки «ядро живо».
pub const POLL_INTERVAL: Duration = Duration::from_millis(500);
/// Пауза перед первым перезапуском; дальше удваивается до `BACKOFF_MAX`.
pub const BACKOFF_START: Duration = Duration::from_secs(1);
/// Потолок паузы между перезапусками.
pub const BACKOFF_MAX: Duration = Duration::from_secs(30);
/// Время на мягкое завершение ядра при выходе (§5). T-52: весь бюджет лестницы, 15 с (было 5).
pub const KILL_GRACE: Duration = GRACEFUL_SHUTDOWN_TOTAL;
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
        self.slot.lock().unwrap_or_else(|e| e.into_inner())
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
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }
}

/// Запущенный процесс ядра глазами надзирателя.
pub trait Watched {
    /// Процесс ещё жив.
    fn is_running(&mut self) -> bool;
    /// Остановить процесс (мягко до `grace`, затем жёстко).
    fn kill(&mut self, grace: Duration);
}

impl Watched for crate::coreproc::driver::RealCoreProcess {
    fn is_running(&mut self) -> bool {
        crate::coreproc::driver::RealCoreProcess::is_running(self)
    }

    fn kill(&mut self, grace: Duration) {
        let _ = crate::coreproc::CoreProcess::kill(self, grace);
    }
}

/// Окружение надзирателя: состояние оболочки, события UI, системный прокси.
pub trait SupervisorHost {
    /// Пользователь выходит из приложения.
    fn quitting(&self) -> bool;
    /// Ядро запущено: записать состояние, отправить UI событие.
    fn core_up(&self, endpoint: &EndpointEvent);
    /// Ядро умерло само: записать причину, отправить UI
    /// [`EndpointEvent::down`], вернуть системный прокси из снимка.
    fn core_down(&self, reason: &str);
    /// Ядро не запустилось.
    fn spawn_failed(&self, reason: &str);
    /// Пауза (в тестах — без ожидания).
    fn pause(&self, duration: Duration);
}

/// Цикл надзирателя: запустить ядро, опубликовать адрес, следить за
/// процессом; после смерти — `hub.clear()`, `host.core_down`, пауза и новый
/// запуск. Возвращается только при выходе из приложения.
pub fn run_supervisor<P: Watched>(
    hub: &EndpointHub,
    host: &dyn SupervisorHost,
    mut spawn: impl FnMut() -> Result<(String, String, P), String>,
) {
    let mut backoff = BACKOFF_START;
    while !host.quitting() {
        let started = spawn();
        if let Ok((url, token, mut process)) = started {
            backoff = BACKOFF_START;
            let endpoint = hub.publish(url, token);
            host.core_up(&endpoint);
            loop {
                host.pause(POLL_INTERVAL);
                if host.quitting() {
                    process.kill(KILL_GRACE);
                    hub.close();
                    return;
                }
                if !process.is_running() {
                    break;
                }
            }
            hub.clear();
            host.core_down(REASON_CORE_DIED);
        } else if let Err(reason) = started {
            host.spawn_failed(&reason);
        }
        if host.quitting() {
            break;
        }
        host.pause(backoff);
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
    hub.close();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;
    use std::sync::Arc;

    /// Подставное ядро: «живёт» заданное число проверок.
    struct FakeProcess {
        polls_left: u32,
        killed: Rc<Cell<bool>>,
    }

    impl Watched for FakeProcess {
        fn is_running(&mut self) -> bool {
            self.polls_left = self.polls_left.saturating_sub(1);
            self.polls_left > 0
        }

        fn kill(&mut self, _grace: Duration) {
            self.killed.set(true);
        }
    }

    /// Окружение, записывающее действия надзирателя.
    #[derive(Default)]
    struct FakeHost {
        log: RefCell<Vec<String>>,
        pauses: RefCell<Vec<Duration>>,
        quit: Cell<bool>,
        /// Выйти из приложения на первой паузе после N-го запуска ядра.
        quit_after_ups: Cell<usize>,
    }

    impl FakeHost {
        fn ups(&self) -> usize {
            self.log
                .borrow()
                .iter()
                .filter(|l| l.starts_with("up"))
                .count()
        }
    }

    impl SupervisorHost for FakeHost {
        fn quitting(&self) -> bool {
            self.quit.get()
        }

        fn core_up(&self, endpoint: &EndpointEvent) {
            self.log.borrow_mut().push(format!("up {}", endpoint.url));
        }

        fn core_down(&self, reason: &str) {
            self.log.borrow_mut().push(format!("down {reason}"));
        }

        fn spawn_failed(&self, reason: &str) {
            self.log.borrow_mut().push(format!("spawn_failed {reason}"));
        }

        fn pause(&self, duration: Duration) {
            self.pauses.borrow_mut().push(duration);
            if self.quit_after_ups.get() > 0 && self.ups() >= self.quit_after_ups.get() {
                self.quit.set(true);
            }
        }
    }

    #[test]
    fn restarted_core_gets_new_endpoint_and_proxy_is_released_in_between() {
        let hub = EndpointHub::default();
        let host = FakeHost::default();
        host.quit_after_ups.set(2);
        let killed = Rc::new(Cell::new(false));
        let process = |polls| FakeProcess {
            polls_left: polls,
            killed: Rc::clone(&killed),
        };
        // стек: первым запускается ядро №1 (умирает на 3-й проверке)
        let mut starts = vec![
            ("tcp://127.0.0.1:50002", "tokenB", process(u32::MAX)),
            ("tcp://127.0.0.1:50001", "tokenA", process(3)),
        ];
        run_supervisor(&hub, &host, || {
            let (url, token, p) = starts.pop().ok_or("больше ядер нет")?;
            Ok((url.to_string(), token.to_string(), p))
        });
        assert_eq!(
            *host.log.borrow(),
            [
                "up tcp://127.0.0.1:50001".to_string(),
                format!("down {REASON_CORE_DIED}"),
                "up tcp://127.0.0.1:50002".to_string(),
            ],
            "прокси снимается (down) ДО запуска нового ядра; UI получает оба адреса"
        );
        assert!(host.pauses.borrow().contains(&BACKOFF_START));
        assert!(killed.get(), "при выходе живое ядро останавливается");
        assert!(hub.current().is_none(), "после выхода адреса нет");
    }

    #[test]
    fn spawn_failures_back_off_1_2_4_8_16_then_30_seconds() {
        let hub = EndpointHub::default();
        let host = FakeHost::default();
        let attempts = Cell::new(0);
        run_supervisor::<FakeProcess>(&hub, &host, || {
            attempts.set(attempts.get() + 1);
            host.quit.set(attempts.get() >= 8);
            Err("ядро изменено".to_string())
        });
        let secs: Vec<u64> = host.pauses.borrow().iter().map(Duration::as_secs).collect();
        assert_eq!(secs, [1, 2, 4, 8, 16, 30, 30]);
        assert_eq!(
            host.log.borrow()[0],
            "spawn_failed ядро изменено",
            "причина доходит до UI"
        );
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
