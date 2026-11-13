// SPDX-License-Identifier: GPL-3.0-only

//! Решения о главном окне (T-82): что делает крестик и как окно появляется на
//! старте. Чистые функции от настроек — `main.rs` только исполняет решение.

use crate::prefs::ShellPrefs;

/// Что делать по крестику окна.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Спрятать окно в трей: ядро и прокси продолжают работать.
    Hide,
    /// Свернуть окно на панель задач: трея нет (GNOME без расширения), спрятанное
    /// окно было бы недостижимо.
    Minimize,
    /// Полный выход, как «Выход» в меню трея: ядро останавливается, прокси снимается.
    Quit,
}

/// Решение по крестику; `tray_available` — есть ли значок в трее.
#[must_use]
pub fn on_close(prefs: &ShellPrefs, tray_available: bool) -> CloseAction {
    match (prefs.close_to_tray, tray_available) {
        (true, true) => CloseAction::Hide,
        (true, false) => CloseAction::Minimize,
        (false, _) => CloseAction::Quit,
    }
}

/// Каким окно появляется на старте.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartMode {
    /// Показано.
    Show,
    /// Скрыто, виден только значок трея.
    Hidden,
    /// Свёрнуто на панель задач (трея нет: скрытое окно не вернуть).
    Minimized,
}

/// Как стартовать: `--tray` (автозапуск) или «Запускать свёрнутым» просят убрать
/// окно с глаз; без трея его сворачивают, а не прячут.
///
/// После перезапуска от администратора (`elevated_relaunch`) «Запускать
/// свёрнутым» не действует: пользователь только что нажал кнопку и ждёт окно.
/// `--tray` при этом передаётся, только если окно было скрыто, — его слушаем.
#[must_use]
pub fn start_mode(
    tray_flag: bool,
    elevated_relaunch: bool,
    prefs: &ShellPrefs,
    tray_available: bool,
) -> StartMode {
    let wants_away = if elevated_relaunch {
        tray_flag
    } else {
        tray_flag || prefs.start_minimized
    };
    match (wants_away, tray_available) {
        (false, _) => StartMode::Show,
        (true, true) => StartMode::Hidden,
        (true, false) => StartMode::Minimized,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prefs(close_to_tray: bool, start_minimized: bool) -> ShellPrefs {
        ShellPrefs {
            close_to_tray,
            start_minimized,
            ..ShellPrefs::default()
        }
    }

    #[test]
    fn close_hides_when_close_to_tray() {
        assert_eq!(on_close(&prefs(true, false), true), CloseAction::Hide);
        assert_eq!(on_close(&ShellPrefs::default(), true), CloseAction::Hide);
    }

    #[test]
    fn close_minimizes_instead_of_hiding_without_a_tray() {
        assert_eq!(on_close(&prefs(true, false), false), CloseAction::Minimize);
    }

    #[test]
    fn close_quits_when_disabled() {
        for tray in [true, false] {
            assert_eq!(on_close(&prefs(false, false), tray), CloseAction::Quit);
        }
    }

    #[test]
    fn start_hidden_by_flag_or_pref() {
        let shown = prefs(true, false);
        let minimized = prefs(true, true);
        assert_eq!(start_mode(false, false, &shown, true), StartMode::Show);
        assert_eq!(start_mode(true, false, &shown, true), StartMode::Hidden);
        assert_eq!(
            start_mode(false, false, &minimized, true),
            StartMode::Hidden
        );
        assert_eq!(start_mode(true, false, &minimized, true), StartMode::Hidden);
    }

    #[test]
    fn without_a_tray_the_window_is_minimized_not_hidden() {
        let minimized = prefs(true, true);
        assert_eq!(
            start_mode(true, false, &minimized, false),
            StartMode::Minimized
        );
        assert_eq!(
            start_mode(false, false, &minimized, false),
            StartMode::Minimized
        );
        assert_eq!(
            start_mode(false, false, &prefs(true, false), false),
            StartMode::Show
        );
    }

    #[test]
    fn elevated_relaunch_ignores_start_minimized_but_keeps_tray() {
        assert_eq!(
            start_mode(false, true, &prefs(true, true), true),
            StartMode::Show
        );
        assert_eq!(
            start_mode(true, true, &prefs(true, false), true),
            StartMode::Hidden
        );
        assert_eq!(
            start_mode(true, true, &prefs(true, false), false),
            StartMode::Minimized
        );
    }
}
