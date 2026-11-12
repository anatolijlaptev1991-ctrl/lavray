// SPDX-License-Identifier: GPL-3.0-only

//! Kill switch системного прокси (хвосты B, 7.3).
//!
//! Настройка ядра `connect.kill_switch_proxy` («не снимать прокси при падении
//! ядра»): если ядро умерло, а системный прокси выставляли мы, оболочка прокси
//! НЕ возвращает. Приложения продолжают слать трафик на мёртвый порт и получают
//! отказ, а не уходят напрямую в обход туннеля. Прокси держится, пока пользователь не
//! нажмёт «Отключить» (`set_system_proxy(false)`) или не выйдет из приложения: эти
//! два пути снимают его всегда.
//!
//! Как оболочка узнаёт настройку. Оболочка не говорит с ядром, и читает она
//! общий файл `ui-state.json` (как остальные свои настройки, [`crate::prefs`]).
//! Интерфейс зеркалит значение настройки ядра в ключ `lavray.killSwitchProxy`
//! при загрузке и при каждом изменении (`ui/src/lib/killSwitch.ts`). Источник
//! истины остаётся в ядре (попадает в резервную копию и в `GetSettings`), файл —
//! его копия для оболочки; рассинхрон возможен только до первого запуска
//! интерфейса, пока копии нет, и тогда действует умолчание «снять».
//!
//! Состояние «прокси оставлен» хранит оболочка ([`ProxyFlags`]), а не окно: окно
//! можно перезагрузить, а событие `proxy-kept` может прийти позже `core-endpoint`
//! «ядро пропало». Поэтому флаг ставится ДО любого события ([`handle_core_crash`]),
//! а окно спрашивает его командой [`proxy_kept`] при запуске и перед любым
//! автоматическим снятием прокси.
//!
//! В TUN kill switch прокси не нужен: туннель живёт в процессе ядра и исчезает
//! вместе с ним; его строгий вариант — настройка `tun.strict_route`.

use crate::prefs::ShellPrefs;
use crate::sysproxy::{Backend, SysProxy};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

/// Событие для UI: ядро умерло, прокси оставлен (полезная нагрузка не нужна).
pub const PROXY_KEPT_EVENT: &str = "proxy-kept";

/// Чем закончилась работа с прокси. «Отключить» сюда не входит: это
/// `set_system_proxy(false)`, он снимает прокси без вопросов.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    /// Ядро умерло само.
    CoreCrashed,
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

/// Состояние системного прокси в оболочке: что мы включили и что оставили.
#[derive(Default)]
pub struct ProxyFlags {
    /// Прокси включён нами и не снят: `set_system_proxy(true)` удался, а
    /// `set_system_proxy(false)` ещё нет. Снимок на диске для этого не годится:
    /// после предупреждений RAS/WPAD он остаётся и у уже снятого прокси.
    active: AtomicBool,
    /// Ядро умерло, а прокси оставлен (kill switch).
    kept: AtomicBool,
}

impl ProxyFlags {
    pub fn set_active(&self, on: bool) {
        self.active.store(on, Ordering::SeqCst);
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    pub fn set_kept(&self, on: bool) {
        self.kept.store(on, Ordering::SeqCst);
    }

    pub fn is_kept(&self) -> bool {
        self.kept.load(Ordering::SeqCst)
    }

    /// `set_system_proxy` удался: прокси включён (`enabled`) или снят. «Оставлен»
    /// кончился в любом случае: прокси либо снят, либо снова смотрит на живое ядро.
    pub fn on_proxy_set(&self, enabled: bool) {
        self.set_active(enabled);
        self.set_kept(false);
    }
}

/// `proxy_kept` — оставлен ли системный прокси после падения ядра. Окно спрашивает
/// при запуске (после перезагрузки страницы событие уже прошло) и перед любым
/// автоматическим снятием прокси. Права JS (capability) не нужны: команда
/// приложения, не плагин.
#[tauri::command]
#[must_use]
pub fn proxy_kept(flags: tauri::State<'_, ProxyFlags>) -> bool {
    flags.is_kept()
}

/// Системный прокси глазами kill switch.
pub trait ProxyControl {
    /// Вернуть прежние настройки.
    fn release(&self) -> Result<(), String>;
}

impl<B: Backend> ProxyControl for SysProxy<B> {
    fn release(&self) -> Result<(), String> {
        self.release_on_quit()
    }
}

/// Держать ли прокси: только при падении ядра и включённом kill switch.
#[must_use]
pub fn keeps_proxy(exit: Exit, kill_switch: bool) -> bool {
    exit == Exit::CoreCrashed && kill_switch
}

/// Решить судьбу прокси и исполнить решение. `active` — прокси сейчас включён
/// нами ([`ProxyFlags::is_active`]): чужой или уже снятый держать нечего.
pub fn handle_exit<P: ProxyControl>(
    proxy: &P,
    exit: Exit,
    kill_switch: bool,
    active: bool,
) -> Outcome {
    if keeps_proxy(exit, kill_switch) && active {
        return Outcome::Kept;
    }
    match proxy.release() {
        Ok(()) => Outcome::Released,
        Err(e) => Outcome::Failed(e),
    }
}

/// То же на настоящем системном прокси; настройка берётся из `ui-state.json`.
#[must_use]
pub fn apply_exit(data_dir: &Path, exit: Exit, active: bool) -> Outcome {
    let kill_switch = ShellPrefs::load(data_dir).kill_switch_proxy;
    handle_exit(&SysProxy::new(data_dir), exit, kill_switch, active)
}

/// Что нужно оболочке при смерти ядра. Трейт нужен, чтобы порядок действий
/// проверялся тестом без окна и без ОС.
pub trait CrashSink {
    /// Решить и исполнить судьбу прокси.
    fn decide(&self) -> Outcome;
    /// Записать итог в [`ProxyFlags`]: оставлен ли прокси, включён ли ещё.
    fn record(&self, outcome: &Outcome);
    /// Событие [`PROXY_KEPT_EVENT`] окну.
    fn emit_kept(&self);
    /// Событие `core-endpoint` «адреса больше нет».
    fn emit_down(&self);
}

/// Смерть ядра: сначала решение и флаг, потом события. Окно, получив «адрес
/// пропал», видит состояние IDLE и снимает прокси сам (следует за ядром, MCP);
/// флаг должен к этому моменту уже стоять, иначе kill switch не сработает.
pub fn handle_core_crash<S: CrashSink>(sink: &S) -> Outcome {
    let outcome = sink.decide();
    sink.record(&outcome);
    if outcome == Outcome::Kept {
        sink.emit_kept();
    }
    sink.emit_down();
    outcome
}

#[cfg(test)]
mod tests;
