// SPDX-License-Identifier: GPL-3.0-only

//! Операции с системным прокси идут по одной (`serial.rs`). Бэкенд подставной:
//! настоящую ОС тесты не трогают.

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Бэкенд, который считает, сколько операций идёт одновременно.
#[derive(Clone, Default)]
struct Probe {
    active: Arc<AtomicUsize>,
    peak: Arc<AtomicUsize>,
    calls: Arc<AtomicUsize>,
}

struct Busy<'a>(&'a Probe);

impl Probe {
    fn enter(&self) -> Busy<'_> {
        let now = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(now, Ordering::SeqCst);
        self.calls.fetch_add(1, Ordering::SeqCst);
        // Окно, в котором чужая операция успела бы вклиниться.
        std::thread::sleep(Duration::from_millis(2));
        Busy(self)
    }
}

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Backend for Probe {
    fn capture(&self) -> Result<ProxySnapshot, String> {
        let _busy = self.enter();
        Ok(ProxySnapshot {
            version: 3,
            os: "test".into(),
            data: serde_json::json!({"ProxyServer": null}),
        })
    }

    fn apply(&self, _: &str, _: u16, _: &ProxySnapshot) -> Result<Vec<String>, String> {
        let _busy = self.enter();
        Ok(Vec::new())
    }

    fn restore(&self, _: &ProxySnapshot) -> Result<Vec<String>, String> {
        let _busy = self.enter();
        Ok(Vec::new())
    }
}

/// Включения и выключения из разных потоков (UI, надзиратель, выход) идут по
/// одному: бэкенд никогда не видит двух операций сразу.
#[test]
fn concurrent_enable_disable_serialized() {
    let probe = Probe::default();
    let workers: Vec<_> = (0..6)
        .map(|n| {
            let probe = probe.clone();
            std::thread::spawn(move || {
                let dir = super::fakes::fresh_dir(&format!("concurrent-{n}"));
                let sp = SysProxy::with_backend(&dir, probe);
                for _ in 0..5 {
                    sp.enable("127.0.0.1", 2080).unwrap();
                    sp.disable().unwrap();
                }
            })
        })
        .collect();
    for worker in workers {
        worker.join().unwrap();
    }
    assert!(probe.calls.load(Ordering::SeqCst) >= 6 * 5 * 4);
    assert_eq!(probe.peak.load(Ordering::SeqCst), 1);
}
