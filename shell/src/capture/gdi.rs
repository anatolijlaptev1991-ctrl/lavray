// SPDX-License-Identifier: GPL-3.0-only

//! Снимок главного монитора через GDI (T-77): BitBlt экранного контекста в
//! совместимый битмап, GetDIBits в 32-битный top-down буфер, BGRA → RGBA.
//! Все созданные объекты GDI освобождаются на любом пути выхода.

use super::Frame;
use std::ptr::null_mut;
use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
    SRCCOPY,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

/// Наибольшая сторона снимка, пикселей: защита от нелепого ответа ОС.
const MAX_SCREEN_SIDE: i32 = 16384;

/// Контексты и битмап снимка; Drop освобождает их в обратном порядке.
struct Gdi {
    screen: HDC,
    mem: HDC,
    bitmap: HBITMAP,
}

impl Drop for Gdi {
    fn drop(&mut self) {
        // SAFETY: дескрипторы созданы в `capture_primary` и больше нигде не используются.
        unsafe {
            if !self.bitmap.is_null() {
                DeleteObject(self.bitmap);
            }
            if !self.mem.is_null() {
                DeleteDC(self.mem);
            }
            if !self.screen.is_null() {
                ReleaseDC(null_mut(), self.screen);
            }
        }
    }
}

/// Снять главный монитор.
pub fn capture_primary() -> Result<Frame, String> {
    // SAFETY: вызовы GDI с дескрипторами, которые проверяются на null; буфер
    // GetDIBits выделен ровно под width×height×4 байт.
    unsafe {
        let (w, h) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
        if w <= 0 || h <= 0 || w > MAX_SCREEN_SIDE || h > MAX_SCREEN_SIDE {
            return Err(format!("размер экрана {w}×{h}"));
        }
        let mut g = Gdi {
            screen: GetDC(null_mut()),
            mem: null_mut(),
            bitmap: null_mut(),
        };
        if g.screen.is_null() {
            return Err("GetDC".into());
        }
        g.mem = CreateCompatibleDC(g.screen);
        g.bitmap = CreateCompatibleBitmap(g.screen, w, h);
        if g.mem.is_null() || g.bitmap.is_null() {
            return Err("CreateCompatibleBitmap".into());
        }
        let old = SelectObject(g.mem, g.bitmap);
        let copied = BitBlt(g.mem, 0, 0, w, h, g.screen, 0, 0, SRCCOPY);
        SelectObject(g.mem, old);
        if copied == 0 {
            return Err("BitBlt".into());
        }
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = w;
        info.bmiHeader.biHeight = -h; // top-down: строки сверху вниз
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut rgba = vec![0u8; (w as usize) * (h as usize) * 4];
        let lines = GetDIBits(
            g.mem,
            g.bitmap,
            0,
            h as u32,
            rgba.as_mut_ptr().cast(),
            &mut info,
            DIB_RGB_COLORS,
        );
        if lines != h {
            return Err("GetDIBits".into());
        }
        bgra_to_rgba(&mut rgba);
        Ok(Frame {
            width: w as u32,
            height: h as u32,
            rgba,
        })
    }
}

/// GDI отдаёт BGRA с пустой альфой: меняем каналы и делаем пиксели непрозрачными.
pub fn bgra_to_rgba(px: &mut [u8]) {
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2);
        p[3] = 255;
    }
}
