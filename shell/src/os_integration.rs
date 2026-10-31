// SPDX-License-Identifier: GPL-3.0-only

//! Интеграция с ОС (T-82) в одном месте: плагины окна, уведомлений,
//! глобального сочетания и диалога «Сохранить как», их общее состояние и команды. `main.rs` только
//! подключает этот модуль.

use crate::hotkey::{self, register::HotkeySlot};
use crate::notify::{Notifier, NotifyGate, NotifyKind};
use crate::prefs::ShellPrefs;
use crate::window_geometry;
use std::path::PathBuf;
use std::time::Instant;
use tauri::{AppHandle, Runtime};
use tauri_plugin_notification::NotificationExt;

/// Каталог данных приложения (там `ui-state.json`) для команд библиотеки.
pub struct DataDir(pub PathBuf);

/// Подключить плагины и общее состояние к сборщику приложения.
pub fn attach<R: Runtime>(builder: tauri::Builder<R>, data_dir: PathBuf) -> tauri::Builder<R> {
    builder
        .plugin(window_geometry::plugin())
        .plugin(tauri_plugin_notification::init())
        .plugin(hotkey::plugin())
        .plugin(tauri_plugin_dialog::init())
        .manage(DataDir(data_dir))
        .manage(NotifyGate::default())
        .manage(HotkeySlot::default())
        .manage(crate::update::wiring::new_gate()) // T-75: замок «установка идёт»
}

/// После создания окна: зарегистрировать сохранённое сочетание.
pub fn on_setup<R: Runtime>(app: &AppHandle<R>, prefs: &ShellPrefs) {
    use tauri::Manager;
    let slot = app.state::<HotkeySlot>();
    hotkey::register_saved(app, &slot, prefs.hotkey_connect.as_deref());
}

struct PluginNotifier<'a, R: Runtime>(&'a AppHandle<R>);

impl<R: Runtime> Notifier for PluginNotifier<'_, R> {
    fn show(&self, title: &str, body: &str) -> Result<(), String> {
        self.0
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|e| e.to_string())
    }
}

/// notify_show — показать уведомление; `false` — подавлено (настройка
/// выключена или такое же было меньше 2 с назад). Тексты — из словарей UI.
#[tauri::command]
pub async fn notify_show(
    app: AppHandle,
    gate: tauri::State<'_, NotifyGate>,
    dir: tauri::State<'_, DataDir>,
    kind: String,
    title: String,
    body: String,
) -> Result<bool, String> {
    let kind = NotifyKind::parse(&kind).ok_or("unknown_kind")?;
    let enabled = ShellPrefs::load(&dir.0).notify;
    gate.show(
        &PluginNotifier(&app),
        enabled,
        kind,
        &title,
        &body,
        Instant::now(),
    )
}
