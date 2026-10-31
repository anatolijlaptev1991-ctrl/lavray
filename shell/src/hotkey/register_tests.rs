// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::hotkey::accel::parse_accel;
use std::cell::RefCell;
use std::collections::HashSet;

/// ОС в памяти: журнал вызовов, занятые другими программами сочетания.
#[derive(Default)]
struct FakeOs {
    log: RefCell<Vec<String>>,
    held: RefCell<HashSet<String>>,
    taken_by_others: HashSet<String>,
}

impl FakeOs {
    fn taken(names: &[&str]) -> Self {
        Self {
            taken_by_others: names.iter().map(|n| n.to_string()).collect(),
            ..Self::default()
        }
    }
}

impl HotkeyBackend for FakeOs {
    fn register(&self, accel: &Accel) -> Result<(), String> {
        let name = accel.to_string();
        self.log.borrow_mut().push(format!("+{name}"));
        if self.taken_by_others.contains(&name) || !self.held.borrow_mut().insert(name) {
            return Err("HotKey already registered".into());
        }
        Ok(())
    }

    fn unregister(&self, accel: &Accel) -> Result<(), String> {
        let name = accel.to_string();
        self.log.borrow_mut().push(format!("-{name}"));
        if self.held.borrow_mut().remove(&name) {
            Ok(())
        } else {
            Err("not registered".into())
        }
    }
}

fn a(raw: &str) -> Accel {
    parse_accel(raw).unwrap()
}

#[test]
fn hotkey_default_off() {
    assert_eq!(HotkeySlot::default().current(), None);
}

#[test]
fn hotkey_set_registers() {
    let (os, slot) = (FakeOs::default(), HotkeySlot::default());
    slot.set(&os, Some(a("Ctrl+Alt+K"))).unwrap();
    assert_eq!(slot.current(), Some(a("Ctrl+Alt+K")));
    assert_eq!(*os.log.borrow(), ["+Ctrl+Alt+K"]);
}

#[test]
fn hotkey_change_unregisters_old_first() {
    let (os, slot) = (FakeOs::default(), HotkeySlot::default());
    slot.set(&os, Some(a("Ctrl+Alt+K"))).unwrap();
    slot.set(&os, Some(a("Ctrl+Alt+L"))).unwrap();
    assert_eq!(
        *os.log.borrow(),
        ["+Ctrl+Alt+K", "-Ctrl+Alt+K", "+Ctrl+Alt+L"]
    );
    assert_eq!(slot.current(), Some(a("Ctrl+Alt+L")));
}

#[test]
fn same_accel_is_a_noop() {
    let (os, slot) = (FakeOs::default(), HotkeySlot::default());
    slot.set(&os, Some(a("Ctrl+Alt+K"))).unwrap();
    slot.set(&os, Some(a("alt+ctrl+k"))).unwrap();
    assert_eq!(os.log.borrow().len(), 1, "повторная регистрация не нужна");
}

#[test]
fn hotkey_conflict_reported_and_old_kept() {
    let os = FakeOs::taken(&["Ctrl+Alt+L"]);
    let slot = HotkeySlot::default();
    slot.set(&os, Some(a("Ctrl+Alt+K"))).unwrap();
    let err = slot.set(&os, Some(a("Ctrl+Alt+L"))).unwrap_err();
    assert_eq!(err.code(), "conflict");
    assert_eq!(slot.current(), Some(a("Ctrl+Alt+K")), "прежнее вернули");
    assert!(os.held.borrow().contains("Ctrl+Alt+K"));
}

#[test]
fn conflict_without_previous_leaves_nothing() {
    let os = FakeOs::taken(&["Ctrl+Alt+L"]);
    let slot = HotkeySlot::default();
    assert!(slot.set(&os, Some(a("Ctrl+Alt+L"))).is_err());
    assert_eq!(slot.current(), None);
}

#[test]
fn clearing_unregisters() {
    let (os, slot) = (FakeOs::default(), HotkeySlot::default());
    slot.set(&os, Some(a("Ctrl+Alt+K"))).unwrap();
    slot.set(&os, None).unwrap();
    assert_eq!(slot.current(), None);
    assert!(os.held.borrow().is_empty());
    slot.set(&os, None).unwrap();
    assert_eq!(os.log.borrow().len(), 2, "снятие пустого — без вызовов");
}

#[test]
fn failed_unregister_does_not_block_replacement() {
    let (os, slot) = (FakeOs::default(), HotkeySlot::default());
    slot.set(&os, Some(a("Ctrl+Alt+K"))).unwrap();
    os.held.borrow_mut().clear(); // ОС уже сняла сама
    slot.set(&os, Some(a("Ctrl+Alt+L"))).unwrap();
    assert_eq!(slot.current(), Some(a("Ctrl+Alt+L")));
}

#[test]
fn concurrent_sets_end_consistent() {
    use std::sync::Arc;
    struct SyncOs(std::sync::Mutex<HashSet<String>>);
    impl HotkeyBackend for SyncOs {
        fn register(&self, accel: &Accel) -> Result<(), String> {
            if self.0.lock().unwrap().insert(accel.to_string()) {
                Ok(())
            } else {
                Err("held".into())
            }
        }
        fn unregister(&self, accel: &Accel) -> Result<(), String> {
            self.0.lock().unwrap().remove(&accel.to_string());
            Ok(())
        }
    }
    let os = Arc::new(SyncOs(std::sync::Mutex::new(HashSet::new())));
    let slot = Arc::new(HotkeySlot::default());
    let threads: Vec<_> = ["Ctrl+Alt+1", "Ctrl+Alt+2", "Ctrl+Alt+3", "Ctrl+Alt+4"]
        .into_iter()
        .map(|raw| {
            let (os, slot) = (Arc::clone(&os), Arc::clone(&slot));
            std::thread::spawn(move || slot.set(&*os, Some(a(raw))).unwrap())
        })
        .collect();
    for t in threads {
        t.join().unwrap();
    }
    let held = os.0.lock().unwrap();
    assert_eq!(held.len(), 1, "в ОС держится ровно одно: {held:?}");
    assert_eq!(
        held.iter().next().cloned(),
        slot.current().map(|a| a.to_string())
    );
}
