// SPDX-License-Identifier: GPL-3.0-only

//! Размер и место окна между запусками (T-82).
//!
//! Сохраняет и восстанавливает плагин window-state (размер, позиция,
//! развёрнутость; видимость — нет, её решает `window_policy`). Плагин ставит
//! позицию, если на каком-нибудь мониторе виден хотя бы угол окна. Окну без
//! рамки этого мало: заголовок, за который его тащат, может оказаться за краем
//! (отключили второй монитор, сменили масштаб). Поэтому после восстановления
//! проверяем полосу заголовка и, если за неё не ухватиться, ставим окно в центр.

/// Прямоугольник в физических пикселях.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Высота полосы заголовка, за которую тащат окно, пикселей.
const TITLE_BAR_HEIGHT: i32 = 32;
/// Сколько заголовка по ширине должно быть на мониторе, чтобы за него ухватиться.
const MIN_GRAB_WIDTH: i32 = 100;

fn right(r: &Rect) -> i32 {
    r.x.saturating_add(r.width.min(i32::MAX as u32) as i32)
}

fn bottom(r: &Rect) -> i32 {
    r.y.saturating_add(r.height.min(i32::MAX as u32) as i32)
}

/// За заголовок окна можно ухватиться хотя бы на одном мониторе.
///
/// Список мониторов пуст (ОС не ответила) — считаем, что можно: двигать окно
/// вслепую хуже, чем оставить как есть.
pub fn title_bar_reachable(window: &Rect, monitors: &[Rect]) -> bool {
    if monitors.is_empty() {
        return true;
    }
    let need = MIN_GRAB_WIDTH
        .min(window.width.min(i32::MAX as u32) as i32)
        .max(1);
    let grab_y = window.y.saturating_add(TITLE_BAR_HEIGHT / 2);
    monitors.iter().any(|m| {
        let overlap = right(window).min(right(m)) - window.x.max(m.x);
        overlap >= need && grab_y >= m.y && grab_y < bottom(m)
    })
}

/// Плагин window-state: размер, позиция и развёрнутость, без видимости и рамки.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_window_state::{Builder, StateFlags};
    Builder::new()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
        .build()
}

/// Поставить окно в центр, если до его заголовка не дотянуться.
pub fn ensure_reachable<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let (Ok(pos), Ok(size), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.available_monitors(),
    ) else {
        return;
    };
    let rect = Rect {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    };
    let screens: Vec<Rect> = monitors
        .iter()
        .map(|m| Rect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect();
    if !title_bar_reachable(&rect, &screens) {
        let _ = window.center();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FHD: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };
    const RIGHT_SCREEN: Rect = Rect {
        x: 1920,
        y: 0,
        width: 1920,
        height: 1080,
    };

    fn win(x: i32, y: i32) -> Rect {
        Rect {
            x,
            y,
            width: 1100,
            height: 720,
        }
    }

    #[test]
    fn window_on_screen_is_reachable() {
        assert!(title_bar_reachable(&win(100, 100), &[FHD]));
    }

    #[test]
    fn geometry_offscreen_recentred() {
        // Окно было на втором мониторе, его отключили.
        assert!(!title_bar_reachable(&win(2200, 100), &[FHD]));
        assert!(title_bar_reachable(&win(2200, 100), &[FHD, RIGHT_SCREEN]));
    }

    #[test]
    fn title_above_screen_is_unreachable_even_if_corner_visible() {
        // Нижний угол на экране (плагин позицию поставит), заголовок — над экраном.
        assert!(!title_bar_reachable(&win(100, -400), &[FHD]));
    }

    #[test]
    fn sliver_at_edge_is_unreachable() {
        // Видно 40 пикселей заголовка у правого края — не ухватиться.
        assert!(!title_bar_reachable(&win(1880, 100), &[FHD]));
        assert!(title_bar_reachable(&win(1800, 100), &[FHD]));
    }

    #[test]
    fn negative_coordinates_left_monitor() {
        let left = Rect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert!(title_bar_reachable(&win(-1500, 50), &[left, FHD]));
        assert!(!title_bar_reachable(&win(-1500, 50), &[FHD]));
    }

    #[test]
    fn no_monitor_info_leaves_window() {
        assert!(title_bar_reachable(&win(99_999, 99_999), &[]));
    }

    #[test]
    fn huge_values_do_not_overflow() {
        let w = Rect {
            x: i32::MAX - 10,
            y: i32::MAX - 10,
            width: u32::MAX,
            height: u32::MAX,
        };
        assert!(!title_bar_reachable(&w, &[FHD]));
    }
}
