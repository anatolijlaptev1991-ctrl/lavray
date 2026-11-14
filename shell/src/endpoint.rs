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
    /// Здоровое ядро намеренно перезапускается: отправить UI `core-endpoint` с
    /// [`EndpointEvent::down`] (адреса нет, новый придёт после READY). Это не
    /// крах: kill switch и «ядро упало» не трогаются.
    fn core_restarting(&self) {}
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

    fn on_restarting(&mut self) {
        if std::mem::take(&mut self.up) {
            self.hub.clear();
            self.host.agent_core_down();
            self.host.core_restarting();
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
mod tests;
