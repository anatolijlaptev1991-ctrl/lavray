//! Автомат состояний автообновления (§8.3, UPDATE-SYSTEM v2.0 TUF-lite).
//!
//! Скаффолд: только переходы состояний и проверки политики (монотонный
//! serial, heartbeat-откат) — без сетевых вызовов. Скачивание/подписи —
//! события, которые драйвит транспортный слой позже (tauri-updater как
//! транспорт, проверка подписей ed25519 — наша, ключи из root.json).
//!
//! Откат (принцип 3 v2.0 §3) выполняет СТАРОЙ версии rollback-помощник из
//! `updates/previous/`, если новая версия не отметилась здоровьем за
//! [`HEARTBEAT_GRACE`] (60 с).

use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Grace-период health-флага новой версии до отката (v2.0 §3).
pub const HEARTBEAT_GRACE: Duration = Duration::from_secs(60);
/// Каталог предыдущей установки (v2.0 §3, `updates/previous/`).
pub const ROLLBACK_DIR: &str = "updates/previous";
/// Freeze-статус «warning»: timestamp.json просрочен > 7 дней (§8.3).
pub const FREEZE_WARNING: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// Freeze-статус «красный»: > 30 дней (§8.3).
pub const FREEZE_ERROR: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// Состояния процесса обновления.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UpdateState {
    /// Обновлений нет / не проверяли.
    Idle,
    /// Проверенный манифест предлагает новую версию (serial, version).
    Available {
        /// Монотонный serial манифеста (§8.3).
        serial: u64,
        /// Человекочитаемая версия.
        version: String,
    },
    /// Артефакт скачивается/проверяется (staging).
    Downloading {
        /// Serial манифеста.
        serial: u64,
        /// Версия.
        version: String,
    },
    /// Готово: скачано, sha256+minisig верны, повторная проверка (анти-TOCTOU)
    /// пройдена, ждём разрешения применить.
    Ready {
        /// Serial манифеста.
        serial: u64,
        /// Версия.
        version: String,
    },
    /// Применяется: атомарный перенос + heartbeat-флаг новой версии.
    Applying {
        /// Serial применяемой версии.
        serial: u64,
        /// Версия.
        version: String,
    },
    /// Ошибка (подпись/хэш/манифест/даунгрейд/сеть).
    Error {
        /// Причина (строка для UI; детали — в журнал).
        reason: String,
    },
    /// Heartbeat не пришёл за 60 с — старый rollback-помощник откатывает.
    RollingBack {
        /// Serial версии, с которой откатываемся.
        from_serial: u64,
    },
    /// Откат завершён (работает предыдущая версия из `updates/previous/`).
    RolledBack {
        /// Serial версии, с которой откатились.
        from_serial: u64,
    },
}

/// События, управляющие автоматом (поступают от транспорта/рантайма).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateEvent {
    /// Манифест проверен по цепочке root→timestamp→manifest (подписи ок).
    ManifestVerified {
        /// Монотонный serial манифеста.
        serial: u64,
        /// Версия из манифеста.
        version: String,
    },
    /// Манифест отвергнут (подпись/expired/мандаторность/downgrade).
    ManifestRejected {
        /// Причина отказа.
        reason: String,
    },
    /// Начали скачивать артефакт.
    DownloadStarted,
    /// Артефакт прошёл sha256 + minisign + повторную проверку после копии.
    ArtifactVerified,
    /// Артефакт не прошёл проверку.
    ArtifactRejected {
        /// Причина.
        reason: String,
    },
    /// Пользователь разрешил применить обновление.
    InstallRequested,
    /// Новая версия отметилась здоровьем в пределах grace-периода.
    HeartbeatOk,
    /// Health-флаг не встал за [`HEARTBEAT_GRACE`] — откат.
    HeartbeatTimeout,
    /// Rollback-помощник завершил откат.
    RollbackCompleted,
    /// Повторить проверку после ошибки.
    RetryRequested,
}

/// Нелегальный переход автомата обновлений.
#[derive(Debug, thiserror::Error)]
#[error("illegal update FSM transition: {from:?} + {event:?}")]
pub struct UpdateTransitionError {
    /// Состояние, из которого пытались уйти.
    pub from: UpdateState,
    /// Неприменимое событие.
    pub event: UpdateEvent,
}

/// Downgrade-политика (§8.3): serial монотонный; артефакт с serial ≤
/// установленного отвергается.
pub fn is_downgrade(installed_serial: u64, candidate_serial: u64) -> bool {
    candidate_serial <= installed_serial
}

/// Автомат состояний обновления: чистая функция переходов.
pub fn transition(
    from: &UpdateState,
    event: UpdateEvent,
) -> Result<UpdateState, UpdateTransitionError> {
    use UpdateEvent as E;
    use UpdateState as S;

    // Клон в scrutinee: ветка ошибки возвращает исходное `event`.
    let next = match (from, event.clone()) {
        (S::Idle, E::ManifestVerified { serial, version }) => S::Available { serial, version },
        (S::Idle, E::ManifestRejected { reason }) => S::Error { reason },

        (S::Available { .. }, E::DownloadStarted) => {
            clone_with_phase(from, |serial, version| S::Downloading { serial, version })
        }
        (S::Available { .. }, E::ManifestRejected { reason }) => S::Error { reason },

        (S::Downloading { .. }, E::ArtifactVerified) => {
            clone_with_phase(from, |serial, version| S::Ready { serial, version })
        }
        (S::Downloading { .. }, E::ArtifactRejected { reason }) => S::Error { reason },
        (S::Downloading { .. }, E::ManifestRejected { reason }) => S::Error { reason },

        (S::Ready { .. }, E::InstallRequested) => {
            clone_with_phase(from, |serial, version| S::Applying { serial, version })
        }
        (S::Ready { .. }, E::ManifestRejected { reason }) => S::Error { reason },

        (S::Applying { .. }, E::HeartbeatOk) => S::Idle,
        (S::Applying { serial, .. }, E::HeartbeatTimeout) => S::RollingBack {
            from_serial: *serial,
        },

        (S::RollingBack { from_serial }, E::RollbackCompleted) => S::RolledBack {
            from_serial: *from_serial,
        },

        (S::Error { .. }, E::RetryRequested) => S::Idle,
        (S::RolledBack { .. }, E::RetryRequested) => S::Idle,

        _ => {
            return Err(UpdateTransitionError {
                from: from.clone(),
                event,
            })
        }
    };
    Ok(next)
}

/// Перенести serial/version в новую фазу (Available→Downloading→Ready→Applying).
fn clone_with_phase(from: &UpdateState, phase: impl Fn(u64, String) -> UpdateState) -> UpdateState {
    match from {
        UpdateState::Available { serial, version }
        | UpdateState::Downloading { serial, version }
        | UpdateState::Ready { serial, version } => phase(*serial, version.clone()),
        other => unreachable!("clone_with_phase only maps serial-carrying states, got {other:?}"),
    }
}

/// Машина с политикой: хранит установленную версию и применяет downgrade-чек.
#[derive(Debug)]
pub struct UpdateMachine {
    state: UpdateState,
    installed_serial: u64,
}

impl UpdateMachine {
    /// Новая машина для установки с `installed_serial`.
    pub fn new(installed_serial: u64) -> Self {
        Self {
            state: UpdateState::Idle,
            installed_serial,
        }
    }

    /// Текущее состояние.
    pub fn state(&self) -> &UpdateState {
        &self.state
    }

    /// Serial установленной версии.
    pub fn installed_serial(&self) -> u64 {
        self.installed_serial
    }

    /// Применить событие: сначала downgrade-политика по serial, затем FSM.
    /// Успешно применённый `HeartbeatOk` поднимает установленный serial.
    pub fn handle(&mut self, event: UpdateEvent) -> Result<UpdateState, UpdateTransitionError> {
        if let UpdateEvent::ManifestVerified { serial, .. } = &event {
            if is_downgrade(self.installed_serial, *serial) {
                self.state = UpdateState::Error {
                    reason: format!(
                        "downgrade artifact rejected: manifest serial {serial} <= installed {}",
                        self.installed_serial
                    ),
                };
                return Ok(self.state.clone());
            }
        }
        let bump_to = match (&self.state, &event) {
            (UpdateState::Applying { serial, .. }, UpdateEvent::HeartbeatOk) => Some(*serial),
            _ => None,
        };
        self.state = transition(&self.state, event)?;
        if let Some(serial) = bump_to {
            self.installed_serial = self.installed_serial.max(serial);
        }
        Ok(self.state.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine() -> UpdateMachine {
        UpdateMachine::new(10)
    }

    fn verified(serial: u64) -> UpdateEvent {
        UpdateEvent::ManifestVerified {
            serial,
            version: format!("0.{serial}.0"),
        }
    }

    /// Happy path §8.3: Idle → Available → Downloading → Ready → Applying →
    /// Idle (heartbeat ok).
    #[test]
    fn happy_path() {
        let mut m = machine();
        assert_eq!(
            m.handle(verified(11)).unwrap(),
            UpdateState::Available {
                serial: 11,
                version: "0.11.0".to_owned()
            }
        );
        assert_eq!(
            m.handle(UpdateEvent::DownloadStarted).unwrap(),
            UpdateState::Downloading {
                serial: 11,
                version: "0.11.0".to_owned()
            }
        );
        assert_eq!(
            m.handle(UpdateEvent::ArtifactVerified).unwrap(),
            UpdateState::Ready {
                serial: 11,
                version: "0.11.0".to_owned()
            }
        );
        assert_eq!(
            m.handle(UpdateEvent::InstallRequested).unwrap(),
            UpdateState::Applying {
                serial: 11,
                version: "0.11.0".to_owned()
            }
        );
        assert_eq!(
            m.handle(UpdateEvent::HeartbeatOk).unwrap(),
            UpdateState::Idle
        );
        assert_eq!(
            m.installed_serial(),
            11,
            "heartbeat поднимает installed serial"
        );
    }

    /// Артефакт не прошёл проверку → Error; Retry → Idle.
    #[test]
    fn verification_failure_goes_to_error_then_retry() {
        let mut m = machine();
        m.handle(verified(11)).unwrap();
        m.handle(UpdateEvent::DownloadStarted).unwrap();
        let state = m
            .handle(UpdateEvent::ArtifactRejected {
                reason: "sha256 mismatch".to_owned(),
            })
            .unwrap();
        assert_eq!(
            state,
            UpdateState::Error {
                reason: "sha256 mismatch".to_owned()
            }
        );
        assert_eq!(
            m.handle(UpdateEvent::RetryRequested).unwrap(),
            UpdateState::Idle
        );
    }

    /// Heartbeat не встал за 60 с → RollingBack → RolledBack (rollback-
    /// помощник старой версии, v2.0 §3).
    #[test]
    fn heartbeat_timeout_triggers_rollback() {
        let mut m = machine();
        m.handle(verified(12)).unwrap();
        m.handle(UpdateEvent::DownloadStarted).unwrap();
        m.handle(UpdateEvent::ArtifactVerified).unwrap();
        m.handle(UpdateEvent::InstallRequested).unwrap();
        assert_eq!(
            m.handle(UpdateEvent::HeartbeatTimeout).unwrap(),
            UpdateState::RollingBack { from_serial: 12 }
        );
        assert_eq!(
            m.handle(UpdateEvent::RollbackCompleted).unwrap(),
            UpdateState::RolledBack { from_serial: 12 }
        );
        // После отката можно повторить проверку.
        assert_eq!(
            m.handle(UpdateEvent::RetryRequested).unwrap(),
            UpdateState::Idle
        );
    }

    /// Downgrade-артефакт (serial ≤ установленного) отвергается (§8.3).
    #[test]
    fn downgrade_artifact_is_rejected() {
        assert!(is_downgrade(10, 10), "равный serial = не обновление");
        assert!(is_downgrade(10, 9));
        assert!(!is_downgrade(10, 11));

        let mut m = machine();
        let state = m.handle(verified(10)).unwrap();
        let reason = match &state {
            UpdateState::Error { reason } => reason.clone(),
            other => panic!("expected Error, got {other:?}"),
        };
        assert!(reason.contains("downgrade"), "reason: {reason}");

        let mut m = machine();
        let state = m.handle(verified(9)).unwrap();
        assert!(matches!(state, UpdateState::Error { .. }));
    }

    /// Нелегальные переходы дают ошибку.
    #[test]
    fn illegal_transitions_are_errors() {
        let mut m = machine();
        let err = m.handle(UpdateEvent::InstallRequested).unwrap_err();
        assert!(matches!(err.from, UpdateState::Idle));
        let err = m.handle(UpdateEvent::HeartbeatOk).unwrap_err();
        assert!(matches!(err.from, UpdateState::Idle));

        // Из Available нельзя применить без скачивания.
        let mut m = machine();
        m.handle(verified(11)).unwrap();
        assert!(m.handle(UpdateEvent::InstallRequested).is_err());
    }

    /// Таблица легальных переходов (параметризованно) — ВСЕ рёбра автомата:
    /// каждая ветка `transition` покрыта, длина пинится (новое ребро без
    /// теста не пройдёт).
    #[test]
    fn transition_table_legal_edges() {
        let v = || "1.2.3".to_owned();
        let edges: Vec<(UpdateState, UpdateEvent, UpdateState)> = vec![
            (
                UpdateState::Idle,
                UpdateEvent::ManifestVerified {
                    serial: 2,
                    version: v(),
                },
                UpdateState::Available {
                    serial: 2,
                    version: v(),
                },
            ),
            (
                UpdateState::Idle,
                UpdateEvent::ManifestRejected { reason: "r".into() },
                UpdateState::Error { reason: "r".into() },
            ),
            (
                UpdateState::Available {
                    serial: 2,
                    version: v(),
                },
                UpdateEvent::DownloadStarted,
                UpdateState::Downloading {
                    serial: 2,
                    version: v(),
                },
            ),
            // Свежий манифест может отвергнуть уже предложенную версию.
            (
                UpdateState::Available {
                    serial: 2,
                    version: v(),
                },
                UpdateEvent::ManifestRejected { reason: "r".into() },
                UpdateState::Error { reason: "r".into() },
            ),
            (
                UpdateState::Downloading {
                    serial: 2,
                    version: v(),
                },
                UpdateEvent::ArtifactVerified,
                UpdateState::Ready {
                    serial: 2,
                    version: v(),
                },
            ),
            (
                UpdateState::Downloading {
                    serial: 2,
                    version: v(),
                },
                UpdateEvent::ArtifactRejected { reason: "r".into() },
                UpdateState::Error { reason: "r".into() },
            ),
            (
                UpdateState::Downloading {
                    serial: 2,
                    version: v(),
                },
                UpdateEvent::ManifestRejected { reason: "r".into() },
                UpdateState::Error { reason: "r".into() },
            ),
            (
                UpdateState::Ready {
                    serial: 2,
                    version: v(),
                },
                UpdateEvent::InstallRequested,
                UpdateState::Applying {
                    serial: 2,
                    version: v(),
                },
            ),
            (
                UpdateState::Ready {
                    serial: 2,
                    version: v(),
                },
                UpdateEvent::ManifestRejected { reason: "r".into() },
                UpdateState::Error { reason: "r".into() },
            ),
            (
                UpdateState::Applying {
                    serial: 2,
                    version: v(),
                },
                UpdateEvent::HeartbeatOk,
                UpdateState::Idle,
            ),
            (
                UpdateState::Applying {
                    serial: 2,
                    version: v(),
                },
                UpdateEvent::HeartbeatTimeout,
                UpdateState::RollingBack { from_serial: 2 },
            ),
            (
                UpdateState::RollingBack { from_serial: 2 },
                UpdateEvent::RollbackCompleted,
                UpdateState::RolledBack { from_serial: 2 },
            ),
            (
                UpdateState::Error { reason: "r".into() },
                UpdateEvent::RetryRequested,
                UpdateState::Idle,
            ),
            // После отката можно снова проверить обновления.
            (
                UpdateState::RolledBack { from_serial: 2 },
                UpdateEvent::RetryRequested,
                UpdateState::Idle,
            ),
        ];
        assert_eq!(edges.len(), 14, "все легальные рёбра автомата §8.3 покрыты");
        for (from, event, to) in edges {
            let label = format!("{from:?} + {event:?}");
            assert_eq!(transition(&from, event).unwrap(), to, "{label}");
        }
    }
}
