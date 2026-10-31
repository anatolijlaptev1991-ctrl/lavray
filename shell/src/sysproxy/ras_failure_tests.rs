// SPDX-License-Identifier: GPL-3.0-only

//! Сбои RAS не срывают включение (T-82): частичное применение с
//! предупреждениями. Реестр, WinINET и RAS — подставные.

use super::fakes::{fresh_dir, state, vpn_env, HOME, OFFICE};
use super::values::RegValue;

#[test]
fn ras_enum_failure_lan_only_with_warning() {
    let env = vpn_env();
    let before = state(&env);
    *env.ras.0.borrow_mut() = Err("RasEnumEntriesW: код 5".into());
    let sp = env.manager(&fresh_dir("ras-enum-fail"));
    let applied = sp.enable("127.0.0.1", 2080).unwrap();
    assert_eq!(applied.warnings.len(), 1, "{:?}", applied.warnings);
    assert!(applied.warnings[0].contains("RasEnumEntriesW"));
    assert!(applied.warnings[0].contains("только для LAN"));
    let now = state(&env);
    assert_eq!(
        now.0["ProxyServer"],
        RegValue::sz("127.0.0.1:2080"),
        "LAN есть"
    );
    assert_eq!((&now.2, &now.3), (&before.2, &before.3), "RAS не тронут");
    assert!(sp.pending_snapshot().unwrap().data.get("ras").is_none());
    sp.disable().unwrap();
    assert_eq!(state(&env), before);
}

#[test]
fn one_failing_ras_entry_does_not_break_the_others() {
    let env = vpn_env();
    let before = state(&env);
    env.conns.broken_set.borrow_mut().insert(OFFICE.into());
    let sp = env.manager(&fresh_dir("ras-one-fails"));
    let applied = sp.enable("127.0.0.1", 2080).unwrap();
    assert_eq!(applied.warnings.len(), 1, "{:?}", applied.warnings);
    assert!(applied.warnings[0].contains(OFFICE));
    assert_eq!(
        env.conns.entry(HOME).server.as_deref(),
        Some("127.0.0.1:2080")
    );
    assert_eq!(env.conns.entry(OFFICE), before.2);
    sp.disable().unwrap();
    assert_eq!(state(&env), before);
}

#[test]
fn unreadable_ras_entry_is_left_alone() {
    let env = vpn_env();
    let before = state(&env);
    env.conns.broken_get.borrow_mut().insert(HOME.into());
    let sp = env.manager(&fresh_dir("ras-unreadable"));
    let applied = sp.enable("127.0.0.1", 2080).unwrap();
    assert!(applied.warnings.iter().any(|w| w.contains(HOME)));
    assert_eq!(env.conns.entry(HOME), before.3, "не читалась - не тронута");
    let snap = sp.pending_snapshot().unwrap();
    assert!(
        snap.data["ras"][HOME].is_null(),
        "в снимке - null, не пропуск"
    );
    assert_eq!(
        env.conns.entry(OFFICE).server.as_deref(),
        Some("127.0.0.1:2080")
    );
    env.conns.broken_get.borrow_mut().clear();
    sp.disable().unwrap();
    assert_eq!(state(&env), before);
}

#[test]
fn ras_entry_deleted_during_the_session_is_skipped_on_restore() {
    let env = vpn_env();
    let before = state(&env);
    let sp = env.manager(&fresh_dir("ras-deleted"));
    sp.enable("127.0.0.1", 2080).unwrap();
    env.conns.remove(HOME);
    *env.ras.0.borrow_mut() = Ok(vec![OFFICE.to_string()]);
    sp.disable().unwrap();
    assert_eq!(env.conns.entry(OFFICE), before.2);
    assert_eq!(env.conns.lan(), before.1);
}

/// Запись, которая на выходе не читается, всё равно возвращается: оставить
/// подключение с нашим прокси хуже, чем записать его без сравнения.
#[test]
fn ras_entry_unreadable_at_restore_is_still_restored() {
    let env = vpn_env();
    let before = state(&env);
    let sp = env.manager(&fresh_dir("ras-unreadable-at-restore"));
    sp.enable("127.0.0.1", 2080).unwrap();
    env.conns.broken_get.borrow_mut().insert(HOME.into());
    sp.disable().unwrap();
    env.conns.broken_get.borrow_mut().clear();
    assert_eq!(state(&env), before);
}

/// Ревью Ф2: запись RAS, которую на выходе не удалось вернуть, не должна
/// остаться с прокси на мёртвый порт навсегда: снимок сохраняется, и следующий
/// откат (отключение или запуск) её возвращает.
#[test]
fn failed_ras_restore_keeps_the_snapshot_and_is_retried() {
    let env = vpn_env();
    let before = state(&env);
    let sp = env.manager(&fresh_dir("ras-restore-retry"));
    sp.enable("127.0.0.1", 2080).unwrap();
    env.conns.broken_set.borrow_mut().insert(HOME.into());
    let warnings = sp.disable_report().unwrap();
    assert!(warnings.iter().any(|w| w.contains(HOME)), "{warnings:?}");
    assert_eq!(env.conns.lan(), before.1, "LAN уже вернулся");
    assert!(
        sp.pending_snapshot().is_some(),
        "снимок остался для повтора"
    );
    env.conns.broken_set.borrow_mut().clear();
    assert!(sp.recover_if_needed().unwrap(), "повтор при запуске");
    assert_eq!(state(&env), before);
    assert!(
        sp.pending_snapshot().is_none(),
        "после удачного отката снимка нет"
    );
}
