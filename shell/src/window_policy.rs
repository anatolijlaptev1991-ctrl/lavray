// SPDX-License-Identifier: GPL-3.0-only

//! Решения о главном окне (T-82): что делает крестик и показывать ли окно на
//! старте. Чистые функции от настроек — `main.rs` только исполняет решение.

use crate::prefs::ShellPrefs;

/// Что делать по крестику окна.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Спрятать окно в трей: ядро и прокси продолжают работать.
    Hide,
    /// Полный выход, как «Выход» в меню трея: ядро останавливается, прокси снимается.
    Quit,
}

/// Решение по крестику.
pub fn on_close(prefs: &ShellPrefs) -> CloseAction {
    if prefs.close_to_tray {
        CloseAction::Hide
    } else {
        CloseAction::Quit
    }
}

/// Оставить ли окно скрытым на старте: `--tray` (автозапуск) или «Запускать свёрнутым».
///
/// Повторный запуск после перезапуска от администратора (`elevated_relaunch`)
/// всегда показывает окно: пользователь только что нажал кнопку и ждёт его.
pub fn start_hidden(tray_flag: bool, elevated_relaunch: bool, prefs: &ShellPrefs) -> bool {
    if elevated_relaunch {
        return false;
    }
    tray_flag || prefs.start_minimized
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
        assert_eq!(on_close(&prefs(true, false)), CloseAction::Hide);
        assert_eq!(on_close(&ShellPrefs::default()), CloseAction::Hide);
    }

    #[test]
    fn close_quits_when_disabled() {
        assert_eq!(on_close(&prefs(false, false)), CloseAction::Quit);
    }

    #[test]
    fn start_hidden_by_flag_or_pref() {
        let shown = prefs(true, false);
        let minimized = prefs(true, true);
        assert!(
            !start_hidden(false, false, &shown),
            "обычный запуск — окно видно"
        );
        assert!(start_hidden(true, false, &shown), "--tray прячет окно");
        assert!(
            start_hidden(false, false, &minimized),
            "«Запускать свёрнутым»"
        );
        assert!(start_hidden(true, false, &minimized));
    }

    #[test]
    fn elevated_relaunch_always_shows_window() {
        assert!(!start_hidden(true, true, &prefs(true, true)));
        assert!(!start_hidden(false, true, &prefs(true, true)));
    }
}
