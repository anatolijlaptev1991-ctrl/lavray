//! T-57 (A2-24): release-сборка не принимает заглушку вместо ядра.
include!("../build_guard.rs");

#[test]
fn release_build_rejects_a_missing_or_stub_core() {
    assert!(check_core(true, None).unwrap_err().contains("файла нет"));
    let stub = check_core(true, Some(17)).unwrap_err(); // заглушка build.rs — 17 байт
    assert!(
        stub.contains("17 Б") && stub.contains("core/BUILD_TAGS"),
        "{stub}"
    );
    assert!(check_core(true, Some(MIN_REAL_CORE_BYTES - 1)).is_err());
}

#[test]
fn release_build_accepts_a_real_sized_core() {
    assert!(check_core(true, Some(MIN_REAL_CORE_BYTES)).is_ok());
    assert!(check_core(true, Some(50 << 20)).is_ok());
}

#[test]
fn debug_build_keeps_working_with_the_stub() {
    assert!(
        check_core(true, None).is_err(),
        "тот же вход в release отклоняется"
    );
    assert!(check_core(false, None).is_ok());
    assert!(check_core(false, Some(17)).is_ok());
}
