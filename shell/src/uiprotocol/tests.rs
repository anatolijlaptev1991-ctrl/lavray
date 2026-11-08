// SPDX-License-Identifier: GPL-3.0-only

use super::*;

/// Полное покрытие вариатов: каждая команда и каждое событие.
fn all_messages() -> Vec<IpcMessage> {
    let commands = vec![
        ShellCommand::GetCoreState,
        ShellCommand::StartCore,
        ShellCommand::StopCore,
        ShellCommand::RestartCore,
        ShellCommand::ConnectProfile {
            profile_id: "profile-42".to_owned(),
        },
        ShellCommand::Disconnect,
        ShellCommand::SetSystemProxy { enabled: true },
        ShellCommand::SetSystemProxy { enabled: false },
        ShellCommand::ImportDeepLink {
            url: "https://example.invalid/sub?token=secret".to_owned(),
        },
    ];
    let events = vec![
        ShellEvent::CoreStateChanged {
            state: CoreState::Connected,
        },
        ShellEvent::CoreStateChanged {
            state: CoreState::RateLimited,
        },
        ShellEvent::CoreLogLine {
            seq: 7,
            text: "LAVRAY_CORE_READY unix:///tmp/x".to_owned(),
        },
        ShellEvent::UpdateStateChanged {
            state: UpdateState::Available {
                serial: 12,
                version: "0.2.0".to_owned(),
            },
        },
        ShellEvent::UpdateStateChanged {
            state: UpdateState::Error {
                reason: "signature invalid".to_owned(),
            },
        },
        ShellEvent::DeepLinkImportRequested {
            url: "https://example.invalid/sub".to_owned(),
        },
    ];
    commands
        .into_iter()
        .map(IpcMessage::Command)
        .chain(events.into_iter().map(IpcMessage::Event))
        .collect()
}

/// Roundtrip encode → decode для каждого варианта (serde-тэг «kind»).
#[test]
fn roundtrip_every_variant() {
    for message in all_messages() {
        let json = encode(&message).expect("encode");
        let decoded = decode(&json).expect("decode");
        assert_eq!(decoded, message, "roundtrip failed for: {json}");
    }
}

/// JSON заимствующего конверта совпадает побайтно с владеющим `Envelope`.
#[test]
fn borrowed_envelope_json_is_byte_identical() {
    for (message, twin) in all_messages().into_iter().zip(all_messages()) {
        let owned = serde_json::to_string(&Envelope {
            version: IPC_PROTOCOL_VERSION,
            message: twin,
        })
        .unwrap();
        assert_eq!(encode(&message).unwrap(), owned);
    }
}

/// Конверт несёт текущую версию протокола.
#[test]
fn envelope_carries_protocol_version() {
    let json = encode(&IpcMessage::Command(ShellCommand::GetCoreState)).unwrap();
    let envelope: Envelope = serde_json::from_str(&json).unwrap();
    assert_eq!(envelope.version, IPC_PROTOCOL_VERSION);
    assert!(json.contains("\"version\":1"));
}

/// Чужая версия протокола → отказ (не молчаливый).
#[test]
fn version_mismatch_is_rejected() {
    let json = r#"{"version":99,"message":{"direction":"command","kind":"get_core_state"}}"#;
    let err = decode(json).unwrap_err();
    assert!(matches!(
        err,
        IpcError::VersionMismatch {
            expected: 1,
            got: 99
        }
    ));
}

/// Битый JSON и неизвестные тэги — ошибки декодирования.
#[test]
fn malformed_input_is_rejected() {
    assert!(matches!(decode("not json"), Err(IpcError::Json(_))));
    let unknown = r#"{"version":1,"message":{"direction":"command","kind":"no_such_command"}}"#;
    assert!(matches!(decode(unknown), Err(IpcError::Json(_))));
    let bad_direction =
        r#"{"version":1,"message":{"direction":"sideways","kind":"get_core_state"}}"#;
    assert!(matches!(decode(bad_direction), Err(IpcError::Json(_))));
}
