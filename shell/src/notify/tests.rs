// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use std::cell::RefCell;

#[derive(Default)]
struct Recorder(RefCell<Vec<(String, String)>>);

impl Notifier for Recorder {
    fn show(&self, title: &str, body: &str) -> Result<(), String> {
        self.0.borrow_mut().push((title.into(), body.into()));
        Ok(())
    }
}

struct Failing;

impl Notifier for Failing {
    fn show(&self, _: &str, _: &str) -> Result<(), String> {
        Err("toast failed".into())
    }
}

#[test]
fn notify_shows_when_enabled() {
    let (gate, rec) = (NotifyGate::default(), Recorder::default());
    let shown = gate.show(
        &rec,
        true,
        NotifyKind::Connected,
        "LAVRay",
        "Подключено",
        Instant::now(),
    );
    assert_eq!(shown, Ok(true));
    assert_eq!(
        rec.0.borrow().as_slice(),
        [("LAVRay".to_string(), "Подключено".to_string())]
    );
}

#[test]
fn notify_disabled_suppresses() {
    let (gate, rec) = (NotifyGate::default(), Recorder::default());
    let shown = gate.show(&rec, false, NotifyKind::Error, "t", "b", Instant::now());
    assert_eq!(shown, Ok(false));
    assert!(rec.0.borrow().is_empty());
}

#[test]
fn notify_rate_limited_per_kind() {
    let (gate, rec) = (NotifyGate::default(), Recorder::default());
    let t0 = Instant::now();
    let show = |kind, at| gate.show(&rec, true, kind, "t", "b", at).unwrap();
    assert!(show(NotifyKind::Connected, t0));
    assert!(
        !show(NotifyKind::Connected, t0 + Duration::from_millis(1999)),
        "дребезг"
    );
    assert!(
        show(NotifyKind::Disconnected, t0 + Duration::from_millis(10)),
        "другой вид"
    );
    assert!(
        show(NotifyKind::Connected, t0 + MIN_INTERVAL),
        "интервал прошёл"
    );
    assert_eq!(rec.0.borrow().len(), 3);
}

#[test]
fn suppressed_call_does_not_extend_the_window() {
    let (gate, rec) = (NotifyGate::default(), Recorder::default());
    let t0 = Instant::now();
    assert!(gate
        .show(&rec, true, NotifyKind::Error, "t", "b", t0)
        .unwrap());
    assert!(!gate
        .show(
            &rec,
            true,
            NotifyKind::Error,
            "t",
            "b",
            t0 + Duration::from_millis(1500)
        )
        .unwrap());
    assert!(gate
        .show(
            &rec,
            true,
            NotifyKind::Error,
            "t",
            "b",
            t0 + Duration::from_secs(2)
        )
        .unwrap());
}

#[test]
fn notify_caps_length_by_chars() {
    let (gate, rec) = (NotifyGate::default(), Recorder::default());
    let title = "Я".repeat(500);
    let body = "汉".repeat(500);
    gate.show(&rec, true, NotifyKind::Error, &title, &body, Instant::now())
        .unwrap();
    let (t, b) = rec.0.borrow()[0].clone();
    assert_eq!(t.chars().count(), MAX_TITLE_CHARS);
    assert_eq!(b.chars().count(), MAX_BODY_CHARS);
    assert!(t.ends_with('…') && b.ends_with('…'));
    assert_eq!(clamp("  short  ", 10), "short");
    assert_eq!(clamp("", 10), "");
}

#[test]
fn notifier_failure_is_reported() {
    let gate = NotifyGate::default();
    let shown = gate.show(&Failing, true, NotifyKind::Error, "t", "b", Instant::now());
    assert_eq!(shown, Err("toast failed".into()));
}

#[test]
fn kinds_parse_strictly() {
    assert_eq!(NotifyKind::parse("connected"), Some(NotifyKind::Connected));
    assert_eq!(
        NotifyKind::parse("disconnected"),
        Some(NotifyKind::Disconnected)
    );
    assert_eq!(NotifyKind::parse("error"), Some(NotifyKind::Error));
    assert_eq!(NotifyKind::parse("Connected"), None);
    assert_eq!(NotifyKind::parse(""), None);
}
