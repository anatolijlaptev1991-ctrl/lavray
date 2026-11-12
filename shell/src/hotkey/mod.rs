// SPDX-License-Identifier: GPL-3.0-only

//! Глобальное сочетание «подключить / отключить» (T-82).
//!
//! По умолчанию выключено. Сочетание задаёт UI (`hotkey_set`) и сохраняет в
//! `ui-state.json`; при запуске оболочка регистрирует сохранённое. Нажатие —
//! событие `hotkey-toggle-connect` окну: подключает UI, он знает профиль и
//! режимы. JS-права плагина в capabilities не выдаются.

pub mod accel;
pub mod register;

use accel::{parse_accel, Accel, Key};
use register::{HotkeyBackend, HotkeySlot};
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Событие окну при нажатии сочетания.
pub const EVENT: &str = "hotkey-toggle-connect";

/// Плагин: любое зарегистрированное сочетание (оно одно) — событие окну.
#[must_use]
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = app.emit_to("main", EVENT, ());
            }
        })
        .build()
}

/// Сочетание для плагина.
#[must_use]
pub fn shortcut(a: &Accel) -> Shortcut {
    let mut mods = Modifiers::empty();
    mods.set(Modifiers::CONTROL, a.mods.ctrl);
    mods.set(Modifiers::ALT, a.mods.alt);
    mods.set(Modifiers::SHIFT, a.mods.shift);
    Shortcut::new(Some(mods), code(a.key))
}

fn code(key: Key) -> Code {
    use Code::{
        Digit0, Digit1, Digit2, Digit3, Digit4, Digit5, Digit6, Digit7, Digit8, Digit9, KeyA, KeyB,
        KeyC, KeyD, KeyE, KeyF, KeyG, KeyH, KeyI, KeyJ, KeyK, KeyL, KeyM, KeyN, KeyO, KeyP, KeyQ,
        KeyR, KeyS, KeyT, KeyU, KeyV, KeyW, KeyX, KeyY, KeyZ, F1, F10, F11, F12, F13, F14, F15,
        F16, F17, F18, F19, F2, F20, F21, F22, F23, F24, F3, F4, F5, F6, F7, F8, F9,
    };
    const LETTERS: [Code; 26] = [
        KeyA, KeyB, KeyC, KeyD, KeyE, KeyF, KeyG, KeyH, KeyI, KeyJ, KeyK, KeyL, KeyM, KeyN, KeyO,
        KeyP, KeyQ, KeyR, KeyS, KeyT, KeyU, KeyV, KeyW, KeyX, KeyY, KeyZ,
    ];
    const DIGITS: [Code; 10] = [
        Digit0, Digit1, Digit2, Digit3, Digit4, Digit5, Digit6, Digit7, Digit8, Digit9,
    ];
    const FKEYS: [Code; 24] = [
        F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13, F14, F15, F16, F17, F18, F19, F20,
        F21, F22, F23, F24,
    ];
    match key {
        Key::Letter(c) => LETTERS[(c as u8 - b'A') as usize],
        Key::Digit(c) => DIGITS[(c as u8 - b'0') as usize],
        Key::F(n) => FKEYS[(n - 1) as usize],
    }
}

/// Регистрация через плагин.
pub struct PluginBackend<'a, R: Runtime>(pub &'a AppHandle<R>);

impl<R: Runtime> HotkeyBackend for PluginBackend<'_, R> {
    fn register(&self, accel: &Accel) -> Result<(), String> {
        self.0
            .global_shortcut()
            .register(shortcut(accel))
            .map_err(|e| e.to_string())
    }

    fn unregister(&self, accel: &Accel) -> Result<(), String> {
        self.0
            .global_shortcut()
            .unregister(shortcut(accel))
            .map_err(|e| e.to_string())
    }
}

/// Разобрать запрос UI: пусто — снять; иначе проверенное сочетание или код ошибки.
pub fn requested(raw: Option<&str>) -> Result<Option<Accel>, &'static str> {
    match raw.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => parse_accel(text).map(Some).map_err(accel::AccelError::code),
    }
}

/// `hotkey_set` — задать (`accel`) или снять (`null`) сочетание. Ответ —
/// нормальная запись сочетания (UI её сохраняет) или код ошибки:
/// `invalid_accel`, `no_modifier`, `reserved`, `conflict`.
#[tauri::command]
pub fn hotkey_set(
    app: AppHandle,
    slot: tauri::State<'_, HotkeySlot>,
    accel: Option<String>,
) -> Result<Option<String>, String> {
    let next = requested(accel.as_deref()).map_err(str::to_string)?;
    slot.set(&PluginBackend(&app), next)
        .map_err(|e| e.code().to_string())?;
    Ok(slot.current().map(|a| a.to_string()))
}

/// Зарегистрировать сохранённое сочетание при запуске; ошибка — в журнал.
pub fn register_saved<R: Runtime>(app: &AppHandle<R>, slot: &HotkeySlot, saved: Option<&str>) {
    match requested(saved) {
        Ok(None) => {}
        Ok(next) => {
            if let Err(e) = slot.set(&PluginBackend(app), next) {
                eprintln!("LAVRay: сочетание не зарегистрировано: {e:?}");
            }
        }
        Err(code) => eprintln!("LAVRay: сохранённое сочетание отклонено: {code}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requested_empty_clears() {
        assert_eq!(requested(None), Ok(None));
        assert_eq!(requested(Some("  ")), Ok(None));
    }

    #[test]
    fn requested_maps_error_codes() {
        assert_eq!(requested(Some("K")), Err("no_modifier"));
        assert_eq!(requested(Some("Win+K")), Err("reserved"));
        assert_eq!(requested(Some("Ctrl+Alt+Esc")), Err("invalid_accel"));
        assert!(requested(Some("Ctrl+Alt+K")).unwrap().is_some());
    }

    #[test]
    fn shortcut_maps_every_key() {
        for raw in [
            "Ctrl+Alt+A",
            "Ctrl+Alt+Z",
            "Ctrl+Shift+0",
            "Ctrl+Shift+9",
            "Ctrl+F1",
            "Alt+F24",
        ] {
            let a = parse_accel(raw).unwrap();
            let s = shortcut(&a);
            assert_eq!(s.mods.contains(Modifiers::CONTROL), a.mods.ctrl, "{raw}");
            assert_eq!(s.mods.contains(Modifiers::ALT), a.mods.alt, "{raw}");
            assert_eq!(s.mods.contains(Modifiers::SHIFT), a.mods.shift, "{raw}");
        }
        let s = shortcut(&parse_accel("Ctrl+Alt+K").unwrap());
        assert_eq!(s.key, Code::KeyK);
        assert_eq!(
            shortcut(&parse_accel("Ctrl+Shift+7").unwrap()).key,
            Code::Digit7
        );
        assert_eq!(shortcut(&parse_accel("Ctrl+F12").unwrap()).key, Code::F12);
    }
}
