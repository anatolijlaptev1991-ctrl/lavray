// SPDX-License-Identifier: GPL-3.0-only

//! Снимок экрана для поиска QR-кода (T-77).
//!
//! Окно LAVRay прячется, чтобы не закрывать код, через секунду снимается
//! главный монитор, и окно возвращается в любом случае — даже если снимок не
//! удался. Кадр уменьшается до 2000 пикселей по длинной стороне (больше
//! распознавателю не нужно, а передавать меньше) и уходит в UI одним бинарным
//! ответом: `[u32 ширина LE][u32 высота LE][RGBA]`. На диск снимок не пишется.

#[cfg(windows)]
mod gdi;

use std::time::Duration;

/// Длинная сторона кадра, который получает UI, пикселей.
pub const MAX_SIDE: u32 = 2000;
/// Сколько ждать после того, как окно спрятано: анимация скрытия в Windows.
pub const HIDE_DELAY: Duration = Duration::from_secs(1);

/// Кадр RGBA, строки сверху вниз без выравнивания.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Снимок экрана (в тестах — подставной).
pub trait ScreenCapturer {
    fn capture(&self) -> Result<Frame, String>;
}

/// Скрыть и вернуть окно (в тестах — подставное).
pub trait WindowControl {
    fn hide(&self) -> Result<(), String>;
    fn show(&self) -> Result<(), String>;
}

/// Спрятать окно, подождать, снять экран, вернуть окно, уменьшить кадр.
pub fn scan_screen<C, W>(
    capturer: &C,
    window: &W,
    delay: Duration,
    sleep: impl Fn(Duration),
) -> Result<Frame, String>
where
    C: ScreenCapturer,
    W: WindowControl,
{
    window.hide()?;
    sleep(delay);
    let frame = capturer.capture();
    let shown = window.show();
    let frame = frame?;
    shown?;
    Ok(downscale(&frame, MAX_SIDE))
}

/// Уменьшить кадр усреднением квадратов k×k так, чтобы длинная сторона была не
/// больше `max_side`. Кадр меньше — без изменений.
pub fn downscale(frame: &Frame, max_side: u32) -> Frame {
    let longest = frame.width.max(frame.height);
    if longest <= max_side || max_side == 0 {
        return frame.clone();
    }
    let k = longest.div_ceil(max_side);
    let (w, h) = ((frame.width / k).max(1), (frame.height / k).max(1));
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            rgba.extend_from_slice(&average(frame, x * k, y * k, k));
        }
    }
    Frame {
        width: w,
        height: h,
        rgba,
    }
}

fn average(frame: &Frame, x0: u32, y0: u32, k: u32) -> [u8; 4] {
    let mut sum = [0u32; 4];
    let mut n = 0u32;
    for y in y0..(y0 + k).min(frame.height) {
        for x in x0..(x0 + k).min(frame.width) {
            let at = ((y * frame.width + x) * 4) as usize;
            for (s, v) in sum.iter_mut().zip(&frame.rgba[at..at + 4]) {
                *s += u32::from(*v);
            }
            n += 1;
        }
    }
    sum.map(|s| (s / n.max(1)) as u8)
}

/// Бинарный ответ для UI: заголовок из ширины и высоты (LE), затем пиксели.
pub fn encode_payload(frame: &Frame) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + frame.rgba.len());
    out.extend_from_slice(&frame.width.to_le_bytes());
    out.extend_from_slice(&frame.height.to_le_bytes());
    out.extend_from_slice(&frame.rgba);
    out
}

/// Снимок главного монитора средствами ОС.
pub struct SystemCapturer;

impl ScreenCapturer for SystemCapturer {
    #[cfg(windows)]
    fn capture(&self) -> Result<Frame, String> {
        gdi::capture_primary()
    }

    #[cfg(not(windows))]
    fn capture(&self) -> Result<Frame, String> {
        Err("unsupported".into())
    }
}

struct TauriWindow(tauri::WebviewWindow);

impl WindowControl for TauriWindow {
    fn hide(&self) -> Result<(), String> {
        self.0.hide().map_err(|e| e.to_string())
    }

    fn show(&self) -> Result<(), String> {
        self.0.show().map_err(|e| e.to_string())?;
        let _ = self.0.set_focus();
        Ok(())
    }
}

/// qr_capture_screen — снимок экрана для QR (сырой ответ, формат выше).
#[tauri::command]
pub async fn qr_capture_screen(
    window: tauri::WebviewWindow,
) -> Result<tauri::ipc::Response, String> {
    let frame = tauri::async_runtime::spawn_blocking(move || {
        scan_screen(
            &SystemCapturer,
            &TauriWindow(window),
            HIDE_DELAY,
            std::thread::sleep,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(encode_payload(&frame)))
}

#[cfg(test)]
mod tests;
