// SPDX-License-Identifier: GPL-3.0-only

//! Рантайм трея: значок и меню по `TrayMenuSpec`; что показать, решает
//! `lavray_shell::tray::view` (проверяется тестами), здесь только вызовы Tauri.
//! Менять значок можно лишь в главном потоке (`run_on_main_thread`): так
//! мьютекс состояния берёт только он, и взаимной блокировки с ним не бывает.

use std::sync::{Arc, Mutex};

use lavray_shell::tray::{
    icon_png, view, TrayEntry, TrayMenuBuilder, TrayMenuItem, TrayUpdate, TRAY_ID,
};
use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Theme, Wry};

use crate::RuntimeState;

/// Событие для UI: выбрано «Подключить» или «Отключить» (`"connect"` /
/// `"disconnect"`). Подключением (профиль, режимы, прокси) занимается UI.
const ACTION_EVENT: &str = "tray-action";

struct Handles {
    tray: TrayIcon<Wry>,
    items: Vec<(TrayMenuItem, MenuItem<Wry>)>,
    last: TrayUpdate,
}

/// Состояние трея в `app.manage`.
pub struct TrayUi(Mutex<Handles>);

/// Развернуть и показать главное окно: `show()` и `set_focus()` свёрнутое окно
/// не разворачивают (tao), поэтому сначала `unminimize()`.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        lavray_shell::window_visibility::report(app);
    }
}

fn core_alive(app: &AppHandle) -> bool {
    app.try_state::<Arc<Mutex<RuntimeState>>>()
        .is_some_and(|state| {
            state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .core_alive
        })
}

/// Светлый значок — для тёмной темы окна (и когда тема неизвестна).
fn dark_theme(app: &AppHandle) -> bool {
    let theme = app.get_webview_window("main").and_then(|w| w.theme().ok());
    !matches!(theme, Some(Theme::Light))
}

/// Создать значок и меню; пока UI не прислал строки — английские, а «Подключить»
/// недоступно (ядро ещё не готово).
pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let last = TrayUpdate::default();
    let first = view(&last, core_alive(handle));
    let menu = Menu::new(handle)?;
    let mut items = Vec::new();
    for entry in TrayMenuBuilder::standard().entries() {
        match entry {
            TrayEntry::Item(kind) => {
                let shown = first.item(*kind).expect("пункт из TrayMenuSpec");
                let id = kind.id();
                let item = MenuItem::with_id(handle, id, &shown.text, shown.enabled, None::<&str>)?;
                menu.append(&item)?;
                items.push((*kind, item));
            }
            TrayEntry::Separator => menu.append(&PredefinedMenuItem::separator(handle)?)?,
        }
    }
    let icon = Image::from_bytes(icon_png(first.icon, dark_theme(handle)))?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(&first.tooltip)
        .icon(icon)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(on_tray_icon_event)
        .build(handle)?;
    app.manage(TrayUi(Mutex::new(Handles { tray, items, last })));
    refresh(handle); // ядро могло ожить, пока строился трей
    Ok(())
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match TrayMenuItem::from_id(event.id.as_ref()) {
        Some(TrayMenuItem::ShowWindow) => show_main_window(app),
        Some(TrayMenuItem::Exit) => crate::begin_quit(app), // не блокирует
        Some(TrayMenuItem::Connect) => {
            let _ = app.emit_to("main", ACTION_EVENT, "connect");
        }
        Some(TrayMenuItem::Disconnect) => {
            let _ = app.emit_to("main", ACTION_EVENT, "disconnect");
        }
        Some(TrayMenuItem::Status | TrayMenuItem::Server) | None => {}
    }
}

fn on_tray_icon_event(tray: &TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        show_main_window(tray.app_handle());
    }
}

/// Применить сообщение UI (`Some`) либо пересчитать вид по состоянию ядра
/// (`None`: процесс ядра ожил или умер, сменилась тема). Возвращается сразу.
pub fn apply(app: &AppHandle, update: Option<TrayUpdate>) -> Result<(), String> {
    let (alive, target) = (core_alive(app), app.clone());
    app.run_on_main_thread(move || render(&target, update, alive))
        .map_err(|e| e.to_string())
}

pub fn refresh(app: &AppHandle) {
    let _ = apply(app, None);
}

/// Спрятать окна и значок (выход из приложения). Возвращается сразу.
pub fn hide(app: &AppHandle) {
    let target = app.clone();
    let _ = app.run_on_main_thread(move || {
        for window in target.webview_windows().values() {
            let _ = window.hide();
        }
        if let Some(ui) = target.try_state::<TrayUi>() {
            let handles =
                ui.0.lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
            let _ = handles.tray.set_visible(false);
        }
    });
}

/// Рисование; только в главном потоке.
fn render(app: &AppHandle, update: Option<TrayUpdate>, alive: bool) {
    let Some(ui) = app.try_state::<TrayUi>() else {
        return;
    };
    let mut handles =
        ui.0.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(update) = update {
        handles.last = update;
    }
    let target = view(&handles.last, alive);
    for shown in &target.items {
        if let Some((_, item)) = handles.items.iter().find(|(kind, _)| *kind == shown.item) {
            let _ = item.set_text(&shown.text);
            let _ = item.set_enabled(shown.enabled);
        }
    }
    if let Ok(icon) = Image::from_bytes(icon_png(target.icon, dark_theme(app))) {
        let _ = handles.tray.set_icon(Some(icon));
    }
    let _ = handles.tray.set_tooltip(Some(&target.tooltip));
}
