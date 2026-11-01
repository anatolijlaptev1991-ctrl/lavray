// SPDX-License-Identifier: GPL-3.0-only

//! Стабильные коды ошибок команд обновления и исход `update_apply`. UI сверяет
//! строки, поэтому коды не меняются без правки `ui/`.

use serde::Serialize;

/// Почему установка не началась или не закончилась запуском.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyError {
    /// Установка уже идёт.
    Busy,
    /// Путь не внутри `updates/staging` (или `updates/previous`).
    PathOutsideStaging,
    /// SHA-256 файла не совпал с ожидаемым.
    Sha256Mismatch,
    /// Файл не удалось открыть с запретом записи или прочитать.
    Locked,
    /// Ядро не остановилось.
    CoreStopFailed,
    /// Системный прокси не снялся (ядро при этом запущено заново).
    ProxyReleaseFailed,
    /// Не удалось подготовить копию для отката или watchdog.
    PrepareFailed,
    /// Установщик не запустился (кроме отказа в UAC).
    LaunchFailed,
    /// Ожидаемая сумма — не 64 hex-символа.
    InvalidSha256,
    /// Версия пустая, слишком длинная или с пробелами (watchdog её не разберёт).
    InvalidVersion,
    /// Прошлого установщика нет.
    RollbackUnavailable,
    /// Подпись установщика не подтверждена ядром: нет файла `.minisig`, чужой
    /// ключ, подмена содержимого, продукт или платформа не те.
    SignatureInvalid,
    /// Подписанная версия не совпала с ожидаемой.
    VersionMismatch,
    /// Встроенное ядро для проверки подписи не найдено или не запустилось.
    CoreUnavailable,
    /// Система не запустила установщик: файл удерживается с запретом записи
    /// (`ERROR_SHARING_VIOLATION`). Повторов нет — пользователь видит код.
    InstallerLocked,
}

impl ApplyError {
    /// Код для UI.
    pub fn code(self) -> &'static str {
        match self {
            Self::Busy => "busy",
            Self::PathOutsideStaging => "path_outside_staging",
            Self::Sha256Mismatch => "sha256_mismatch",
            Self::Locked => "locked",
            Self::CoreStopFailed => "core_stop_failed",
            Self::ProxyReleaseFailed => "proxy_release_failed",
            Self::PrepareFailed => "prepare_failed",
            Self::LaunchFailed => "launch_failed",
            Self::InvalidSha256 => "invalid_sha256",
            Self::InvalidVersion => "invalid_version",
            Self::RollbackUnavailable => "rollback_unavailable",
            Self::SignatureInvalid => "signature_invalid",
            Self::VersionMismatch => "version_mismatch",
            Self::CoreUnavailable => "core_unavailable",
            Self::InstallerLocked => "installer_locked",
        }
    }
}

/// Чем кончился `update_apply` / `update_rollback` без ошибки.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ApplyOutcome {
    /// Установщик запущен; приложение вот-вот выйдет.
    Installing,
    /// Пользователь отказал в UAC: ничего не установлено, UI возвращается в «готово».
    UacCancelled,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_the_stable_strings_the_ui_matches() {
        let all = [
            (ApplyError::Busy, "busy"),
            (ApplyError::PathOutsideStaging, "path_outside_staging"),
            (ApplyError::Sha256Mismatch, "sha256_mismatch"),
            (ApplyError::Locked, "locked"),
            (ApplyError::CoreStopFailed, "core_stop_failed"),
            (ApplyError::LaunchFailed, "launch_failed"),
            (ApplyError::InvalidSha256, "invalid_sha256"),
            (ApplyError::InvalidVersion, "invalid_version"),
            (ApplyError::ProxyReleaseFailed, "proxy_release_failed"),
            (ApplyError::PrepareFailed, "prepare_failed"),
            (ApplyError::RollbackUnavailable, "rollback_unavailable"),
            (ApplyError::SignatureInvalid, "signature_invalid"),
            (ApplyError::VersionMismatch, "version_mismatch"),
            (ApplyError::CoreUnavailable, "core_unavailable"),
            (ApplyError::InstallerLocked, "installer_locked"),
        ];
        for (error, code) in all {
            assert_eq!(error.code(), code);
        }
    }

    #[test]
    fn outcome_serializes_as_a_tagged_status() {
        let installing = serde_json::to_string(&ApplyOutcome::Installing).unwrap();
        assert_eq!(installing, r#"{"status":"installing"}"#);
        let cancelled = serde_json::to_string(&ApplyOutcome::UacCancelled).unwrap();
        assert_eq!(cancelled, r#"{"status":"uac_cancelled"}"#);
    }
}
