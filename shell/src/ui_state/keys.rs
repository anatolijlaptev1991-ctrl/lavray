// SPDX-License-Identifier: GPL-3.0-only

//! Список ключей `ui-state.json` (вынесен из `ui_state.rs`: растёт с каждой
//! настройкой UI, которую нужно видеть обоим экземплярам и оболочке).

/// Ключи `localStorage`, которые общие для двух профилей WebView. Список
/// повторяет `ui/src/lib/uiState.ts` (сверяется тестом).
pub const ALLOWED_KEYS: [&str; 12] = [
    "lavray.lang",
    "lavray.theme",
    "lavray.accent",
    "lavray.modes",
    "lavray.server",
    "lavray.onboarded",
    crate::prefs::CLOSE_TO_TRAY,
    crate::prefs::START_MINIMIZED,
    crate::prefs::NOTIFY,
    crate::prefs::HOTKEY_CONNECT,
    crate::prefs::KILL_SWITCH_PROXY,
    "lavray.pendingConnect",
];
