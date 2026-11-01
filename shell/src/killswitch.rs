// SPDX-License-Identifier: GPL-3.0-only

//! Kill switch системного прокси (хвосты B, 7.3).
//!
//! Настройка ядра `connect.kill_switch_proxy` («не снимать прокси при падении
//! ядра»): если ядро умерло, а системный прокси выставляли мы, оболочка прокси
//! НЕ возвращает. Приложения продолжают слать трафик на мёртвый порт и получают
//! отказ, а не уходят напрямую в обход туннеля. Прокси держится, пока пользователь не
//! нажмёт «Отключить» или не выйдет из приложения: эти два пути снимают его
//! всегда.
//!
//! Как оболочка узнаёт настройку. Оболочка не говорит с ядром, и читает она
//! общий файл `ui-state.json` (как остальные свои настройки, [`crate::prefs`]).
//! Интерфейс зеркалит значение настройки ядра в ключ `lavray.killSwitchProxy`
//! при загрузке и при каждом изменении (`ui/src/lib/killSwitch.ts`). Источник
//! истины остаётся в ядре (попадает в резервную копию и в `GetSettings`), файл —
//! его копия для оболочки; рассинхрон возможен только до первого запуска
//! интерфейса, пока копии нет, и тогда действует умолчание «снять».
//!
//! В TUN kill switch прокси не нужен: туннель живёт в процессе ядра и исчезает
//! вместе с ним; его строгий вариант — настройка `tun.strict_route`.

use crate::prefs::ShellPrefs;
use crate::sysproxy::{Backend, SysProxy};
use std::path::Path;

/// Событие для UI: ядро умерло, прокси оставлен (полезная нагрузка не нужна).
pub const PROXY_KEPT_EVENT: &str = "proxy-kept";

/// Чем закончилась работа с прокси.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    /// Ядро умерло само.
    CoreCrashed,
    /// Пользователь отключил подключение.
    Disconnect,
    /// Выход из приложения.
    Quit,
}

/// Итог [`handle_exit`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Прокси возвращён к снимку (или снимать было нечего).
    Released,
    /// Прокси оставлен на месте из-за kill switch.
    Kept,
    /// Снять не удалось: причина для журнала.
    Failed(String),
}

/// Системный прокси глазами kill switch.
pub trait ProxyControl {
    /// Прокси выставили мы: есть снимок прежних настроек.
    fn is_ours(&self) -> bool;
    /// Вернуть прежние настройки.
    fn release(&self) -> Result<(), String>;
}

impl<B: Backend> ProxyControl for SysProxy<B> {
    fn is_ours(&self) -> bool {
        self.pending_snapshot().is_some()
    }

    fn release(&self) -> Result<(), String> {
        self.release_on_quit()
    }
}

/// Держать ли прокси: только при падении ядра и включённом kill switch.
/// Отключение и выход снимают его всегда.
pub fn keeps_proxy(exit: Exit, kill_switch: bool) -> bool {
    exit == Exit::CoreCrashed && kill_switch
}

/// Решить судьбу прокси и исполнить решение.
pub fn handle_exit<P: ProxyControl>(proxy: &P, exit: Exit, kill_switch: bool) -> Outcome {
    if keeps_proxy(exit, kill_switch) && proxy.is_ours() {
        return Outcome::Kept;
    }
    match proxy.release() {
        Ok(()) => Outcome::Released,
        Err(e) => Outcome::Failed(e),
    }
}

/// То же на настоящем системном прокси; настройка берётся из `ui-state.json`.
pub fn apply_exit(data_dir: &Path, exit: Exit) -> Outcome {
    let kill_switch = ShellPrefs::load(data_dir).kill_switch_proxy;
    handle_exit(&SysProxy::new(data_dir), exit, kill_switch)
}

#[cfg(test)]
mod tests;
