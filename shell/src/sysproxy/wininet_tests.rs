// SPDX-License-Identifier: GPL-3.0-only

//! Настоящий WinINET на выдуманном имени записи RAS (только Windows).
//!
//! Тест пишет в HKCU пользователя, под которым запущен, поэтому идёт только
//! по явному разрешению окружения: `LAVRAY_CI_REAL_WININET=1` (одноразовый
//! раннер CI). Без переменной он возвращается, не вызвав ни одной функции
//! WinINET; локально её не выставляют.

use super::conn::{ConnSettings, Connections, DIRECT, PROXY};
use super::wininet::WinInet;

/// Имени нет в телефонной книге: настоящие подключения не затрагиваются.
const FAKE_RAS_NAME: &str = "LAVRay CI fake RAS entry";

#[test]
fn wininet_roundtrip_on_fake_ras_name() {
    if std::env::var("LAVRAY_CI_REAL_WININET").as_deref() != Ok("1") {
        eprintln!("пропущен: LAVRAY_CI_REAL_WININET не равна 1");
        return;
    }
    let ours = ConnSettings {
        flags: DIRECT | PROXY,
        server: Some("127.0.0.1:2080".into()),
        bypass: Some("<local>".into()),
        pac_url: None,
    };
    let api = WinInet;
    let before = api.get(Some(FAKE_RAS_NAME)).unwrap();
    api.set(Some(FAKE_RAS_NAME), &ours.to_change()).unwrap();
    let got = api.get(Some(FAKE_RAS_NAME));
    // Прежнее состояние возвращается до любых проверок.
    api.set(Some(FAKE_RAS_NAME), &before.to_change()).unwrap();
    assert_eq!(got.unwrap(), ours);
}
