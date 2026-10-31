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
/// После перезапуска от администратора (`elevated_relaunch`) «Запускать
/// свёрнутым» не действует: пользователь только что нажал кнопку и ждёт окно.
/// `--tray` при этом передаётся, только если окно было скрыто, — его слушаем.
pub fn start_hidden(tray_flag: bool, elevated_relaunch: bool, prefs: &ShellPrefs) -> bool {
    if elevated_relaunch {
        return tray_flag;
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
    fn elevated_relaunch_ignores_start_minimized_but_keeps_tray() {
        assert!(
            !start_hidden(false, true, &prefs(true, true)),
            "окно было видно — показать"
        );
        assert!(
            start_hidden(true, true, &prefs(true, false)),
            "окно было скрыто (--tray) — остаётся скрытым"
        );
    }
}
