// SPDX-License-Identifier: GPL-3.0-only

use super::*;

fn ok(raw: &str) -> String {
    parse_accel(raw)
        .unwrap_or_else(|e| panic!("{raw}: {e:?}"))
        .to_string()
}

#[test]
fn accel_valid_normalized() {
    assert_eq!(ok("Ctrl+Alt+K"), "Ctrl+Alt+K");
    assert_eq!(ok("alt + ctrl + k"), "Ctrl+Alt+K", "порядок и регистр");
    assert_eq!(ok("Shift+Ctrl+1"), "Ctrl+Shift+1");
    assert_eq!(ok("Control+Option+Shift+z"), "Ctrl+Alt+Shift+Z");
    assert_eq!(ok("Ctrl+F9"), "Ctrl+F9");
    assert_eq!(ok("shift+f24"), "Shift+F24");
    assert_eq!(ok("Ctrl+Alt+F13"), "Ctrl+Alt+F13");
}

#[test]
fn accel_without_modifier_rejected() {
    for raw in ["K", "F5", "Ctrl+K", "Alt+1", "Shift+K", "Shift+Alt"] {
        let err = parse_accel(raw).unwrap_err();
        assert!(
            matches!(err, AccelError::NoModifier | AccelError::Invalid),
            "{raw}: {err:?}"
        );
    }
    assert_eq!(parse_accel("Ctrl+K"), Err(AccelError::NoModifier));
    assert_eq!(parse_accel("Shift+K").unwrap_err().code(), "no_modifier");
}

#[test]
fn accel_reserved_rejected() {
    for raw in [
        "Win+K",
        "Super+Ctrl+K",
        "Ctrl+Meta+K",
        "Cmd+Shift+K",
        "Alt+F4",
    ] {
        assert_eq!(parse_accel(raw), Err(AccelError::Reserved), "{raw}");
    }
    for n in 1..=12 {
        assert_eq!(
            parse_accel(&format!("Ctrl+Alt+F{n}")),
            Err(AccelError::Reserved),
            "переключение консолей Linux"
        );
    }
    assert_eq!(parse_accel("Win+K").unwrap_err().code(), "reserved");
    assert!(parse_accel("Ctrl+Alt+F4").is_err());
    assert!(parse_accel("Ctrl+F4").is_ok(), "Ctrl+F4 не системное");
}

#[test]
fn accel_garbage_is_invalid() {
    for raw in [
        "",
        "+",
        "Ctrl+",
        "Ctrl+Alt",
        "Ctrl+Alt+K+L",
        "Ctrl+Ctrl+K",
        "Ctrl+Alt+Esc",
        "Ctrl+Alt+Delete",
        "Ctrl+Alt+Space",
        "Ctrl+Alt+Й",
        "Ctrl+Alt+F0",
        "Ctrl+Alt+F25",
        "Ctrl+Alt+F01",
        "Ctrl+Alt+Fx",
        "Hyper+Ctrl+K",
    ] {
        assert_eq!(parse_accel(raw), Err(AccelError::Invalid), "{raw:?}");
        assert_eq!(parse_accel(raw).unwrap_err().code(), "invalid_accel");
    }
}

#[test]
fn letter_f_alone_is_a_letter() {
    assert_eq!(ok("Ctrl+Alt+F"), "Ctrl+Alt+F");
}

#[test]
fn display_roundtrips() {
    for raw in ["Ctrl+Alt+K", "Ctrl+Shift+0", "Alt+Shift+F20"] {
        assert_eq!(ok(&ok(raw)), raw);
    }
}
