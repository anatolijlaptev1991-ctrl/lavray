// SPDX-License-Identifier: GPL-3.0-only

//! Событие `window-visibility` (`true` — окно видно): интерфейс по нему
//! останавливает опросы и анимации в скрытом окне. `document.hidden` в WebKitGTK
//! для окна, спрятанного через `hide()` или созданного скрытым, не выставляется,
//! поэтому оболочка сообщает сама. Свёрнутое окно считается невидимым.

use std::sync::atomic::{AtomicU8, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Имя события окну `main`.
pub const EVENT: &str = "window-visibility";

/// Окно видно пользователю: показано и не свёрнуто.
#[must_use]
pub fn is_visible(shown: bool, minimized: bool) -> bool {
    shown && !minimized
}

/// Последнее отправленное значение: 0 — ничего, 1 — скрыто, 2 — видно.
#[derive(Debug, Default)]
pub struct Gate(AtomicU8);

impl Gate {
    #[must_use]
    pub const fn new() -> Self {
        Self(AtomicU8::new(0))
    }

    /// Запомнить значение; `true` — оно отличается от прежнего (надо слать).
    pub fn changed(&self, visible: bool) -> bool {
        let code = if visible { 2 } else { 1 };
        self.0.swap(code, Ordering::SeqCst) != code
    }
}

static LAST: Gate = Gate::new();

fn current<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window("main").is_some_and(|w| {
        is_visible(
            w.is_visible().unwrap_or(false),
            w.is_minimized().unwrap_or(false),
        )
    })
}

fn send<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    if let Err(e) = app.emit_to("main", EVENT, visible) {
        eprintln!("LAVRay: не удалось отправить {EVENT}: {e}");
    }
}

/// Пересчитать по состоянию окна и отправить, если значение сменилось.
pub fn report<R: Runtime>(app: &AppHandle<R>) {
    let visible = current(app);
    if LAST.changed(visible) {
        send(app, visible);
    }
}

/// Отправить заданное значение, если оно сменилось (свёртка: состояние окна
/// обновляется позже самого вызова, поэтому ему не верим).
pub fn report_as<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    if LAST.changed(visible) {
        send(app, visible);
    }
}

/// Отправить текущее значение безусловно: страница загрузилась и подписалась.
pub fn emit_current<R: Runtime>(app: &AppHandle<R>) {
    let visible = current(app);
    LAST.changed(visible);
    send(app, visible);
}

/// Команда `window_visible`: видно ли окно сейчас. Интерфейс подписывается на
/// событие асинхронно и может опоздать к отправке при загрузке страницы, поэтому
/// после подписки спрашивает текущее значение сам.
#[tauri::command]
#[must_use]
pub fn window_visible(app: AppHandle) -> bool {
    current(&app)
}

/// Обработчик загрузки страницы: она подписалась — отправить видимость.
pub fn on_page_load<R: Runtime>(
    webview: &tauri::Webview<R>,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
        emit_current(webview.app_handle());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_shown_unminimized_window_is_visible() {
        assert!(is_visible(true, false));
        assert!(!is_visible(true, true), "свёрнутое — невидимо");
        assert!(!is_visible(false, false), "спрятанное — невидимо");
        assert!(!is_visible(false, true));
    }

    #[test]
    fn the_gate_reports_only_changes() {
        let gate = Gate::new();
        assert!(gate.changed(false), "первое значение уходит всегда");
        assert!(!gate.changed(false));
        assert!(gate.changed(true));
        assert!(!gate.changed(true));
        assert!(gate.changed(false));
    }
}
