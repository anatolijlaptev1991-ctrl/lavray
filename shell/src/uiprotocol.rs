// SPDX-License-Identifier: GPL-3.0-only

//! Протокол UI ↔ shell: команды (UI → shell) и события (shell → UI).
//!
//! Это верхний канал Tauri IPC (`invoke` + события). Нижний канал
//! shell ↔ ядро — ConnectRPC по UDS/named pipe: он будет жить в будущем
//! модуле `src/ipc.rs` (Connect-клиент, §10-дерево; план — комментарий в
//! `lib.rs`), поэтому этот модуль переименован из `ipc.rs` в
//! `uiprotocol.rs` и имя `ipc` освобождено под клиент ядра.
//!
//! Сообщения кодируются в JSON, каждое оборачивается в конверт с версией
//! протокола [`IPC_PROTOCOL_VERSION`] — при несовпадении декодер отказывает
//! (graceful upgrade UI/шелла независимо друг от друга).

use serde::{Deserialize, Serialize};

use crate::coreproc::CoreState;
use crate::updater::UpdateState;

/// Версия протокола UI ↔ shell (инкремент при несовместимых изменениях).
pub const IPC_PROTOCOL_VERSION: u32 = 1;

/// Команды UI → shell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ShellCommand {
    /// Опросить текущее состояние ядра (FSM §2.2).
    GetCoreState,
    /// Запустить ядро (spawn §3).
    StartCore,
    /// Graceful-стоп ядра (§5).
    StopCore,
    /// Перезапуск (в т.ч. из RateLimited — ручной «Перезапустить»).
    RestartCore,
    /// Connect(profile_id) — активировать профиль (FR-UI-261).
    ConnectProfile {
        /// Идентификатор профиля в БД ядра.
        profile_id: String,
    },
    /// Disconnect() — деактивировать инстанс.
    Disconnect,
    /// Системный прокси вкл/выкл (§9; перед включением — снимок FR-UI-259).
    SetSystemProxy {
        /// Включить или выключить.
        enabled: bool,
    },
    /// Deep-link `lavray://import?url=…` (§8.2): только импорт, всегда с
    /// предпросмотром и подтверждением; никаких start/stop/update.
    ImportDeepLink {
        /// Разобранный и провалидированный URL подписки.
        url: String,
    },
}

/// События shell → UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ShellEvent {
    /// Состояние FSM ядра изменилось.
    CoreStateChanged {
        /// Новое состояние.
        state: CoreState,
    },
    /// Строка из пайпа ядра (§4; UI склеивает с LogService локально, Р2-43).
    CoreLogLine {
        /// Порядковый номер строки.
        seq: u64,
        /// Текст (ANSI уже вырезан оболочкой).
        text: String,
    },
    /// Состояние автообновления изменилось (§8.3).
    UpdateStateChanged {
        /// Новое состояние.
        state: UpdateState,
    },
    /// Поступил deep-link на импорт — открыть окно предпросмотра (§8.2).
    DeepLinkImportRequested {
        /// URL из `lavray://import?url=…`.
        url: String,
    },
}

/// Сообщение протокола: команда или событие.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "direction", rename_all = "snake_case")]
pub enum IpcMessage {
    /// Команда UI → shell.
    Command(ShellCommand),
    /// Событие shell → UI.
    Event(ShellEvent),
}

/// Конверт протокола: версия + полезная нагрузка.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Envelope {
    /// Версия протокола отправителя.
    pub version: u32,
    /// Полезная нагрузка.
    pub message: IpcMessage,
}

/// Ошибки декодирования.
#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    /// Версия протокола отправителя не совпадает с нашей.
    #[error("IPC protocol version mismatch: expected {expected}, got {got}")]
    VersionMismatch {
        /// Ожидаемая (наша) версия.
        expected: u32,
        /// Версия отправителя.
        got: u32,
    },
    /// Битый JSON или неизвестный тип сообщения.
    #[error("IPC JSON decode error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Закодировать сообщение в JSON-конверт с текущей версией протокола.
pub fn encode(message: &IpcMessage) -> Result<String, serde_json::Error> {
    serde_json::to_string(&Envelope {
        version: IPC_PROTOCOL_VERSION,
        message: message.clone(),
    })
}

/// Декодировать JSON-конверт: проверить версию, вернуть сообщение.
pub fn decode(json: &str) -> Result<IpcMessage, IpcError> {
    let envelope: Envelope = serde_json::from_str(json)?;
    if envelope.version != IPC_PROTOCOL_VERSION {
        return Err(IpcError::VersionMismatch {
            expected: IPC_PROTOCOL_VERSION,
            got: envelope.version,
        });
    }
    Ok(envelope.message)
}

#[cfg(test)]
mod tests {
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
}
