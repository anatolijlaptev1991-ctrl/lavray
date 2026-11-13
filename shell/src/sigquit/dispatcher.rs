// SPDX-License-Identifier: GPL-3.0-only

//! Раздатчик сигналов: решает по числу сигналов, хранит отложенный выход и
//! срочно выходит по истечении бюджета. От ОС не зависит.

use super::{next_action, Action, QUIT_BUDGET};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

/// Штатный выход приложения (в `main.rs` — `begin_quit`).
pub type Quit = Arc<dyn Fn() + Send + Sync>;
/// Срочный выход; аргумент — «приложение уже поднялось» (может владеть прокси).
pub type Force = Box<dyn Fn(bool) + Send + Sync>;

#[derive(Default)]
struct State {
    /// Обработчик выхода, поставленный из `setup`.
    quit: Option<Quit>,
    /// Первый сигнал пришёл раньше обработчика: выход запустится при установке.
    pending: bool,
}

/// Раздаёт сигналы: решает, что делать, и хранит отложенный выход.
pub struct Dispatcher {
    seen: AtomicU32,
    forced: AtomicBool,
    budget: Duration,
    state: Mutex<State>,
    force: Force,
}

impl Dispatcher {
    #[must_use]
    pub fn new(force: impl Fn(bool) + Send + Sync + 'static) -> Self {
        Self::with_budget(QUIT_BUDGET, force)
    }

    #[must_use]
    pub fn with_budget(budget: Duration, force: impl Fn(bool) + Send + Sync + 'static) -> Self {
        Self {
            seen: AtomicU32::new(0),
            forced: AtomicBool::new(false),
            budget,
            state: Mutex::new(State::default()),
            force: Box::new(force),
        }
    }

    /// Пришёл сигнал: первый запускает штатный выход и отсчёт бюджета, второй и
    /// следующие — срочный выход.
    pub fn on_signal(self: &Arc<Self>) -> Action {
        // Насыщающий инкремент циклом compare_exchange: `fetch_update` в новых
        // версиях Rust объявлен устаревшим (переименован в `try_update`, которого
        // нет в закреплённой у нас 1.96), а CI собирает с `-D warnings`.
        let mut before = self.seen.load(Ordering::SeqCst);
        while let Err(actual) = self.seen.compare_exchange_weak(
            before,
            before.saturating_add(1),
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            before = actual;
        }
        let action = next_action(before);
        match action {
            Action::Graceful => {
                self.arm_budget();
                self.start_quit();
            }
            Action::Force => self.force_now(),
        }
        action
    }

    /// Поставить обработчик штатного выхода (из `setup`, когда есть `AppHandle`);
    /// выход, запрошенный раньше, стартует сразу.
    pub fn install(&self, quit: Quit) {
        let early = {
            let mut state = self.lock();
            let early = std::mem::take(&mut state.pending);
            state.quit = Some(quit);
            early.then(|| state.quit.clone()).flatten()
        };
        if let Some(quit) = early {
            spawn_quit(&quit);
        }
    }

    /// Срочный выход; повторный вызов ничего не делает.
    pub fn force_now(&self) {
        if self.forced.swap(true, Ordering::SeqCst) {
            return;
        }
        let up = self.lock().quit.is_some();
        (self.force)(up);
    }

    fn start_quit(&self) {
        let quit = {
            let mut state = self.lock();
            if state.quit.is_none() {
                state.pending = true;
            }
            state.quit.clone()
        };
        if let Some(quit) = quit {
            spawn_quit(&quit);
        }
    }

    /// По истечении бюджета выход становится срочным.
    fn arm_budget(self: &Arc<Self>) {
        let this = Arc::clone(self);
        let budget = self.budget;
        let spawned = std::thread::Builder::new()
            .name("lavray-quit-budget".into())
            .spawn(move || {
                std::thread::sleep(budget);
                this.force_now();
            });
        if spawned.is_err() {
            self.force_now(); // без таймера лучше выйти сразу, чем зависнуть
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Обработчик выхода идёт в своём потоке: поток сигналов не должен ждать его и
/// должен успеть принять второй сигнал.
fn spawn_quit(quit: &Quit) {
    let quit = Arc::clone(quit);
    if std::thread::Builder::new()
        .name("lavray-sigquit".into())
        .spawn(move || quit())
        .is_err()
    {
        eprintln!("LAVRay: не удалось запустить штатный выход по сигналу");
    }
}
