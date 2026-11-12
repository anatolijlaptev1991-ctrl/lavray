// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use std::cell::RefCell;

/// Окно в памяти: журнал вызовов, можно сломать скрытие.
#[derive(Default)]
struct FakeWindow {
    log: RefCell<Vec<&'static str>>,
    fail_hide: bool,
}

impl WindowControl for FakeWindow {
    fn hide(&self) -> Result<(), String> {
        self.log.borrow_mut().push("hide");
        if self.fail_hide {
            Err("hide failed".into())
        } else {
            Ok(())
        }
    }

    fn show(&self) -> Result<(), String> {
        self.log.borrow_mut().push("show");
        Ok(())
    }
}

struct FakeScreen {
    result: RefCell<Option<Result<Frame, String>>>,
    log: RefCell<Vec<&'static str>>,
}

impl FakeScreen {
    fn answering(result: Result<Frame, String>) -> Self {
        Self {
            result: RefCell::new(Some(result)),
            log: RefCell::new(Vec::new()),
        }
    }
}

impl ScreenCapturer for FakeScreen {
    fn capture(&self) -> Result<Frame, String> {
        self.log.borrow_mut().push("capture");
        self.result
            .borrow_mut()
            .take()
            .expect("кадр отдают один раз")
    }
}

fn solid(width: u32, height: u32, px: [u8; 4]) -> Frame {
    Frame {
        width,
        height,
        rgba: px.repeat((width * height) as usize),
    }
}

#[test]
fn hides_waits_captures_then_shows() {
    let (win, screen) = (
        FakeWindow::default(),
        FakeScreen::answering(Ok(solid(4, 2, [1, 2, 3, 255]))),
    );
    let slept = RefCell::new(Vec::new());
    let frame = scan_screen(&screen, &win, HIDE_DELAY, |d| slept.borrow_mut().push(d)).unwrap();
    assert_eq!(*win.log.borrow(), ["hide", "show"]);
    assert_eq!(*screen.log.borrow(), ["capture"]);
    assert_eq!(frame, encode_payload(&solid(4, 2, [1, 2, 3, 255])));
    assert_eq!(*slept.borrow(), [HIDE_DELAY]);
}

#[test]
fn delay_respected() {
    assert_eq!(HIDE_DELAY, Duration::from_secs(1));
    let (win, screen) = (
        FakeWindow::default(),
        FakeScreen::answering(Ok(solid(1, 1, [0; 4]))),
    );
    let slept = RefCell::new(Duration::ZERO);
    scan_screen(&screen, &win, Duration::from_millis(1234), |d| {
        *slept.borrow_mut() += d;
    })
    .unwrap();
    assert_eq!(*slept.borrow(), Duration::from_millis(1234));
}

#[test]
fn window_restored_even_on_capture_error() {
    let (win, screen) = (
        FakeWindow::default(),
        FakeScreen::answering(Err("BitBlt".into())),
    );
    let err = scan_screen(&screen, &win, Duration::ZERO, |_| {}).unwrap_err();
    assert_eq!(err, "BitBlt");
    assert_eq!(*win.log.borrow(), ["hide", "show"], "окно вернули");
}

#[test]
fn failed_hide_does_not_capture() {
    let win = FakeWindow {
        fail_hide: true,
        ..FakeWindow::default()
    };
    let screen = FakeScreen::answering(Ok(solid(1, 1, [0; 4])));
    assert!(scan_screen(&screen, &win, Duration::ZERO, |_| {}).is_err());
    assert!(
        screen.log.borrow().is_empty(),
        "с окном на экране не снимаем"
    );
}

#[test]
fn downscale_max_side() {
    let big = solid(3840, 2160, [10, 20, 30, 255]);
    let small = downscale(big, MAX_SIDE);
    assert_eq!((small.width, small.height), (1920, 1080));
    assert_eq!(small.rgba.len(), 1920 * 1080 * 4);
    assert_eq!(&small.rgba[..4], &[10, 20, 30, 255]);
    let odd = downscale(solid(4001, 10, [0; 4]), MAX_SIDE);
    assert!(odd.width <= MAX_SIDE, "{}", odd.width);
}

#[test]
fn downscale_keeps_small_frames() {
    let f = solid(2000, 1000, [1; 4]);
    let ptr = f.rgba.as_ptr();
    let same = downscale(f, MAX_SIDE);
    assert_eq!(same, solid(2000, 1000, [1; 4]), "ровно на пределе");
    assert_eq!(same.rgba.as_ptr(), ptr, "буфер перемещён, не скопирован");
    assert_eq!(downscale(solid(5, 5, [1; 4]), MAX_SIDE).width, 5);
}

#[test]
fn downscale_averages_blocks() {
    // 2×2 → 1×1 при k=2: среднее чёрного и белого.
    let f = Frame {
        width: 2,
        height: 2,
        rgba: [
            [0, 0, 0, 255],
            [255, 255, 255, 255],
            [0, 0, 0, 255],
            [255, 255, 255, 255],
        ]
        .concat(),
    };
    assert_eq!(downscale(f, 1).rgba, vec![127, 127, 127, 255]);
}

#[test]
fn payload_header_le() {
    let p = encode_payload(&solid(258, 3, [9, 8, 7, 6]));
    assert_eq!(&p[..4], &[2, 1, 0, 0], "258 = 0x0102 LE");
    assert_eq!(&p[4..8], &[3, 0, 0, 0]);
    assert_eq!(p.len(), 8 + 258 * 3 * 4);
    assert_eq!(&p[8..12], &[9, 8, 7, 6]);
}

#[cfg(windows)]
#[test]
fn bgra_is_swapped_and_opaque() {
    let mut px = vec![1, 2, 3, 0, 10, 20, 30, 0];
    gdi::bgra_to_rgba(&mut px);
    assert_eq!(px, [3, 2, 1, 255, 30, 20, 10, 255]);
}

/// Снимок экрана только читает: в CI (без рабочего стола) GDI может отказать,
/// тогда — ошибка, а не паника; при успехе размеры и длина буфера согласованы.
#[cfg(windows)]
#[test]
fn gdi_capture_nonzero_dimensions() {
    match gdi::capture_primary() {
        Ok(f) => {
            assert!(f.width > 0 && f.height > 0);
            assert_eq!(f.rgba.len(), (f.width * f.height * 4) as usize);
        }
        Err(e) => assert!(!e.is_empty()),
    }
}

/// Градиентный кадр: блоки усреднения различаются, ошибка индексации видна.
fn gradient(width: u32, height: u32) -> Frame {
    let rgba = (0..width * height * 4)
        .map(|i| (i * 7 % 251) as u8)
        .collect();
    Frame {
        width,
        height,
        rgba,
    }
}

#[test]
fn payload_golden_bytes_when_downscaled() {
    // 4×2 при max_side=2: k=2, результат 2×1; блоки усредняются по каналам.
    let f = Frame {
        width: 4,
        height: 2,
        rgba: vec![
            0, 0, 0, 255, 4, 8, 12, 255, 100, 0, 0, 255, 100, 0, 0, 255, //
            0, 0, 0, 255, 4, 8, 12, 255, 100, 0, 0, 255, 100, 0, 0, 255,
        ],
    };
    let out = downscale_payload(f, 2);
    assert_eq!(
        out,
        [2, 0, 0, 0, 1, 0, 0, 0, 2, 4, 6, 255, 100, 0, 0, 255],
        "заголовок LE + усреднённые пиксели"
    );
}

#[test]
fn payload_matches_downscale_then_encode() {
    for (w, h, max) in [(9, 7, 4), (13, 3, 5), (6, 6, 6), (5, 4, 100), (7, 11, 0)] {
        let expected = encode_payload(&downscale(gradient(w, h), max));
        let got = downscale_payload(gradient(w, h), max);
        assert_eq!(got, expected, "{w}x{h} max={max}");
        assert_eq!(got.capacity(), got.len(), "ёмкость точная");
    }
}
