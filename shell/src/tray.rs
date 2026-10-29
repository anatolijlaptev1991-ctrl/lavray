// SPDX-License-Identifier: GPL-3.0-only

//! Меню трея (§9): конфигурация + билдер, проверяемые без запуска GUI.
//!
//! Рантайм-трей (tauri tray-icon API требует окна/иконок в рантайме) —
//! следующая итерация; здесь — декларативная спецификация меню, отображения
//! «состояние ядра → доступность пунктов» и «состояние → знак иконки»
//! (состояния знака по fix-plan §4). Динамические пункты «Программы» с
//! поиском по серверам и «последние 5» (FR-UI-051, UX-7) требуют данных
//! ядра — вне скаффолда.

use serde::Deserialize;

use crate::coreproc::CoreState;

/// Идентификатор значка трея в Tauri (`TrayIconBuilder::with_id`).
pub const TRAY_ID: &str = "main";
/// Предел подсказки: у Windows `szTip` — 128 UTF-16-единиц с нулём.
pub const TOOLTIP_MAX_CHARS: usize = 120;

/// Статический пункт меню трея.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TrayMenuItem {
    /// Состояние («LAVRay — Подключено»): только показывает.
    Status,
    /// Текущий сервер: только показывает.
    Server,
    /// Подключить (профиль и режимы выбирает UI — как для Ctrl+D).
    Connect,
    /// Отключить.
    Disconnect,
    /// Показать/поднять окно (FR-UI-052/053).
    ShowWindow,
    /// Выход (graceful §5 — единственный «жёсткий» выход).
    Exit,
}

impl TrayMenuItem {
    /// Идентификатор пункта в Tauri-меню (приходит в `on_menu_event`).
    pub const fn id(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::Server => "server",
            Self::Connect => "connect",
            Self::Disconnect => "disconnect",
            Self::ShowWindow => "show",
            Self::Exit => "quit",
        }
    }

    /// Обратное преобразование для `on_menu_event`.
    pub fn from_id(id: &str) -> Option<Self> {
        [
            Self::Status,
            Self::Server,
            Self::Connect,
            Self::Disconnect,
            Self::ShowWindow,
            Self::Exit,
        ]
        .into_iter()
        .find(|item| item.id() == id)
    }
}

/// Элемент спецификации меню: пункт или разделитель.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayEntry {
    /// Пункт меню.
    Item(TrayMenuItem),
    /// Горизонтальный разделитель.
    Separator,
}

/// Ошибки сборки меню.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TrayMenuError {
    /// Пункт меню встречается больше одного раза.
    #[error("duplicate tray menu item: {0:?}")]
    DuplicateItem(TrayMenuItem),
    /// Пункт «Выход» обязателен (иначе закрыть ядро из трея нельзя).
    #[error("tray menu must contain the Exit item")]
    MissingExit,
    /// Разделитель в начале меню.
    #[error("tray menu cannot start with a separator")]
    LeadingSeparator,
    /// Разделитель в конце меню.
    #[error("tray menu cannot end with a separator")]
    TrailingSeparator,
    /// Два разделителя подряд.
    #[error("tray menu cannot contain adjacent separators")]
    AdjacentSeparators,
}

/// Проверенная спецификация меню трея.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayMenuSpec {
    items: Vec<TrayEntry>,
}

impl TrayMenuSpec {
    /// Собрать меню через [`TrayMenuBuilder`].
    pub fn builder() -> TrayMenuBuilder {
        TrayMenuBuilder::new()
    }

    /// Элементы меню по порядку.
    pub fn entries(&self) -> &[TrayEntry] {
        &self.items
    }

    /// Содержит ли пункт.
    pub fn contains(&self, item: TrayMenuItem) -> bool {
        self.items.contains(&TrayEntry::Item(item))
    }
}

/// Билдер меню трея с валидацией.
#[derive(Debug, Clone, Default)]
pub struct TrayMenuBuilder {
    items: Vec<TrayEntry>,
}

impl TrayMenuBuilder {
    /// Пустой билдер.
    pub fn new() -> Self {
        Self::default()
    }

    /// Добавить пункт.
    pub fn item(&mut self, item: TrayMenuItem) -> &mut Self {
        self.items.push(TrayEntry::Item(item));
        self
    }

    /// Добавить разделитель.
    pub fn separator(&mut self) -> &mut Self {
        self.items.push(TrayEntry::Separator);
        self
    }

    /// Стандартное меню: Состояние | Сервер | — | Подключить | Отключить | —
    /// | Открыть | — | Выход.
    pub fn standard() -> TrayMenuSpec {
        let mut builder = Self::new();
        builder.item(TrayMenuItem::Status);
        builder.item(TrayMenuItem::Server);
        builder.separator();
        builder.item(TrayMenuItem::Connect);
        builder.item(TrayMenuItem::Disconnect);
        builder.separator();
        builder.item(TrayMenuItem::ShowWindow);
        builder.separator();
        builder.item(TrayMenuItem::Exit);
        builder.build().expect("standard tray menu is valid")
    }

    /// Проверить и собрать (см. [`TrayMenuError`]).
    pub fn build(&self) -> Result<TrayMenuSpec, TrayMenuError> {
        if self.items.first() == Some(&TrayEntry::Separator) {
            return Err(TrayMenuError::LeadingSeparator);
        }
        if self.items.last() == Some(&TrayEntry::Separator) {
            return Err(TrayMenuError::TrailingSeparator);
        }
        for pair in self.items.windows(2) {
            if pair[0] == TrayEntry::Separator && pair[1] == TrayEntry::Separator {
                return Err(TrayMenuError::AdjacentSeparators);
            }
        }

        let mut seen: Vec<TrayMenuItem> = Vec::new();
        for entry in &self.items {
            if let TrayEntry::Item(item) = entry {
                if seen.contains(item) {
                    return Err(TrayMenuError::DuplicateItem(*item));
                }
                seen.push(*item);
            }
        }
        if !seen.contains(&TrayMenuItem::Exit) {
            return Err(TrayMenuError::MissingExit);
        }

        Ok(TrayMenuSpec {
            items: self.items.clone(),
        })
    }
}

/// Доступность статических пунктов меню в состоянии ядра.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrayAvailability {
    /// «Подключить» доступно, когда ядру есть что подключать.
    pub connect: bool,
    /// «Отключить» доступно только при активном инстансе.
    pub disconnect: bool,
    /// «Показать окно» — всегда.
    pub show_window: bool,
    /// «Выход» — всегда (graceful §5).
    pub exit: bool,
}

/// Доступность пунктов меню по состоянию ядра §2.2.
///
/// Connect разрешён в Idle/Ready/RateLimited/Stopped (в Ready ядро живо, но
/// инстанс не активен); Disconnect — только в Connected.
pub fn availability_for(state: CoreState) -> TrayAvailability {
    let (connect, disconnect) = match state {
        CoreState::Idle | CoreState::Ready | CoreState::RateLimited | CoreState::Stopped => {
            (true, false)
        }
        CoreState::Connected => (false, true),
        CoreState::Spawning | CoreState::SpawnErr | CoreState::Crashed | CoreState::Stopping => {
            (false, false)
        }
    };
    TrayAvailability {
        connect,
        disconnect,
        show_window: true,
        exit: true,
    }
}

/// Знак tray-иконки (состояния знака, §9 / fix-plan §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayIconKind {
    /// Ядро не работает (Idle/Stopped).
    Idle,
    /// Переходные состояния (Spawning/Stopping).
    Busy,
    /// Ядро живо, инстанс не активен (Ready).
    Running,
    /// Инстанс активен (Connected).
    Connected,
    /// Проблема: SpawnErr/Crashed/RateLimited.
    Error,
}

/// Знак иконки по состоянию ядра.
pub fn icon_kind_for(state: CoreState) -> TrayIconKind {
    match state {
        CoreState::Idle | CoreState::Stopped => TrayIconKind::Idle,
        CoreState::Spawning | CoreState::Stopping => TrayIconKind::Busy,
        CoreState::Ready => TrayIconKind::Running,
        CoreState::Connected => TrayIconKind::Connected,
        CoreState::SpawnErr | CoreState::Crashed | CoreState::RateLimited => TrayIconKind::Error,
    }
}

/// Состояние соединения глазами UI (слова `PlatformAdapter.setTrayState`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrayConn {
    /// Не подключено.
    #[default]
    Off,
    /// Подключение, отключение или переподключение.
    Connecting,
    /// Подключено.
    On,
    /// Последнее подключение не удалось.
    Error,
}

/// Готовые строки меню на языке интерфейса: словари живут в UI.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    /// «LAVRay — Подключено» (пункт состояния и начало подсказки).
    pub status: String,
    /// «Сервер: Frankfurt 01».
    pub server: String,
    pub connect: String,
    pub disconnect: String,
    pub show: String,
    pub quit: String,
}

impl Default for TrayLabels {
    /// До первого сообщения UI: английский, а не зашитый русский.
    fn default() -> Self {
        let text = |s: &str| s.to_owned();
        Self {
            status: text("LAVRay"),
            server: text("—"),
            connect: text("Connect"),
            disconnect: text("Disconnect"),
            show: text("Open LAVRay"),
            quit: text("Quit"),
        }
    }
}

/// Сообщение UI → оболочка (команда `tray_update`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayUpdate {
    pub state: TrayConn,
    pub labels: TrayLabels,
}

/// Пункт меню в готовом виде.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayItemView {
    pub item: TrayMenuItem,
    pub text: String,
    pub enabled: bool,
}

/// Готовый вид трея: пункты в порядке `TrayMenuBuilder::standard`, подсказка, значок.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayView {
    pub items: Vec<TrayItemView>,
    pub tooltip: String,
    pub icon: TrayIconKind,
}

impl TrayView {
    /// Пункт по идентификатору.
    pub fn item(&self, which: TrayMenuItem) -> Option<&TrayItemView> {
        self.items.iter().find(|v| v.item == which)
    }
}

/// Обрезать до `max` символов с многоточием (подсказка Windows — 127 символов).
pub fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Вид трея по сообщению UI и живости процесса ядра. Мёртвый процесс важнее
/// слов UI: значок «ошибка», подключать нельзя. После неудачи (`Error`)
/// «Подключить» остаётся доступным — это повтор.
pub fn view(update: &TrayUpdate, core_alive: bool) -> TrayView {
    let conn = update.state;
    let (state, avail_state) = match (core_alive, conn) {
        (false, _) => (CoreState::Crashed, CoreState::Crashed),
        (true, TrayConn::Off) => (CoreState::Ready, CoreState::Ready),
        (true, TrayConn::Connecting) => (CoreState::Spawning, CoreState::Spawning),
        (true, TrayConn::On) => (CoreState::Connected, CoreState::Connected),
        (true, TrayConn::Error) => (CoreState::SpawnErr, CoreState::Ready),
    };
    let avail = availability_for(avail_state);
    let l = &update.labels;
    let items = TrayMenuBuilder::standard()
        .entries()
        .iter()
        .filter_map(|entry| match entry {
            TrayEntry::Item(item) => Some(*item),
            TrayEntry::Separator => None,
        })
        .map(|item| {
            let (text, enabled) = match item {
                TrayMenuItem::Status => (&l.status, false),
                TrayMenuItem::Server => (&l.server, false),
                TrayMenuItem::Connect => (&l.connect, avail.connect),
                TrayMenuItem::Disconnect => (&l.disconnect, avail.disconnect),
                TrayMenuItem::ShowWindow => (&l.show, avail.show_window),
                TrayMenuItem::Exit => (&l.quit, avail.exit),
            };
            TrayItemView {
                item,
                text: text.clone(),
                enabled,
            }
        })
        .collect();
    let tooltip = if conn == TrayConn::On && core_alive {
        format!("{}\n{}", l.status, l.server)
    } else {
        l.status.clone()
    };
    TrayView {
        items,
        tooltip: truncate_chars(&tooltip, TOOLTIP_MAX_CHARS),
        icon: icon_kind_for(state),
    }
}

/// PNG 32×32 RGBA из `design/concepts/logo/tray/*.svg`; `dark` — светлый
/// значок для тёмной панели задач. «Ядро не работает» и «не подключено»
/// рисуются одинаково (`off`).
pub fn icon_png(kind: TrayIconKind, dark: bool) -> &'static [u8] {
    use TrayIconKind::{Busy, Connected, Error, Idle, Running};
    match (dark, kind) {
        (true, Idle | Running) => &include_bytes!("../icons/tray/dark-off.png")[..],
        (true, Busy) => &include_bytes!("../icons/tray/dark-wait.png")[..],
        (true, Connected) => &include_bytes!("../icons/tray/dark-on.png")[..],
        (true, Error) => &include_bytes!("../icons/tray/dark-err.png")[..],
        (false, Idle | Running) => &include_bytes!("../icons/tray/light-off.png")[..],
        (false, Busy) => &include_bytes!("../icons/tray/light-wait.png")[..],
        (false, Connected) => &include_bytes!("../icons/tray/light-on.png")[..],
        (false, Error) => &include_bytes!("../icons/tray/light-err.png")[..],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_menu_is_valid() {
        let menu = TrayMenuBuilder::standard();
        assert_eq!(
            menu.entries(),
            &[
                TrayEntry::Item(TrayMenuItem::Status),
                TrayEntry::Item(TrayMenuItem::Server),
                TrayEntry::Separator,
                TrayEntry::Item(TrayMenuItem::Connect),
                TrayEntry::Item(TrayMenuItem::Disconnect),
                TrayEntry::Separator,
                TrayEntry::Item(TrayMenuItem::ShowWindow),
                TrayEntry::Separator,
                TrayEntry::Item(TrayMenuItem::Exit),
            ]
        );
        assert_eq!(TrayMenuItem::from_id("quit"), Some(TrayMenuItem::Exit));
        assert_eq!(TrayMenuItem::from_id("нет-такого"), None);
        assert!(menu.contains(TrayMenuItem::Exit));
        assert!(menu.contains(TrayMenuItem::Connect));
        assert!(menu.contains(TrayMenuItem::Disconnect));
        assert!(menu.contains(TrayMenuItem::ShowWindow));
    }

    #[test]
    fn builder_rejects_invalid_menus() {
        // Нет Exit.
        let mut b = TrayMenuBuilder::new();
        b.item(TrayMenuItem::ShowWindow);
        assert_eq!(b.build().unwrap_err(), TrayMenuError::MissingExit);

        // Дубликат.
        let mut b = TrayMenuBuilder::new();
        b.item(TrayMenuItem::Exit);
        b.item(TrayMenuItem::Exit);
        assert_eq!(
            b.build().unwrap_err(),
            TrayMenuError::DuplicateItem(TrayMenuItem::Exit)
        );

        // Разделители.
        let mut b = TrayMenuBuilder::new();
        b.separator();
        b.item(TrayMenuItem::Exit);
        assert_eq!(b.build().unwrap_err(), TrayMenuError::LeadingSeparator);

        let mut b = TrayMenuBuilder::new();
        b.item(TrayMenuItem::Exit);
        b.separator();
        assert_eq!(b.build().unwrap_err(), TrayMenuError::TrailingSeparator);

        let mut b = TrayMenuBuilder::new();
        b.item(TrayMenuItem::ShowWindow);
        b.separator();
        b.separator();
        b.item(TrayMenuItem::Exit);
        assert_eq!(b.build().unwrap_err(), TrayMenuError::AdjacentSeparators);
    }

    /// Параметризованно по всем 9 состояниям §2.2.
    #[test]
    fn availability_for_all_core_states() {
        let cases: &[(CoreState, bool, bool)] = &[
            (CoreState::Idle, true, false),
            (CoreState::Spawning, false, false),
            (CoreState::SpawnErr, false, false),
            (CoreState::Ready, true, false),
            (CoreState::Connected, false, true),
            (CoreState::Crashed, false, false),
            (CoreState::RateLimited, true, false),
            (CoreState::Stopping, false, false),
            (CoreState::Stopped, true, false),
        ];
        for &(state, connect, disconnect) in cases {
            let avail = availability_for(state);
            assert_eq!(avail.connect, connect, "connect for {state}");
            assert_eq!(avail.disconnect, disconnect, "disconnect for {state}");
            assert!(avail.show_window && avail.exit, "{state}");
        }
    }

    /// Знак иконки определён для всех состояний.
    #[test]
    fn icon_kind_covers_all_core_states() {
        let cases: &[(CoreState, TrayIconKind)] = &[
            (CoreState::Idle, TrayIconKind::Idle),
            (CoreState::Spawning, TrayIconKind::Busy),
            (CoreState::SpawnErr, TrayIconKind::Error),
            (CoreState::Ready, TrayIconKind::Running),
            (CoreState::Connected, TrayIconKind::Connected),
            (CoreState::Crashed, TrayIconKind::Error),
            (CoreState::RateLimited, TrayIconKind::Error),
            (CoreState::Stopping, TrayIconKind::Busy),
            (CoreState::Stopped, TrayIconKind::Idle),
        ];
        for &(state, kind) in cases {
            assert_eq!(icon_kind_for(state), kind, "{state}");
        }
    }

    fn update(state: TrayConn) -> TrayUpdate {
        let l = |s: &str| s.to_owned();
        TrayUpdate {
            state,
            labels: TrayLabels {
                status: l("LAVRay — Verbunden"),
                server: l("Server: Frankfurt 01"),
                connect: l("Verbinden"),
                disconnect: l("Trennen"),
                show: l("LAVRay öffnen"),
                quit: l("Beenden"),
            },
        }
    }

    /// F-041: меню по спецификации, тексты — из UI (не зашиты), доступность и
    /// значок по состоянию; мёртвый процесс ядра — «ошибка» без подключения.
    #[test]
    fn view_follows_the_spec_ui_labels_and_connection_state() {
        let on = view(&update(TrayConn::On), true);
        let texts: Vec<&str> = on.items.iter().map(|v| v.text.as_str()).collect();
        assert_eq!(
            texts,
            [
                "LAVRay — Verbunden",
                "Server: Frankfurt 01",
                "Verbinden",
                "Trennen",
                "LAVRay öffnen",
                "Beenden"
            ]
        );
        assert_eq!(on.tooltip, "LAVRay — Verbunden\nServer: Frankfurt 01");

        // (состояние, ядро живо, «Подключить», «Отключить», значок)
        let cases = [
            (TrayConn::Off, true, true, false, TrayIconKind::Running),
            (TrayConn::Connecting, true, false, false, TrayIconKind::Busy),
            (TrayConn::On, true, false, true, TrayIconKind::Connected),
            (TrayConn::Error, true, true, false, TrayIconKind::Error),
            (TrayConn::On, false, false, false, TrayIconKind::Error),
        ];
        for (state, alive, connect, disconnect, icon) in cases {
            let v = view(&update(state), alive);
            let on = |item| v.item(item).unwrap().enabled;
            let ctx = format!("{state:?} alive={alive}");
            assert_eq!(on(TrayMenuItem::Connect), connect, "{ctx}");
            assert_eq!(on(TrayMenuItem::Disconnect), disconnect, "{ctx}");
            assert!(
                !on(TrayMenuItem::Status) && !on(TrayMenuItem::Server),
                "{ctx}"
            );
            assert!(
                on(TrayMenuItem::ShowWindow) && on(TrayMenuItem::Exit),
                "{ctx}"
            );
            assert_eq!(v.icon, icon, "{ctx}");
        }

        let mut long = update(TrayConn::On);
        long.labels.server = "Я".repeat(300);
        let tip = view(&long, true).tooltip;
        assert_eq!(
            (tip.chars().count(), tip.ends_with('…')),
            (TOOLTIP_MAX_CHARS, true)
        );
    }

    /// Контракт с UI (`ui/src/lib/tray.ts`): camelCase, слова состояния.
    #[test]
    fn update_parses_the_json_sent_by_the_ui() {
        let json = r#"{"state":"connecting","labels":{"status":"s","server":"v",
            "connect":"c","disconnect":"d","show":"o","quit":"q"}}"#;
        let parsed: TrayUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.state, TrayConn::Connecting);
        assert_eq!(parsed.labels.quit, "q");
        assert!(serde_json::from_str::<TrayUpdate>(&json.replace("connecting", "bogus")).is_err());
        assert!(!TrayLabels::default().connect.is_empty());
    }

    /// 8 значков (4 состояния × тёмная/светлая панель задач) — PNG 32×32 RGBA, разные.
    #[test]
    fn icons_are_32x32_rgba_png_and_states_differ() {
        for dark in [true, false] {
            let off = icon_png(TrayIconKind::Idle, dark);
            assert_eq!(off, icon_png(TrayIconKind::Running, dark));
            let others = [
                TrayIconKind::Busy,
                TrayIconKind::Connected,
                TrayIconKind::Error,
            ]
            .map(|kind| icon_png(kind, dark));
            for png in others.iter().chain([&off]) {
                assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
                let size = |at: usize| u32::from_be_bytes(png[at..at + 4].try_into().unwrap());
                assert_eq!((size(16), size(20), png[24], png[25]), (32, 32, 8, 6));
            }
            assert!(others.iter().all(|png| *png != off) && others[0] != others[1]);
            assert!(others[1] != others[2] && others[0] != others[2]);
        }
    }
}
