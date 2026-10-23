//! Меню трея (§9): конфигурация + билдер, проверяемые без запуска GUI.
//!
//! Рантайм-трей (tauri tray-icon API требует окна/иконок в рантайме) —
//! следующая итерация; здесь — декларативная спецификация меню, отображения
//! «состояние ядра → доступность пунктов» и «состояние → знак иконки»
//! (состояния знака по fix-plan §4). Динамические пункты «Программы» с
//! поиском по серверам и «последние 5» (FR-UI-051, UX-7) требуют данных
//! ядра — вне скаффолда.

use crate::coreproc::CoreState;

/// Статический пункт меню трея.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TrayMenuItem {
    /// Подключить (выбор профиля — контекстное подменю, позже).
    Connect,
    /// Отключить.
    Disconnect,
    /// Показать/поднять окно (FR-UI-052/053).
    ShowWindow,
    /// Выход (graceful §5 — единственный «жёсткий» выход).
    Exit,
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

    /// Собрать стандартное меню: Показать | Подключить | Отключить | Выход.
    pub fn standard() -> TrayMenuSpec {
        let mut builder = Self::new();
        builder.item(TrayMenuItem::ShowWindow);
        builder.separator();
        builder.item(TrayMenuItem::Connect);
        builder.item(TrayMenuItem::Disconnect);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_menu_is_valid() {
        let menu = TrayMenuBuilder::standard();
        assert_eq!(
            menu.entries(),
            &[
                TrayEntry::Item(TrayMenuItem::ShowWindow),
                TrayEntry::Separator,
                TrayEntry::Item(TrayMenuItem::Connect),
                TrayEntry::Item(TrayMenuItem::Disconnect),
                TrayEntry::Separator,
                TrayEntry::Item(TrayMenuItem::Exit),
            ]
        );
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
}
