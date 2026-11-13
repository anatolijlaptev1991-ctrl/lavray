// SPDX-License-Identifier: GPL-3.0-only

//! Штатный выход по сигналам SIGTERM, SIGINT и SIGHUP (unix).
//!
//! Без перехвата процесс умирал сразу: выход из сеанса, выключение компьютера
//! (systemd шлёт SIGTERM) и `kill` не доходили до `begin_quit`. Ядро гасло по
//! EOF stdin, а системный прокси GNOME оставался на порту без слушателя: после
//! перезагрузки браузер был без интернета, пока LAVRay не запустят снова.
//!
//! Перехват. [`start_early`] первой строкой `main` (до любых потоков) ставит
//! обработчики трёх сигналов и заводит поток-читатель. Обработчик делает
//! единственное async-signal-safe действие: пишет байт в канал (`write(2)`,
//! `errno` сохраняется); остальное идёт в обычном потоке, где доступно всё.
//! Маску сигналов намеренно не трогаем: потомки (ядро, `WebKit`, `xdg-open`)
//! унаследовали бы заблокированный SIGTERM, а полагаться на сброс маски в
//! `std::process::Command` нельзя; обработчик же при `exec` сам возвращается к
//! умолчанию.
//!
//! Решение. Первый сигнал запускает штатный выход (то же, что пункт «Выход»
//! трея): [`Dispatcher::install`] получает его из `setup`, когда появляется
//! `AppHandle`; сигнал, пришедший раньше, не теряется. Второй сигнал или
//! истечение [`QUIT_BUDGET`] означают срочный выход: прокси возвращается по
//! снимку (если приложение уже поднялось и могло его включить), процесс
//! завершается; ядро гаснет по EOF/PDEATHSIG. Вся логика ниже не зависит от ОС и
//! проверяется тестами; системные вызовы — в `unix.rs`.

mod dispatcher;
#[cfg(test)]
mod tests;
#[cfg(unix)]
mod unix;

#[cfg(unix)]
use std::sync::Arc;
use std::time::Duration;

pub use dispatcher::{Dispatcher, Force, Quit};

#[cfg(unix)]
pub use unix::start;

/// Сколько штатный выход может идти после первого сигнала. Дольше нельзя:
/// systemd при выключении ждёт недолго, а затем присылает SIGKILL, и прокси
/// остался бы включённым. `begin_quit` снимает прокси сразу после остановки
/// ядра; если лестница остановки затянулась, прокси вернёт срочный выход.
pub const QUIT_BUDGET: Duration = Duration::from_secs(5);

/// Что делать с очередным сигналом.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Штатный выход: останов ядра, трей, прокси, `app.exit`.
    Graceful,
    /// Срочный выход: вернуть прокси по снимку и завершить процесс.
    Force,
}

/// Решение по числу уже пришедших сигналов: первый — штатный выход, любой
/// следующий — срочный.
#[must_use]
pub const fn next_action(seen_before: u32) -> Action {
    if seen_before == 0 {
        Action::Graceful
    } else {
        Action::Force
    }
}

/// Глобальный раздатчик: сигналы процессу общие.
#[cfg(unix)]
static GLOBAL: std::sync::OnceLock<Arc<Dispatcher>> = std::sync::OnceLock::new();

/// Перехват сигналов; вызывать первой строкой `main`, до любых потоков. На
/// Windows ничего не делает.
pub fn start_early() {
    #[cfg(unix)]
    {
        let mut fresh = false;
        let dispatcher = GLOBAL.get_or_init(|| {
            fresh = true;
            Arc::new(Dispatcher::new(unix::release_and_exit))
        });
        if fresh {
            if let Err(e) = start(dispatcher) {
                eprintln!("LAVRay: не удалось перехватить SIGTERM/SIGINT/SIGHUP: {e}");
            }
        }
    }
}

/// Поставить штатный выход из `setup`. Без [`start_early`] и на Windows — нет-оп.
pub fn on_quit(quit: impl Fn() + Send + Sync + 'static) {
    #[cfg(unix)]
    if let Some(dispatcher) = GLOBAL.get() {
        dispatcher.install(Arc::new(quit));
    }
    #[cfg(not(unix))]
    let _ = quit;
}
