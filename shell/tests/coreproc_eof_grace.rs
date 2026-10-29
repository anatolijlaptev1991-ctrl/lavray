// SPDX-License-Identifier: GPL-3.0-only

//! A2-12: после EOF на stdin драйвер даёт ядру время на самостоятельный выход.
//! Ядро по EOF останавливает sing-box (снимает TUN) и выходит само; раньше за
//! одним `try_wait` сразу шёл SIGTERM/TerminateJobObject (на Windows — hard-kill
//! за ~20 мс), и ядро не успевало ничего закрыть.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use lavray_shell::coreproc::driver::{DriverTimeouts, RealCoreProcess};
use lavray_shell::coreproc::{CoreProcess, CoreSpawnConfig, SecretToken};

/// Фейк-ядро: печатает ready, ждёт EOF, 700 мс «закрывает sing-box» и только
/// после этого пишет маркер.
fn cleanup_after_eof_core(marker: &Path) -> CoreSpawnConfig {
    #[cfg(unix)]
    let (binary, args) = (
        "/bin/sh",
        vec![
            "-c".to_owned(),
            format!(
                "printf 'LAVRAY_CORE_READY x\\n'; cat > /dev/null; sleep 0.7; echo done > '{}'",
                marker.display()
            ),
        ],
    );
    #[cfg(windows)]
    let (binary, args) = (
        "powershell.exe",
        vec![
            "-NoProfile".to_owned(),
            "-NonInteractive".to_owned(),
            "-Command".to_owned(),
            format!(
                "[Console]::Out.WriteLine('LAVRAY_CORE_READY x'); [Console]::Out.Flush(); \
                 [Console]::In.ReadToEnd() | Out-Null; Start-Sleep -Milliseconds 700; \
                 Set-Content -Path '{}' -Value done",
                marker.display()
            ),
        ],
    );
    CoreSpawnConfig {
        binary: PathBuf::from(binary),
        listen_socket: PathBuf::from("unused"),
        data_dir: std::env::temp_dir().join(format!("lavray-eof-grace-{}", std::process::id())),
        auth_token: SecretToken::from_base64url("A".repeat(43)).unwrap(),
        agent_token: None,
        extra_args: args,
    }
}

#[test]
fn core_gets_time_to_finish_cleanup_after_stdin_eof() {
    let marker = std::env::temp_dir().join(format!("lavray-eof-marker-{}", std::process::id()));
    let _ = std::fs::remove_file(&marker);
    let mut driver = RealCoreProcess::with_timeouts(DriverTimeouts {
        eof_grace: Duration::from_secs(4),
        sigterm_wait: Duration::from_millis(600),
        kill_grace: Duration::from_millis(600),
        poll_interval: Duration::from_millis(15),
    });
    driver.spawn(&cleanup_after_eof_core(&marker)).unwrap();
    driver.wait_ready(Duration::from_secs(20)).unwrap();

    let started = Instant::now();
    driver.kill(Duration::from_secs(8)).unwrap();
    let took = started.elapsed();

    assert!(
        marker.exists(),
        "ядро убито за {took:?}, не закончив уборку после EOF"
    );
    assert!(!driver.is_running());
    assert!(
        took < Duration::from_secs(4),
        "ждали дольше паузы EOF: {took:?}"
    );
    let _ = std::fs::remove_file(&marker);
}
