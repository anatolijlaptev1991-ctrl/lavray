// SPDX-License-Identifier: GPL-3.0-only

//! Интеграционные тесты рантайм-драйвера ядра (`coreproc::driver`) с
//! ФЕЙК-ядром: платформенный интерпретатор (`/bin/sh` / `cmd.exe`) + скрипт
//! через `CoreSpawnConfig::extra_args` (полный override argv — интерфейс
//! драйвера не искажается). Фейк закрывает контракты §3/§5: печать
//! `LAVRAY_CORE_READY <url>`, удержание stdin, ранний exit, молчание,
//! игнорирование SIGTERM (эскалация SIGKILL — Unix).
//!
//! Тайминги лестницы §5 укорочены инъекцией `DriverTimeouts`; бюджет
//! `wait_ready` передаётся напрямую (T_SPAWN в supervisor'е — 10 с, здесь
//! достаточно 5 с). На Windows graceful-сигнала нет — лестница шага 3 это
//! TerminateJobObject/TerminateProcess (см. driver.rs).

use std::path::PathBuf;
use std::time::Duration;

use lavray_shell::coreproc::driver::{DriverTimeouts, RealCoreProcess, READY_LINE_PREFIX};
use lavray_shell::coreproc::{
    CoreProcess, CoreProcessError, CoreSpawnConfig, CoreState, CoreSupervisor, SecretToken,
    SystemClock,
};

/// Бюджет wait_ready в тестах (фейк печатает ready за миллисекунды).
const WAIT_READY: Duration = Duration::from_secs(5);
/// Бюджет kill-лестницы в тестах.
const KILL_BUDGET: Duration = Duration::from_secs(2);
/// URL фейк-транспорта (§3.4 — адрес выделяет «ядро», оболочка его только читает).
const FAKE_URL: &str = "http://127.0.0.1:1";

/// Интерпретатор фейк-ядра: POSIX sh / Windows cmd (ComSpec).
#[cfg(unix)]
fn interpreter() -> PathBuf {
    PathBuf::from("/bin/sh")
}

#[cfg(windows)]
fn interpreter() -> PathBuf {
    std::env::var_os("ComSpec")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("cmd.exe"))
}

/// Уникальный каталог данных теста (cwd фейка, §3.3).
fn temp_data_dir(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("lavray-driver-it-{}-{tag}", std::process::id()))
}

/// Конфиг запуска фейк-ядра: интерпретатор + override-argv.
fn fake_config(tag: &str, argv: Vec<String>) -> CoreSpawnConfig {
    CoreSpawnConfig {
        binary: interpreter(),
        listen_socket: PathBuf::from("/nonexistent/lavray-it.sock"),
        data_dir: temp_data_dir(tag),
        auth_token: SecretToken::from_base64url("A".repeat(43)).unwrap(),
        agent_token: None,
        extra_args: argv,
    }
}

/// Фейк №1 «здоровое ядро»: печатает ready-строку и живёт, пока оболочка
/// держит stdin открытым (§3.2). Unix: `cat` блокируется на stdin; Windows:
/// `ping -n 60` (сон без консоли — `timeout.exe` не работает с пайпами).
fn ready_and_hold_argv(url: &str) -> Vec<String> {
    #[cfg(unix)]
    {
        vec![
            "-c".to_owned(),
            format!("printf 'LAVRAY_CORE_READY {url}\\n'; cat > /dev/null"),
        ]
    }
    #[cfg(windows)]
    {
        vec![
            "/C".to_owned(),
            "echo".to_owned(),
            "LAVRAY_CORE_READY".to_owned(),
            url.to_owned(),
            "&".to_owned(),
            "ping".to_owned(),
            "-n".to_owned(),
            "60".to_owned(),
            "127.0.0.1".to_owned(),
            ">nul".to_owned(),
        ]
    }
}

/// Фейк №2 «крах до готовности»: немедленный exit с кодом 7.
fn exit_fast_argv() -> Vec<String> {
    #[cfg(unix)]
    {
        vec!["-c".to_owned(), "exit 7".to_owned()]
    }
    #[cfg(windows)]
    {
        vec!["/C".to_owned(), "exit".to_owned(), "7".to_owned()]
    }
}

/// Фейк №3 «молчащее ядро»: жив, но ready-строку не печатает.
fn silent_hold_argv() -> Vec<String> {
    #[cfg(unix)]
    {
        vec!["-c".to_owned(), "cat > /dev/null".to_owned()]
    }
    #[cfg(windows)]
    {
        vec![
            "/C".to_owned(),
            "ping".to_owned(),
            "-n".to_owned(),
            "60".to_owned(),
            "127.0.0.1".to_owned(),
            ">nul".to_owned(),
        ]
    }
}

/// Драйвер с короткими таймингами лестницы §5.
fn test_driver() -> RealCoreProcess {
    RealCoreProcess::with_timeouts(DriverTimeouts {
        eof_grace: Duration::from_millis(200),
        sigterm_wait: Duration::from_millis(600),
        kill_grace: Duration::from_millis(600),
        poll_interval: Duration::from_millis(15),
    })
}

/// Драйвер с длинным `eof_grace` для тестов, где фейк дописывает файл после
/// EOF на stdin: на медленном раннере Windows `findstr` не успевал за 200 мс и
/// убивался с пустым файлом. Фейк выходит сам — ожидание кончается раньше.
fn patient_driver() -> RealCoreProcess {
    RealCoreProcess::with_timeouts(DriverTimeouts {
        eof_grace: Duration::from_secs(5),
        sigterm_wait: Duration::from_millis(600),
        kill_grace: Duration::from_millis(600),
        poll_interval: Duration::from_millis(15),
    })
}

/// Зачистка каталога данных теста (лучшее усилие).
fn cleanup(config: &CoreSpawnConfig) {
    let _ = std::fs::remove_dir_all(&config.data_dir);
}

/// §2/§3/§5 полный цикл FSM с реальным процессом: Idle → Spawning → Ready
/// → Connected → Stopping (kill-лестница убивает фейк) → Stopped.
#[test]
fn supervisor_drives_real_process_full_cycle() {
    let mut supervisor = CoreSupervisor::new(test_driver(), SystemClock);
    assert_eq!(supervisor.state(), CoreState::Idle);

    let config = fake_config("fsm", ready_and_hold_argv(FAKE_URL));
    assert_eq!(supervisor.start(&config).unwrap(), CoreState::Spawning);
    let endpoint = supervisor.wait_ready().unwrap();
    assert_eq!(endpoint.transport_url, FAKE_URL);
    assert_eq!(supervisor.state(), CoreState::Ready);

    assert_eq!(supervisor.mark_connected().unwrap(), CoreState::Connected);
    assert_eq!(supervisor.request_stop().unwrap(), CoreState::Stopping);
    assert_eq!(
        supervisor.mark_teardown_verified().unwrap(),
        CoreState::Stopped
    );
    cleanup(&config);
}

/// §3.4 + §5 напрямую через драйвер: spawn → wait_ready (endpoint) → kill
/// → процесс мёртв, exit-статус зафиксирован, kill идемпотентен.
#[test]
fn driver_ready_then_kill_leaves_no_process() {
    let mut driver = test_driver();
    let config = fake_config("ready-kill", ready_and_hold_argv(FAKE_URL));

    driver.spawn(&config).unwrap();
    assert!(driver.is_running());
    let endpoint = driver.wait_ready(WAIT_READY).unwrap();
    assert_eq!(endpoint.transport_url, FAKE_URL);

    driver.kill(KILL_BUDGET).unwrap();
    assert!(!driver.is_running(), "после kill процесса нет");
    assert!(driver.exit_status().is_some(), "exit-статус зафиксирован");
    assert_eq!(driver.kill(KILL_BUDGET), Ok(()), "kill идемпотентен");
    cleanup(&config);
}

/// Фейк «пишущий stdin»: печатает ready-строку и складывает всё, что оболочка
/// прислала в stdin, в файл (по EOF он дописывается и закрывается).
fn record_stdin_argv(url: &str, file: &std::path::Path) -> Vec<String> {
    let file = file.display().to_string();
    #[cfg(unix)]
    {
        vec![
            "-c".to_owned(),
            format!("printf 'LAVRAY_CORE_READY {url}\\n'; cat > '{file}'"),
        ]
    }
    #[cfg(windows)]
    {
        vec![
            "/C".to_owned(),
            "echo".to_owned(),
            "LAVRAY_CORE_READY".to_owned(),
            url.to_owned(),
            "&".to_owned(),
            "findstr".to_owned(),
            "/R".to_owned(),
            ".".to_owned(),
            ">".to_owned(),
            file,
        ]
    }
}

/// Агентский токен MCP доходит до процесса второй строкой stdin, а в командной
/// строке (видна всем пользователям системы) нет ни его, ни основного токена.
#[test]
fn agent_token_reaches_the_core_as_the_second_stdin_line() {
    let main = "M".repeat(43);
    let agent = "G".repeat(43);
    let dir = temp_data_dir("agent-token");
    std::fs::create_dir_all(&dir).unwrap();
    let recorded = dir.join("stdin.txt");

    let mut driver = patient_driver();
    let mut config = fake_config("agent-token", record_stdin_argv(FAKE_URL, &recorded));
    config.auth_token = SecretToken::from_base64url(main.clone()).unwrap();
    config.agent_token = Some(SecretToken::from_base64url(agent.clone()).unwrap());

    driver.spawn(&config).unwrap();
    driver.wait_ready(WAIT_READY).unwrap();
    // EOF на stdin: фейк дописывает файл и выходит сам
    driver.kill(KILL_BUDGET).unwrap();

    let text = std::fs::read_to_string(&recorded).expect("фейк записал stdin");
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    assert_eq!(lines, [main.as_str(), agent.as_str()], "stdin: {text:?}");

    let argv = lavray_shell::coreproc::driver::spawn_args(&config).join(" ");
    assert!(!argv.contains(&main) && !argv.contains(&agent));
    cleanup(&config);
}

/// §2.2 ранний exit → SpawnErr-причина; инвариант «процесс мёртв».
#[test]
fn crashed_core_fails_wait_ready_with_exit_reason() {
    let mut driver = test_driver();
    let config = fake_config("crash", exit_fast_argv());

    driver.spawn(&config).unwrap();
    let err = driver.wait_ready(WAIT_READY).unwrap_err();
    match &err {
        CoreProcessError::ReadyTimeout { reason, .. } => {
            assert!(
                reason.contains("exited before ready"),
                "причина — ранний exit, а не тишина: {reason}"
            );
        }
        other => panic!("ожидался ReadyTimeout, получен {other:?}"),
    }
    assert!(!driver.is_running());
    cleanup(&config);
}

/// §2.2 таймаут t_spawn: ядро живо, но ready-строки нет → ReadyTimeout, и
/// драйвер НЕ оставляет живой процесс (инвариант SpawnErr).
#[test]
fn silent_core_times_out_and_gets_cleaned_up() {
    let mut driver = test_driver();
    let config = fake_config("silent", silent_hold_argv());

    driver.spawn(&config).unwrap();
    assert!(driver.is_running());
    let err = driver.wait_ready(Duration::from_millis(400)).unwrap_err();
    match &err {
        CoreProcessError::ReadyTimeout { budget, reason } => {
            assert_eq!(*budget, Duration::from_millis(400));
            assert!(
                reason.contains(READY_LINE_PREFIX.trim()),
                "причина — отсутствие ready-строки: {reason}"
            );
        }
        other => panic!("ожидался ReadyTimeout, получен {other:?}"),
    }
    assert!(
        !driver.is_running(),
        "молчащий застреленный ядро не остаётся жить (инвариант SpawnErr)"
    );
    cleanup(&config);
}

/// Один драйвер — один процесс: повторный spawn при живом ядре отвергается.
#[test]
fn second_spawn_while_running_is_rejected() {
    let mut driver = test_driver();
    let config = fake_config("double", ready_and_hold_argv(FAKE_URL));

    driver.spawn(&config).unwrap();
    let err = driver.spawn(&config).unwrap_err();
    assert!(matches!(err, CoreProcessError::Spawn(ref msg) if msg.contains("already")));
    assert!(driver.is_running());
    driver.kill(KILL_BUDGET).unwrap();
    cleanup(&config);
}

/// §4: строки пайпа попадают в ring с ANSI-стриппингом; ready-строка тоже.
#[test]
fn pipe_lines_land_in_ring_stripped() {
    let mut driver = test_driver();
    #[cfg(unix)]
    let argv = vec![
        "-c".to_owned(),
        format!("printf '\\033[31mboot-line\\033[0m\\nLAVRAY_CORE_READY {FAKE_URL}\\n'; cat > /dev/null"),
    ];
    #[cfg(windows)]
    let argv = vec![
        "/C".to_owned(),
        "echo".to_owned(),
        "boot-line".to_owned(),
        "&".to_owned(),
        "echo".to_owned(),
        "LAVRAY_CORE_READY".to_owned(),
        FAKE_URL.to_owned(),
        "&".to_owned(),
        "ping".to_owned(),
        "-n".to_owned(),
        "60".to_owned(),
        "127.0.0.1".to_owned(),
        ">nul".to_owned(),
    ];
    let config = fake_config("ring", argv);

    driver.spawn(&config).unwrap();
    let endpoint = driver.wait_ready(WAIT_READY).unwrap();
    assert_eq!(endpoint.transport_url, FAKE_URL);

    let tail = driver.log_tail(16);
    let texts: Vec<&str> = tail.iter().map(|l| l.text.as_str()).collect();
    assert!(
        texts.iter().any(|t| t.contains("boot-line")),
        "строки до ready — в ring: {texts:?}"
    );
    assert!(
        texts.iter().any(|t| t.contains("LAVRAY_CORE_READY")),
        "ready-строка — в ring: {texts:?}"
    );
    assert!(
        tail.iter().all(|l| !l.text.contains('\x1b')),
        "VT100-последовательности вырезаны"
    );
    driver.kill(KILL_BUDGET).unwrap();
    cleanup(&config);
}

/// §3.2 сквозная проверка токена (Unix): фейк читает первую строку stdin и
/// возвращает её в ready-строке — драйвер доставил ровно токен + `\n`.
#[cfg(unix)]
#[test]
fn auth_token_is_delivered_via_stdin() {
    let mut driver = test_driver();
    let argv = vec![
        "-c".to_owned(),
        "IFS= read -r tok; printf 'LAVRAY_CORE_READY token=%s\\n' \"$tok\"; cat > /dev/null"
            .to_owned(),
    ];
    let config = fake_config("token", argv);
    let exposed = config.auth_token.expose().to_owned();

    driver.spawn(&config).unwrap();
    let endpoint = driver.wait_ready(WAIT_READY).unwrap();
    assert_eq!(
        endpoint.transport_url,
        format!("token={exposed}"),
        "в stdin ядра пришло ровно значение токена"
    );
    driver.kill(KILL_BUDGET).unwrap();
    cleanup(&config);
}

/// §5 шаг 3 (Unix): ядро, игнорирующее SIGTERM, добивается SIGKILL по pgid.
#[cfg(unix)]
#[test]
fn sigterm_ignoring_core_is_killed_by_sigkill_escalation() {
    let mut driver = RealCoreProcess::with_timeouts(DriverTimeouts {
        eof_grace: Duration::from_millis(100),
        sigterm_wait: Duration::from_millis(400),
        kill_grace: Duration::from_millis(1500),
        poll_interval: Duration::from_millis(15),
    });
    let argv = vec![
        "-c".to_owned(),
        "trap '' TERM; printf 'LAVRAY_CORE_READY up\\n'; while true; do sleep 1; done".to_owned(),
    ];
    let config = fake_config("sigkill", argv);

    driver.spawn(&config).unwrap();
    let endpoint = driver.wait_ready(WAIT_READY).unwrap();
    assert_eq!(endpoint.transport_url, "up");

    let started = std::time::Instant::now();
    driver.kill(KILL_BUDGET).unwrap();
    assert!(
        !driver.is_running(),
        "SIGKILL по pgid добил игнорирующее TERM ядро"
    );
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "эскалация не зависла на SIGTERM-ожидании"
    );
    cleanup(&config);
}
