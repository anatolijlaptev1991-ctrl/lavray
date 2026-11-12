// SPDX-License-Identifier: GPL-3.0-only

//! Тесты pkexec: интерпретация кодов возврата PolicyKit (B08).

use super::super::imp::interpret_exit;
use super::super::RunasError;

#[test]
fn exit_zero_is_success() {
    assert_eq!(interpret_exit(Some(0)), Ok(()));
}

#[test]
fn exit_126_is_cancelled_not_error() {
    // Пользователь закрыл диалог PolicyKit — это не ошибка.
    assert_eq!(interpret_exit(Some(126)), Err(RunasError::Cancelled));
}

#[test]
fn exit_127_is_not_authorized() {
    let err = interpret_exit(Some(127)).unwrap_err();
    assert!(matches!(err, RunasError::Failed(_)));
    if let RunasError::Failed(msg) = err {
        assert!(msg.contains("не авторизован"), "{msg}");
    }
}

#[test]
fn exit_other_codes_are_failed_with_code() {
    for code in [1, 2, 125, 128, 255] {
        let err = interpret_exit(Some(code)).unwrap_err();
        assert!(matches!(err, RunasError::Failed(_)), "code {code}");
        if let RunasError::Failed(msg) = err {
            assert!(msg.contains(&code.to_string()), "code {code} in {msg}");
        }
    }
}

#[test]
fn signal_death_is_failed() {
    // None = процесс убит сигналом (SIGKILL, SIGSEGV…).
    let err = interpret_exit(None).unwrap_err();
    assert!(matches!(err, RunasError::Failed(_)));
    if let RunasError::Failed(msg) = err {
        assert!(msg.contains("сигналом"), "{msg}");
    }
}

#[test]
fn negative_codes_are_failed() {
    // Некорректный отрицательный код — не паника, а Failed.
    let err = interpret_exit(Some(-1)).unwrap_err();
    assert!(matches!(err, RunasError::Failed(_)));
}
