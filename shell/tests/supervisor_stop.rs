// SPDX-License-Identifier: GPL-3.0-only

//! Stop во время ожидания READY (настоящий поток надзирателя, драйвер и
//! фейк-ядро): ожидание прерывается за миллисекунды, а не за `T_SPAWN` (10 с);
//! endpoint не публикуется, нового spawn нет, остановка — ровно одна.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lavray_shell::coreproc::driver::generate_auth_token;
use lavray_shell::coreproc::runner::{spawn_supervisor, Failure, Observer};
use lavray_shell::coreproc::{CoreEndpoint, CoreSpawnConfig, CoreState, SecretToken};

#[derive(Default)]
struct Seen {
    states: Vec<CoreState>,
    unconfirmed: Vec<String>,
}

struct Recorder {
    seen: Arc<Mutex<Seen>>,
    ready: Arc<AtomicUsize>,
}

impl Observer for Recorder {
    fn on_state(&mut self, state: CoreState) {
        self.seen.lock().unwrap().states.push(state);
    }
    fn on_ready(&mut self, _endpoint: &CoreEndpoint, _token: &SecretToken) {
        self.ready.fetch_add(1, Ordering::SeqCst);
    }
    fn on_failure(&mut self, _failure: &Failure) {}
    fn on_teardown_unconfirmed(&mut self, detail: &str) {
        self.seen
            .lock()
            .unwrap()
            .unconfirmed
            .push(detail.to_owned());
    }
}

/// Молчащее ядро: ready не печатает, выходит по EOF на stdin.
fn silent_core() -> (PathBuf, Vec<String>) {
    #[cfg(unix)]
    return (
        PathBuf::from("/bin/sh"),
        vec!["-c".to_owned(), "cat > /dev/null".to_owned()],
    );
    #[cfg(windows)]
    return (
        std::env::var_os("ComSpec").map_or_else(|| PathBuf::from("cmd.exe"), PathBuf::from),
        ["/C", "findstr", "/R", ".", ">nul"]
            .map(str::to_owned)
            .to_vec(),
    );
}

#[test]
fn stop_shortly_after_spawn_cancels_the_ready_wait() {
    let seen = Arc::new(Mutex::new(Seen::default()));
    let ready = Arc::new(AtomicUsize::new(0));
    let spawns = Arc::new(AtomicUsize::new(0));
    let (counter, (binary, argv)) = (Arc::clone(&spawns), silent_core());
    let data_dir = std::env::temp_dir().join(format!("lavray-stop-it-{}", std::process::id()));
    let handle = spawn_supervisor(
        move || {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(CoreSpawnConfig {
                binary: binary.clone(),
                listen_socket: PathBuf::from("127.0.0.1:0"),
                data_dir: data_dir.clone(),
                auth_token: generate_auth_token().map_err(|e| e.to_string())?,
                agent_token: None,
                extra_args: argv.clone(),
            })
        },
        Recorder {
            seen: Arc::clone(&seen),
            ready: Arc::clone(&ready),
        },
    )
    .expect("поток надзирателя запускается");

    std::thread::sleep(Duration::from_millis(80));
    let stop_at = Instant::now();
    handle.stop();
    while !handle.is_stopped() {
        assert!(
            stop_at.elapsed() < Duration::from_secs(8),
            "Stop не прервал ожидание READY (T_SPAWN = 10 с)"
        );
        std::thread::sleep(Duration::from_millis(10));
    }

    assert_eq!(spawns.load(Ordering::SeqCst), 1, "нового spawn нет");
    assert_eq!(ready.load(Ordering::SeqCst), 0, "on_ready после Stop");
    let seen = seen.lock().unwrap();
    let states = &seen.states;
    assert_eq!(states.first(), Some(&CoreState::Spawning));
    assert_eq!(
        states.iter().filter(|s| **s == CoreState::Stopping).count(),
        1,
        "ровно один shutdown: {states:?}"
    );
    for bad in [CoreState::Ready, CoreState::SpawnErr, CoreState::Crashed] {
        assert!(!states.contains(&bad), "{bad:?} в {states:?}");
    }
    // Пока пробы §6 — заглушки (Unchecked), Stopped не объявляется.
    assert_eq!(
        states.contains(&CoreState::Stopped),
        seen.unconfirmed.is_empty(),
        "Stopped и предупреждение взаимоисключающи: {states:?} / {:?}",
        seen.unconfirmed
    );
}
