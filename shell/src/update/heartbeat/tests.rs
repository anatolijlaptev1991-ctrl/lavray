// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::update::testkit::TempDir;

const START: u64 = 1_000_000;
const GRACE: u64 = 60_000;

fn health(version: &str, ok_at: u64) -> Health {
    Health {
        version: version.to_string(),
        ok_at,
    }
}

#[test]
fn a_fresh_heartbeat_of_the_expected_version_is_ok() {
    let h = health("0.5.1", START + 5_000);
    assert_eq!(
        evaluate(Some(&h), "0.5.1", START, START + 6_000),
        HealthVerdict::Ok
    );
    // и после grace-периода: отметка уже стоит
    assert_eq!(
        evaluate(Some(&h), "0.5.1", START, START + 10 * GRACE),
        HealthVerdict::Ok
    );
}

#[test]
fn heartbeat_wrong_version_is_missing() {
    let old = health("0.4.0", START + 5_000);
    // пока идёт grace — ждём, отметка старой версии не считается здоровьем
    assert_eq!(
        evaluate(Some(&old), "0.5.0", START, START + 1_000),
        HealthVerdict::Pending
    );
    // по истечении grace — отметки нет
    assert_eq!(
        evaluate(Some(&old), "0.5.0", START, START + GRACE),
        HealthVerdict::Missing
    );
}

#[test]
fn a_stale_heartbeat_from_before_the_start_does_not_count() {
    let stale = health("0.5.1", START - 1);
    assert_eq!(
        evaluate(Some(&stale), "0.5.1", START, START + GRACE),
        HealthVerdict::Missing
    );
    let exact = health("0.5.1", START);
    assert_eq!(
        evaluate(Some(&exact), "0.5.1", START, START),
        HealthVerdict::Ok
    );
}

#[test]
fn no_heartbeat_is_pending_until_the_grace_period_ends() {
    assert_eq!(
        evaluate(None, "0.5.1", START, START),
        HealthVerdict::Pending
    );
    assert_eq!(
        evaluate(None, "0.5.1", START, START + GRACE - 1),
        HealthVerdict::Pending
    );
    assert_eq!(
        evaluate(None, "0.5.1", START, START + GRACE),
        HealthVerdict::Missing
    );
}

#[test]
fn a_clock_that_went_backwards_does_not_trigger_a_timeout() {
    assert_eq!(
        evaluate(None, "0.5.1", START, START - 5_000),
        HealthVerdict::Pending
    );
}

#[test]
fn a_leading_v_in_the_expected_version_is_ignored() {
    let h = health("0.5.1", START + 1);
    assert_eq!(
        evaluate(Some(&h), "v0.5.1", START, START + 2),
        HealthVerdict::Ok
    );
}

#[test]
fn the_store_writes_the_agreed_json_and_reads_it_back() {
    let tmp = TempDir::new("health");
    let store = HealthStore::new(&Layout::new(tmp.path()));
    assert_eq!(store.read(), None, "файла ещё нет");

    store.write_ok("0.5.1", 1_700_000_000_123).unwrap();
    let raw = std::fs::read_to_string(tmp.path().join("updates").join("health.json")).unwrap();
    assert_eq!(raw, r#"{"version":"0.5.1","ok_at":1700000000123}"#);
    assert_eq!(store.read(), Some(health("0.5.1", 1_700_000_000_123)));
}

#[test]
fn writing_twice_is_idempotent_and_keeps_the_newest_time() {
    let tmp = TempDir::new("health-twice");
    let store = HealthStore::new(&Layout::new(tmp.path()));
    store.write_ok("0.5.1", 10).unwrap();
    store.write_ok("0.5.1", 20).unwrap();
    assert_eq!(store.read(), Some(health("0.5.1", 20)));
}

#[test]
fn a_corrupt_file_reads_as_no_heartbeat() {
    let tmp = TempDir::new("health-corrupt");
    let dir = tmp.path().join("updates");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("health.json"), b"{not json").unwrap();
    assert_eq!(HealthStore::new(&Layout::new(tmp.path())).read(), None);
}
