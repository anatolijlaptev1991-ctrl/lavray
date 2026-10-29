//! A2-11/A2-23: надзиратель `coreproc::runner` с настоящим потоком, драйвером
//! процесса и фейк-ядром — то, что раньше жило только в `main.rs` и тестами не
//! проверялось. Фейк-ядро — интерпретатор ОС с готовым argv.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lavray_shell::coreproc::driver::generate_auth_token;
use lavray_shell::coreproc::runner::{spawn_supervisor, Failure, Observer};
use lavray_shell::coreproc::{CoreEndpoint, CoreSpawnConfig, CoreState, SecretToken};

struct Recorder(Arc<Mutex<Vec<CoreState>>>);

impl Observer for Recorder {
    fn on_state(&mut self, state: CoreState) {
        self.0.lock().unwrap().push(state);
    }
    fn on_ready(&mut self, _endpoint: &CoreEndpoint, _token: &SecretToken) {}
    fn on_failure(&mut self, _failure: &Failure) {}
}

/// Фейк «ядро падает сразу после ready».
fn ready_then_exit() -> (PathBuf, Vec<String>) {
    #[cfg(unix)]
    return (
        PathBuf::from("/bin/sh"),
        vec![
            "-c".to_owned(),
            "printf 'LAVRAY_CORE_READY x\\n'".to_owned(),
        ],
    );
    #[cfg(windows)]
    return (
        std::env::var_os("ComSpec").map_or_else(|| PathBuf::from("cmd.exe"), PathBuf::from),
        ["/C", "echo", "LAVRAY_CORE_READY", "x"]
            .map(str::to_owned)
            .to_vec(),
    );
}

/// Ядро, умирающее сразу после READY, перезапускается два раза (паузы ≈1 с и
/// ≈2 с) и после третьего падения за минуту больше не перезапускается. Раньше
/// цикл в `main.rs` перезапускал его каждые ~1,5 с бесконечно.
#[test]
fn a_core_dying_right_after_ready_is_restarted_only_twice() {
    let states = Arc::new(Mutex::new(Vec::new()));
    let spawns = Arc::new(AtomicUsize::new(0));
    let (counter, (binary, argv)) = (Arc::clone(&spawns), ready_then_exit());
    let data_dir =
        std::env::temp_dir().join(format!("lavray-supervisor-it-{}", std::process::id()));
    let handle = spawn_supervisor(
        move || {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(CoreSpawnConfig {
                binary: binary.clone(),
                listen_socket: PathBuf::from("127.0.0.1:0"),
                data_dir: data_dir.clone(),
                auth_token: generate_auth_token().map_err(|e| e.to_string())?,
                extra_args: argv.clone(),
            })
        },
        Recorder(Arc::clone(&states)),
    )
    .expect("поток надзирателя запускается");

    let started = Instant::now();
    while !states.lock().unwrap().contains(&CoreState::RateLimited) {
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "RateLimited не наступил"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(spawns.load(Ordering::SeqCst), 3, "три запуска, не больше");
    std::thread::sleep(Duration::from_millis(2500)); // после лимита запусков нет
    assert_eq!(spawns.load(Ordering::SeqCst), 3, "рестарты не прекращены");

    handle.stop();
    while !handle.is_stopped() {
        assert!(
            started.elapsed() < Duration::from_secs(60),
            "надзиратель не остановился"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}
