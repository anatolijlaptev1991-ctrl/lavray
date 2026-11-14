// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use std::time::Duration;

#[test]
fn windows_keeps_the_old_flow_and_has_everything() {
    let caps = build(Os::Windows, "", "installed", true);
    assert_eq!(caps.os, "windows");
    assert_eq!(caps.tun_access, "admin");
    assert!(caps.screen_capture && caps.self_update && caps.global_hotkeys && caps.tray_available);
}

#[test]
fn linux_grants_instead_of_elevating_and_loses_capture_and_update() {
    let caps = build(Os::Linux, "wayland", "deb", true);
    assert_eq!((caps.os, caps.tun_access), ("linux", "grant"));
    assert!(!caps.screen_capture && !caps.self_update);
    assert_eq!(caps.session_type, "wayland");
}

#[test]
fn global_hotkeys_on_linux_only_under_x11() {
    assert!(build(Os::Linux, "x11", "deb", true).global_hotkeys);
    assert!(!build(Os::Linux, "wayland", "deb", true).global_hotkeys);
    assert!(!build(Os::Linux, "", "deb", true).global_hotkeys);
}

#[test]
fn tray_flag_is_passed_through() {
    assert!(!build(Os::Linux, "x11", "deb", false).tray_available);
}

#[test]
fn json_has_the_documented_camel_case_fields() {
    let json = serde_json::to_value(build(Os::Linux, "x11", "appimage", false)).unwrap();
    let mut keys: Vec<&str> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "globalHotkeys",
            "os",
            "packaging",
            "screenCapture",
            "selfUpdate",
            "sessionType",
            "trayAvailable",
            "tunAccess"
        ]
    );
    assert_eq!(json["sessionType"], "x11");
    assert_eq!(json["packaging"], "appimage");
}

#[test]
fn session_type_prefers_xdg_then_falls_back() {
    assert_eq!(session_type(Some("wayland"), false, true), "wayland");
    assert_eq!(session_type(Some("x11"), true, false), "x11");
    assert_eq!(session_type(Some("tty"), true, true), "wayland");
    assert_eq!(session_type(None, false, true), "x11");
    assert_eq!(session_type(None, false, false), "");
}

#[test]
fn linux_packaging_is_told_apart() {
    let usr = Path::new("/usr/bin/lavray");
    assert_eq!(packaging_linux(true, usr), "appimage");
    assert_eq!(packaging_linux(false, usr), "deb");
    assert_eq!(
        packaging_linux(false, Path::new("/opt/LAVRay/lavray")),
        "deb"
    );
    assert_eq!(packaging_linux(false, Path::new("/usrx/lavray")), "other");
    assert_eq!(packaging_linux(false, Path::new("/home/u/lavray")), "other");
}

#[test]
fn windows_packaging_by_program_files() {
    let roots = [
        PathBuf::from(r"C:\Program Files"),
        PathBuf::from(r"C:\Program Files (x86)\"),
    ];
    assert_eq!(
        packaging_windows(r"c:\program files\LAVRay\LAVRay.exe", &roots),
        "installed"
    );
    assert_eq!(
        packaging_windows(r"C:\Program Files (x86)\L\L.exe", &roots),
        "installed"
    );
    assert_eq!(
        packaging_windows(r"C:\Program Files Evil\L.exe", &roots),
        "portable"
    );
    assert_eq!(
        packaging_windows(r"D:\Tools\LAVRay.exe", &roots),
        "portable"
    );
    assert_eq!(packaging_windows(r"C:\Program Files", &roots), "portable");
    assert_eq!(packaging_windows(r"C:\x.exe", &[]), "portable");
}

#[test]
fn bus_answers_are_parsed() {
    assert_eq!(parse_name_has_owner("(true,)\n"), Some(true));
    assert_eq!(parse_name_has_owner("(false,)\n"), Some(false));
    assert_eq!(
        parse_name_has_owner(
            "method return time=1 sender=:1.2 -> destination=:1.3\n   boolean true\n"
        ),
        Some(true)
    );
    assert_eq!(parse_name_has_owner("   boolean false"), Some(false));
    assert_eq!(parse_name_has_owner("Error: no bus"), None);
    assert_eq!(parse_name_has_owner(""), None);
}

#[test]
fn a_false_answer_is_not_remembered_but_a_true_one_is() {
    let watch = Watch::new();
    assert_eq!(
        watch.wait(Duration::from_millis(5)),
        None,
        "фон не запускался"
    );
    watch.mark_started();
    assert_eq!(watch.wait(Duration::from_millis(5)), None, "опрос ещё идёт");
    watch.finish();
    assert_eq!(watch.wait(Duration::from_millis(5)), Some(false));
    // трей появился позже окончания опроса: «да» побеждает прежнее «нет»
    watch.mark_seen();
    assert_eq!(watch.wait(Duration::from_millis(5)), Some(true));
    assert!(watch.seen());
}

#[test]
fn a_waiter_wakes_when_the_tray_appears() {
    let watch = std::sync::Arc::new(Watch::new());
    watch.mark_started();
    let other = std::sync::Arc::clone(&watch);
    let handle = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        other.mark_seen();
    });
    assert_eq!(watch.wait(Duration::from_secs(5)), Some(true));
    handle.join().unwrap();
}

#[test]
fn capabilities_never_block_and_are_optimistic_without_an_answer() {
    let started = std::time::Instant::now();
    // на Linux фон в тесте не запущен: ответа нет, ждать нечего
    assert!(tray_for_caps(Duration::from_millis(300)));
    assert!(started.elapsed() < Duration::from_secs(2));
}
