// SPDX-License-Identifier: GPL-3.0-only

//! Настоящий WinINET на выдуманном имени записи RAS (только Windows).
//!
//! Тесты пишут в HKCU пользователя, под которым запущены, поэтому идут только
//! по явному разрешению окружения: `LAVRAY_CI_REAL_WININET=1` (одноразовый
//! раннер CI). Без переменной они возвращаются, не вызвав ни одной функции
//! WinINET; локально её не выставляют.
//!
//! Даже на раннере после каждого теста возвращаются четыре значения LAN
//! (`ProxyEnable`, `ProxyServer`, `ProxyOverride`, `AutoConfigURL`) и
//! удаляется значение выдуманной записи в `Connections`: прогон 0.9.0 (D-1)
//! показал, что запись подключения RAS через WinINET обнуляет `ProxyServer`.

use super::backend::Backend;
use super::conn::{ConnSettings, Connections, DIRECT, PROXY};
use super::ras::RasEntries;
use super::registry::{reg_exe, RegExe};
use super::values::{capture_with, restore_with, RegValue, Registry};
use super::windows::Windows;
use super::wininet::WinInet;
use super::ProxySnapshot;
use std::sync::{Mutex, MutexGuard, PoisonError};

/// Имени нет в телефонной книге: настоящие подключения не затрагиваются.
const FAKE_RAS_NAME: &str = "LAVRay CI fake RAS entry";
const CONNECTIONS_KEY: &str =
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Connections";

/// Тесты меняют общие значения LAN и потому идут по одному.
static SERIAL: Mutex<()> = Mutex::new(());

fn allowed() -> bool {
    let on = std::env::var("LAVRAY_CI_REAL_WININET").as_deref() == Ok("1");
    if !on {
        eprintln!("пропущен: LAVRAY_CI_REAL_WININET не равна 1");
    }
    on
}

/// Возвращает значения LAN и удаляет выдуманную запись, даже если тест упал.
struct Restore {
    lan: ProxySnapshot,
    _serial: MutexGuard<'static, ()>,
}

impl Drop for Restore {
    fn drop(&mut self) {
        let lan = restore_with(&RegExe, &self.lan);
        // Нет значения — не ошибка: запись могла и не создаться.
        let _ = std::process::Command::new(reg_exe())
            .args(["delete", CONNECTIONS_KEY, "/v", FAKE_RAS_NAME, "/f"])
            .output();
        WinInet.refresh();
        if let Err(e) = lan {
            eprintln!("значения LAN не возвращены: {e}");
        }
    }
}

fn restore_after() -> Restore {
    let serial = SERIAL.lock().unwrap_or_else(PoisonError::into_inner);
    Restore {
        lan: capture_with(&RegExe).unwrap(),
        _serial: serial,
    }
}

/// Список RAS из одной выдуманной записи.
struct FakeEntry;

impl RasEntries for FakeEntry {
    fn names(&self) -> Result<Vec<String>, String> {
        Ok(vec![FAKE_RAS_NAME.into()])
    }
}

#[test]
fn wininet_roundtrip_on_fake_ras_name() {
    if !allowed() {
        return;
    }
    let _restore = restore_after();
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
    api.set(Some(FAKE_RAS_NAME), &before.to_change()).unwrap();
    assert_eq!(got.unwrap(), ours);
}

#[test]
fn lan_values_survive_a_real_ras_roundtrip() {
    if !allowed() {
        return;
    }
    let _restore = restore_after();
    // Как на ПК прогона 0.9.0: прокси выключен, но адрес сервера задан.
    RegExe.write("ProxyEnable", &RegValue::dword(0)).unwrap();
    RegExe
        .write("ProxyServer", &RegValue::sz("10.255.255.1:3128"))
        .unwrap();
    let before = RegExe.read().unwrap();
    let sys = Windows {
        reg: RegExe,
        conns: WinInet,
        ras: FakeEntry,
    };
    let snap = sys.capture().unwrap();
    sys.apply("127.0.0.1", 9, &snap).unwrap();
    let on = RegExe.read().unwrap();
    assert_eq!(on["ProxyServer"], RegValue::sz("127.0.0.1:9"));
    sys.restore(&snap).unwrap();
    assert_eq!(RegExe.read().unwrap(), before);
}
