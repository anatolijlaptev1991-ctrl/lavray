// SPDX-License-Identifier: GPL-3.0-only

//! Интеграция с ОС (T-82) в одном месте: плагины окна, уведомлений,
//! глобального сочетания и диалога «Сохранить как», их общее состояние и команды. `main.rs` только
//! подключает этот модуль.

use crate::endpoint::{EndpointEvent, CORE_ENDPOINT_EVENT};
use crate::hotkey::{self, register::HotkeySlot};
use crate::killswitch::{self, CrashSink, Exit, Outcome, ProxyFlags};
use crate::notify::{Notifier, NotifyGate, NotifyKind};
use crate::prefs::ShellPrefs;
use crate::window_geometry;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, Runtime};
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
        .manage(ProxyFlags::default())
        .manage(HotkeySlot::default())
        .manage(crate::update::wiring::new_gate()) // T-75: замок «установка идёт»
}

/// После создания окна: зарегистрировать сохранённое сочетание.
pub fn on_setup<R: Runtime>(app: &AppHandle<R>, prefs: &ShellPrefs) {
    use tauri::Manager;
    let slot = app.state::<HotkeySlot>();
    hotkey::register_saved(app, &slot, prefs.hotkey_connect.as_deref());
}

/// Смерть ядра в приложении: решение о прокси, флаг в [`ProxyFlags`] и события окну.
struct AppCrash<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    data_dir: &'a Path,
}

impl<R: Runtime> AppCrash<'_, R> {
    fn flags(&self) -> tauri::State<'_, ProxyFlags> {
        self.app.state::<ProxyFlags>()
    }
}

impl<R: Runtime> CrashSink for AppCrash<'_, R> {
    fn decide(&self) -> Outcome {
        killswitch::apply_exit(self.data_dir, Exit::CoreCrashed, self.flags().is_active())
    }

    fn record(&self, outcome: &Outcome) {
        let flags = self.flags();
        flags.set_kept(*outcome == Outcome::Kept);
        if *outcome == Outcome::Released {
            flags.set_active(false); // прокси возвращён
        }
        if let Outcome::Failed(e) = outcome {
            eprintln!("LAVRay: не удалось снять системный прокси после падения ядра: {e}");
        }
    }

    fn emit_kept(&self) {
        let _ = self.app.emit_to("main", killswitch::PROXY_KEPT_EVENT, ());
    }

    fn emit_down(&self) {
        if let Err(e) = self
            .app
            .emit_to("main", CORE_ENDPOINT_EVENT, EndpointEvent::down())
        {
            eprintln!("LAVRay: не удалось отправить {CORE_ENDPOINT_EVENT}: {e}");
        }
    }
}

/// Ядро умерло (T-03, хвосты B): вернуть системный прокси из снимка или, при
/// включённом kill switch, оставить его. Порядок важен (`killswitch::handle_core_crash`):
/// флаг «оставлен» ставится раньше событий, а событие `core-endpoint` «адреса нет»
/// уходит последним. Интерфейс покажет уведомление и пометит трей: тексты на языке
/// интерфейса знает только он.
pub fn on_core_crash<R: Runtime>(app: &AppHandle<R>, data_dir: &Path) {
    killswitch::handle_core_crash(&AppCrash { app, data_dir });
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
