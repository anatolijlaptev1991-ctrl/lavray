//! Рантайм-драйвер ядра: продакшн-реализация [`CoreProcess`] (§3/§5).
//!
//! - §3 spawn: argv `serve --listen-socket <path>` (порт/сокет выделяет ОС,
//!   fix TOCTOU LNB-20), cwd = каталог данных 0700; auth-токен 32 Б CSPRNG →
//!   base64url → **stdin** + `\n` и stdin ДЕРЖИТСЯ ОТКРЫТЫМ (EOF на stdin =
//!   «смерть оболочки», страховка §3.2/§5; токен никогда в argv/логах).
//!   Windows: `CREATE_NO_WINDOW` + Job Object `KILL_ON_JOB_CLOSE` (сироты
//!   невозможны §1); Unix: своя process-группа (kill по pgid, LNB-09) +
//!   `PR_SET_PDEATHSIG(SIGKILL)` с защитой от гонки fork→prctl.
//! - §3.4 ready: ОДНА строка `LAVRAY_CORE_READY <transport-url>` на stdout;
//!   допроверка `/healthz` с Bearer — вместе с Connect-клиентом (W6).
//! - §4 логи: stdout/stderr читаются построчно в отдельных потоках →
//!   [`LogRing`] (200 строк, ANSI-стриппинг, антифлуд [`FloodGate`]).
//! - §5 kill-лестница: шаги 1–2 (`CoreService.Disconnect` [10 с] →
//!   `CoreService.Shutdown`) требуют ConnectRPC-клиента — врезается на W6
//!   (`src/ipc.rs`, дерево §10); до него драйвер честно стартует с шага 3:
//!   SIGTERM/`TerminateJobObject` по pgid/хэндлу (не по имени, LNB-09) →
//!   ожидание [`T_SIGTERM_WAIT`] → SIGKILL/`TerminateProcess` →
//!   [`T_KILL_GRACE`]. Шаги 4–6 (дети `ext:*`, прокси/DNS-снимок FR-UI-259,
//!   verify §6) — рантайм-слой поверх драйвера.
//!
//! unsafe — только тонкие FFI-вызовы Job Object (windows-sys) и libc
//! (`prctl`/`getppid` в `pre_exec`, `kill` по pgid); у каждого — SAFETY.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::logs::{FloodGate, LogLine, LogRing};
use super::{
    CoreEndpoint, CoreProcess, CoreProcessError, CoreSpawnConfig, SecretToken, AUTH_TOKEN_BYTES,
    T_KILL_GRACE, T_SIGTERM_WAIT,
};

/// Префикс ready-строки ядра (§3.4): `LAVRAY_CORE_READY <transport-url>`.
pub const READY_LINE_PREFIX: &str = "LAVRAY_CORE_READY ";
/// Антифлуд пайпа §4: лимит строк/с по умолчанию (конфигурируемое значение,
/// спеком не зафиксировано).
pub const DEFAULT_MAX_LOG_LINES_PER_SEC: usize = 1000;
/// Grace после обнаружения раннего exit: дать потоку-читателю допрочитать
/// хвост stdout — ядро могло напечатать ready-строку и тут же умереть.
const READY_FLUSH_GRACE: Duration = Duration::from_millis(200);

/// Тайминги kill-лестницы §5 (инжектируются целиком — тесты прогоняют
/// лестницу с короткими значениями, продакшн берёт нормы §2.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DriverTimeouts {
    /// Шаг 3 §5: сколько ждать выхода после SIGTERM/TerminateJobObject.
    pub sigterm_wait: Duration,
    /// Шаг 3 §5: grace после SIGKILL/TerminateProcess(force).
    pub kill_grace: Duration,
    /// Интервал опроса состояния процесса (try_wait).
    pub poll_interval: Duration,
}

impl Default for DriverTimeouts {
    fn default() -> Self {
        Self {
            sigterm_wait: T_SIGTERM_WAIT,
            kill_grace: T_KILL_GRACE,
            poll_interval: Duration::from_millis(20),
        }
    }
}

/// base64url-алфавит без padding (RFC 4648 §5, `-`/`_` вместо `+`/`/`).
const B64URL_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Кодирование в base64url БЕЗ padding (§3.2: 32 байта → 43 символа).
fn base64url_nopad(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = chunk.get(1).map_or(0, |&b| u32::from(b));
        let b2 = chunk.get(2).map_or(0, |&b| u32::from(b));
        let n = (b0 << 16) | (b1 << 8) | b2;
        // Хвостовой чанк короче — символы для недостающих байтов не эмитим.
        let emitted = match chunk.len() {
            1 => 2,
            2 => 3,
            _ => 4,
        };
        for &shift in &[18u32, 12, 6, 0][..emitted] {
            out.push(B64URL_ALPHABET[((n >> shift) & 0x3f) as usize] as char);
        }
    }
    out
}

/// Сгенерировать auth-токен ядра (§3.2): 32 байта CSPRNG (`getrandom` =
/// системный генератор: RtlGenRandom/BCrypt на Windows, getrandom(2)/
/// /dev/urandom на Unix — fix mt19937, LNB-18) → base64url без padding.
pub fn generate_auth_token() -> Result<SecretToken, CoreProcessError> {
    let mut bytes = [0u8; AUTH_TOKEN_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|err| CoreProcessError::Spawn(format!("CSPRNG unavailable: {err}")))?;
    Ok(SecretToken::from_base64url(base64url_nopad(&bytes))
        .expect("32 bytes always encode to 43 base64url chars"))
}

/// Выделить transport-url из ready-строки §3.4 (строка уже без `\n`/`\r`).
fn parse_ready_line(line: &str) -> Option<&str> {
    let url = line.strip_prefix(READY_LINE_PREFIX)?.trim();
    if url.is_empty() {
        None
    } else {
        Some(url)
    }
}

/// Живой процесс ядра + ресурсы его сопровождения.
#[derive(Debug)]
struct RunningProcess {
    /// Сам ребёнок; `child.stdin` удерживается ОТКРЫТЫМ (§3.2) до kill/drop.
    child: Child,
    /// Job Object `KILL_ON_JOB_CLOSE` (Windows, §3.3): дроп хэндла убивает
    /// всё дерево ядра — страховка от сирот при смерти/панике оболочки.
    #[cfg(windows)]
    job: JobGuard,
    /// Канал ready-строки от потока-читателя stdout (§3.4).
    ready_rx: Receiver<String>,
    /// Потоки пайпов §4 (детачатся: живут до EOF пайпа; Arc<LogRing> держит
    /// буфер живым, пока читается хоть один поток).
    _readers: Vec<thread::JoinHandle<()>>,
    /// Первая ошибка сигнальной лестницы (D1): не прерывает стоп, но
    /// возвращается вызывающему, если процесс в итоге умер.
    term_err: Option<CoreProcessError>,
}

/// Продакшн-драйвер [`CoreProcess`]: реальный spawn/ready/kill.
///
/// # Ограничение PDEATHSIG (D3, ревью)
/// PR_SET_PDEATHSIG срабатывает на завершение ПОТОКА, вызвавшего spawn
/// (man prctl(2)), а не всего процесса оболочки. Вызывать `spawn` можно
/// только из долгоживущего потока (главный/main-рантайм); transient-поток
/// (tokio-воркер, threadpool) приведёт к спорадическому SIGKILL ядра у
/// живой оболочки. При переходе рантайма на tokio — spawn через
/// `tokio::task::spawn_blocking` с выделенным долгоживущим пулом или
/// прямой std-поток.
///
/// Один драйвер — не более одного живого процесса (FSM §2 не предполагает
/// двух ядер); повторный `spawn` до смерти/kill предыдущего → ошибка.
/// `Drop` — страховка kill-on-drop: лестница §5 с configured-таймингами,
/// ошибки проглатываются (см. [`RealCoreProcess::shutdown`]).
#[derive(Debug)]
pub struct RealCoreProcess {
    timeouts: DriverTimeouts,
    max_log_lines_per_sec: usize,
    running: Option<RunningProcess>,
    /// Последний exit-статус ядра (диагностика Crashed, LNB-21).
    last_exit: Option<ExitStatus>,
    /// Ring диагностических строк §4 (общий для обоих пайпов).
    ring: Arc<Mutex<LogRing>>,
}

impl Default for RealCoreProcess {
    fn default() -> Self {
        Self::new()
    }
}

impl RealCoreProcess {
    /// Драйвер с таймингами §2.2/§5 и антифлудом по умолчанию.
    pub fn new() -> Self {
        Self {
            timeouts: DriverTimeouts::default(),
            max_log_lines_per_sec: DEFAULT_MAX_LOG_LINES_PER_SEC,
            running: None,
            last_exit: None,
            ring: Arc::new(Mutex::new(LogRing::with_default_capacity())),
        }
    }

    /// Драйвер с переопределёнными таймингами лестницы §5 (тесты).
    pub fn with_timeouts(timeouts: DriverTimeouts) -> Self {
        Self {
            timeouts,
            max_log_lines_per_sec: DEFAULT_MAX_LOG_LINES_PER_SEC,
            running: None,
            last_exit: None,
            ring: Arc::new(Mutex::new(LogRing::with_default_capacity())),
        }
    }

    /// Текущие тайминги лестницы §5.
    pub fn timeouts(&self) -> DriverTimeouts {
        self.timeouts
    }

    /// Жив ли процесс (неблокирующий опрос; фиксирует exit при обнаружении).
    /// Статус «неизвестно» (ошибка try_wait) трактуется как «жив».
    pub fn is_running(&mut self) -> bool {
        let exited = self
            .running
            .as_mut()
            .and_then(|run| run.child.try_wait().ok().flatten());
        match exited {
            Some(status) => {
                self.running = None;
                self.last_exit = Some(status);
                false
            }
            None => self.running.is_some(),
        }
    }

    /// Последний exit-статус ядра (после kill/краха), если наблюдался.
    pub fn exit_status(&self) -> Option<ExitStatus> {
        self.last_exit
    }

    /// Последние `n` диагностических строк пайпа §4 (пост-мортем Crashed).
    pub fn log_tail(&self, n: usize) -> Vec<LogLine> {
        match self.ring.lock() {
            Ok(ring) => ring.tail(n).cloned().collect(),
            Err(poisoned) => poisoned.into_inner().tail(n).cloned().collect(),
        }
    }

    /// Полная сигнальная лестница §5 (шаги 3–3b; RPC-шаги 1–2 — W6).
    ///
    /// Инвариант выхода: `Ok`/`Err(Kill)` — живого процесса в драйвере нет
    /// (последний добивается дропом Job/pgid-SIGKILL перед ошибкой).
    fn shutdown(&mut self, graceful_deadline: Duration) -> Result<(), CoreProcessError> {
        let Some(mut run) = self.running.take() else {
            return Ok(()); // убивать нечего — идемпотентно
        };
        // Шаг 0 (не из §5): EOF на stdin = «смерть оболочки» (§3.2) — ядро
        // обязано завершиться само graceful; это бесплатный мягкий сигнал.
        // NB (D4, ревью): на Unix далее идёт перехватываемый SIGTERM — ядро
        // успевает доработать; на Windows следующий шаг (TerminateJobObject)
        // — немедленный hard-kill: шанса на само-выход по EOF нет, окно
        // само-выключения ядра целиком на RPC-шагах 1–2 (W6).
        run.child.stdin.take();
        if let Ok(Some(status)) = run.child.try_wait() {
            self.last_exit = Some(status);
            return Ok(());
        }

        let deadline = Instant::now() + graceful_deadline;
        let poll = self.timeouts.poll_interval;

        // Шаг 3 §5: SIGTERM (Unix, по pgid — LNB-09) / TerminateJobObject
        // (Windows, всё дерево ядра) ПО ХЭНДЛУ/ГРУППЕ — никогда по имени.
        // D1 (ревью): ошибка шага НЕ прерывает лестницу — иначе `run`
        // дропается с живым ребёнком (EPERM/LSM-сценарий). Проваливаемся
        // в следующий шаг.
        if let Err(e) = run.terminate_tree() {
            run.term_err = Some(e);
        }
        let term_deadline = deadline.min(Instant::now() + self.timeouts.sigterm_wait);
        if let Some(status) = wait_exit_until(&mut run.child, term_deadline, poll) {
            self.last_exit = Some(status);
            return Ok(());
        }

        // Шаг 3 §5: жив ещё T_KILL_GRACE → SIGKILL по pgid /
        // TerminateProcess по хэндлу (force). Последний страховочный шаг —
        // child.kill() напрямую (D1): живого процесса в драйвере не остаётся
        // ни при каком исходе.
        if let Err(e) = run.kill_tree() {
            run.term_err.get_or_insert(e);
        }
        if let Some(status) = wait_exit_until(&mut run.child, deadline, poll) {
            self.last_exit = Some(status);
            if let Some(e) = run.term_err.take() {
                return Err(e);
            }
            Ok(())
        } else {
            let _ = run.child.kill();
            let _ = run.child.wait();
            Err(run.term_err.take().unwrap_or(CoreProcessError::Kill(
                "core survived SIGTERM+SIGKILL/TerminateProcess".to_owned(),
            )))
        }
        // `run` дропается здесь: Windows — CloseHandle(job) добивает хвосты
        // KILL_ON_JOB_CLOSE; Unix — SIGKILL группе уже отправлен.
    }
}

impl CoreProcess for RealCoreProcess {
    /// §3: запуск `lavray-core serve --listen-socket <path>` (или полный
    /// override через [`CoreSpawnConfig::extra_args`]).
    fn spawn(&mut self, config: &CoreSpawnConfig) -> Result<(), CoreProcessError> {
        if self.is_running() {
            return Err(CoreProcessError::Spawn(
                "driver already has a running core".to_owned(),
            ));
        }
        self.running = None;

        // cwd = каталог данных, права 0700 (§3.3).
        let mut dir_builder = std::fs::DirBuilder::new();
        dir_builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            dir_builder.mode(0o700);
        }
        dir_builder.create(&config.data_dir).map_err(|err| {
            CoreProcessError::Spawn(format!("data dir {}: {err}", config.data_dir.display()))
        })?;

        let mut cmd = Command::new(&config.binary);
        let args: Vec<String> = if config.extra_args.is_empty() {
            // §3.1/§3.3: порт/сокет выделяет ОС — оболочка ничего не слушает.
            vec![
                "serve".to_owned(),
                "--listen-socket".to_owned(),
                config.listen_socket.display().to_string(),
            ]
        } else {
            config.extra_args.clone()
        };
        cmd.args(&args)
            .current_dir(&config.data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        platform_configure(&mut cmd)?;
        let mut child = cmd.spawn().map_err(|err| {
            CoreProcessError::Spawn(format!("{}: {err}", config.binary.display()))
        })?;

        // §3.2: токен → stdin + '\n'. stdin НЕ закрываем (EOF = смерть
        // оболочки — страховка для ядра, §3.2/§5).
        if let Some(stdin) = child.stdin.as_mut() {
            let written = stdin
                .write_all(config.auth_token.expose().as_bytes())
                .and_then(|()| stdin.write_all(b"\n"))
                .and_then(|()| stdin.flush());
            if let Err(err) = written {
                abort_child(child);
                return Err(CoreProcessError::Spawn(format!(
                    "auth token -> stdin: {err}"
                )));
            }
        }

        #[cfg(windows)]
        let job = match JobGuard::create_and_assign(&child) {
            Ok(job) => job,
            Err(err) => {
                abort_child(child);
                return Err(err);
            }
        };

        // Пайпы §4: два потока, общий ring; ready-строка §3.4 — из stdout.
        let (ready_tx, ready_rx) = channel::<String>();
        let rate = self.max_log_lines_per_sec;
        let stdout_reader = match spawn_pipe_reader(
            child.stdout.take(),
            Arc::clone(&self.ring),
            rate,
            Some(ready_tx),
            "lavray-core-stdout",
        ) {
            Ok(handle) => handle,
            Err(err) => {
                abort_child(child);
                return Err(CoreProcessError::Spawn(format!(
                    "stdout reader thread: {err}"
                )));
            }
        };
        let stderr_reader = match spawn_pipe_reader(
            child.stderr.take(),
            Arc::clone(&self.ring),
            rate,
            None,
            "lavray-core-stderr",
        ) {
            Ok(handle) => handle,
            Err(err) => {
                abort_child(child);
                return Err(CoreProcessError::Spawn(format!(
                    "stderr reader thread: {err}"
                )));
            }
        };
        self.running = Some(RunningProcess {
            child,
            #[cfg(windows)]
            job,
            ready_rx,
            _readers: vec![stdout_reader, stderr_reader],
            term_err: None,
        });
        Ok(())
    }

    /// §3.4: дождаться `LAVRAY_CORE_READY <transport-url>` в пределах
    /// `budget` (supervisor передаёт [`super::T_SPAWN`]).
    ///
    /// Инвариант: при `Err` живого процесса не остаётся (инвариант SpawnErr
    /// §2.2 «процесс мёртв») — молчащее ядро застреливается лестницей §5.
    fn wait_ready(&mut self, budget: Duration) -> Result<CoreEndpoint, CoreProcessError> {
        let poll = self.timeouts.poll_interval;
        let outcome = match self.running.as_mut() {
            None => return Err(CoreProcessError::NotRunning),
            Some(run) => wait_ready_loop(&run.ready_rx, &mut run.child, budget, poll),
        };
        match outcome {
            WaitOutcome::Ready(url) => Ok(CoreEndpoint { transport_url: url }),
            WaitOutcome::Exited(status) => {
                self.last_exit = Some(status);
                self.running = None;
                Err(CoreProcessError::ReadyTimeout {
                    budget,
                    reason: format!("core exited before ready line: {status}"),
                })
            }
            WaitOutcome::Deadline => {
                let err = CoreProcessError::ReadyTimeout {
                    budget,
                    reason: format!("no `{READY_LINE_PREFIX}<url>` line on stdout within budget"),
                };
                let _ = self.shutdown(self.timeouts.sigterm_wait + self.timeouts.kill_grace);
                Err(err)
            }
            WaitOutcome::Poll(err) => {
                // D5 (ревью): «не могу опросить статус» ≠ «не готов» —
                // классифицируем как Spawn-ошибку опроса.
                let _ = self.shutdown(self.timeouts.sigterm_wait + self.timeouts.kill_grace);
                Err(CoreProcessError::Spawn(format!("waitpid failed: {err}")))
            }
        }
    }

    /// §5: graceful-лестница стопа в пределах `graceful_deadline`
    /// (supervisor передаёт [`super::GRACEFUL_SHUTDOWN_TOTAL`]).
    ///
    /// Шаги 1–2 (`CoreService.Disconnect(collect_stats=true)` [10 с],
    /// `CoreService.Shutdown(REASON_EXIT)`) — ConnectRPC-клиент, врезка W6
    /// (`src/ipc.rs`): ДО него лестница стартует с шага 3.
    fn kill(&mut self, graceful_deadline: Duration) -> Result<(), CoreProcessError> {
        self.shutdown(graceful_deadline)
    }
}

impl Drop for RealCoreProcess {
    /// Страховка kill-on-drop: явный kill мог не прийти (ошибка рантайма).
    /// Полная лестница §5; ошибки игнорируются — Drop не паникует. Нормальный
    /// путь (kill по команде) уже очистил `running` и здесь ничего не делает.
    fn drop(&mut self) {
        let _ = self.shutdown(self.timeouts.sigterm_wait + self.timeouts.kill_grace);
    }
}

/// Исход ожидания ready (внутренний, чтобы обойти заимствования `running`).
enum WaitOutcome {
    Ready(String),
    Exited(ExitStatus),
    Deadline,
    Poll(io::Error),
}

/// Цикл §3.4: канал ready-строки + ранний exit + дедлайн.
fn wait_ready_loop(
    ready_rx: &Receiver<String>,
    child: &mut Child,
    budget: Duration,
    poll: Duration,
) -> WaitOutcome {
    let deadline = Instant::now() + budget;
    loop {
        // Ready-строка первая: она могла прийти раньше, чем заметен exit.
        match ready_rx.try_recv() {
            Ok(url) => return WaitOutcome::Ready(url),
            Err(TryRecvError::Empty) => {}
            // stdout закрыт без ready-строки: ниже поймаем exit либо таймаут.
            Err(TryRecvError::Disconnected) => {}
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                // Гонка «ready напечатан и сразу exit»: даём читателю
                // допрочитать хвост пайпа перед вердиктом.
                let grace = deadline
                    .saturating_duration_since(Instant::now())
                    .min(READY_FLUSH_GRACE);
                if let Ok(url) = ready_rx.recv_timeout(grace) {
                    return WaitOutcome::Ready(url);
                }
                return WaitOutcome::Exited(status);
            }
            Ok(None) => {}
            Err(err) => return WaitOutcome::Poll(err),
        }
        if Instant::now() >= deadline {
            return WaitOutcome::Deadline;
        }
        thread::sleep(poll);
    }
}

/// Ждать выхода до `deadline` (неблокирующе, шагами `poll`); `None` — жив.
fn wait_exit_until(child: &mut Child, deadline: Instant, poll: Duration) -> Option<ExitStatus> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) => {}
            // Статус не читается — шансов дождаться нет (ошибка waitpid).
            Err(_) => return None,
        }
        if Instant::now() >= deadline {
            return None;
        }
        thread::sleep(poll);
    }
}

/// Ликвидация уже созданного процесса на пути ошибки spawn: kill + reap,
/// чтобы неудавшийся spawn не оставлял сироту (§1 — сироты невозможны).
/// `kill()` здесь — разовый сигнал лидеру (Unix SIGKILL / Windows
/// TerminateProcess); при уже завершившемся процессе ошибка игнорируется.
fn abort_child(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Поток пайпа §4: построчное чтение → антифлуд → ring (ANSI-стриппинг —
/// внутри [`LogRing::push`]); ready-строка §3.4 (только stdout) — в канал.
/// Не-UTF-8 байты заменяются (from_utf8_lossy) — бинарный мусор в пайпе не
/// убивает чтение.
fn spawn_pipe_reader<R: Read + Send + 'static>(
    pipe: Option<R>,
    ring: Arc<Mutex<LogRing>>,
    max_per_second: usize,
    mut ready_tx: Option<Sender<String>>,
    thread_name: &'static str,
) -> io::Result<thread::JoinHandle<()>> {
    thread::Builder::new()
        .name(thread_name.to_owned())
        .spawn(move || {
            let Some(pipe) = pipe else { return };
            let mut reader = BufReader::new(pipe);
            let mut gate = FloodGate::new(max_per_second);
            let mut buf = Vec::with_capacity(512);
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) | Err(_) => break, // EOF или разрыв пайпа
                    Ok(_) => {
                        let raw = String::from_utf8_lossy(&buf);
                        let line = raw.trim_end_matches(['\n', '\r']);
                        if line.is_empty() {
                            continue;
                        }
                        // Ready-строка идёт в канал ВСЕГДА — антифлуд её не
                        // касается (иначе шумный лог проглотил бы готовность).
                        let is_ready = parse_ready_line(line).is_some();
                        // D6 (ревью): сначала пуш в ring, потом send — иначе
                        // log_tail может не увидеть ready-строку (гонка).
                        let now_ms = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map_or(0, |d| d.as_millis());
                        if gate.allow(now_ms) || is_ready {
                            match ring.lock() {
                                Ok(mut ring) => {
                                    ring.push(line);
                                }
                                Err(poisoned) => {
                                    poisoned.into_inner().push(line);
                                }
                            }
                        }
                        if is_ready {
                            if let (Some(url), Some(tx)) = (parse_ready_line(line), ready_tx.take())
                            {
                                let _ = tx.send(url.to_owned());
                            }
                        }
                    }
                }
            }
        })
}

// ---------------------------------------------------------------------------
// Платформенный слой: конфигурация запуска + терминация дерева ядра.
// ---------------------------------------------------------------------------

/// Настроить `Command` под платформу (§3.3): Windows — `CREATE_NO_WINDOW`
/// (окна консоли нет); Unix — своя process-группа (`process_group(0)`, std;
/// kill по pgid — LNB-09) + `PR_SET_PDEATHSIG(SIGKILL)` (§1 — сироты
/// невозможны).
#[cfg(unix)]
fn platform_configure(cmd: &mut Command) -> Result<(), CoreProcessError> {
    use std::os::unix::process::CommandExt;

    // Своя группа: ребёнок становится лидером (pgid = pid) — сигнал по -pgid
    // накрывает ядро И его ext-детей, не задевая оболочку.
    cmd.process_group(0);

    // PDEATHSIG: ядро получает SIGKILL при смерти родителя (оболочки).
    // Замыкание исполняется в ребёнке между fork и exec — только
    // async-signal-safe вызовы (prctl/getppid — прямые сисколлы).
    let parent_pid = std::process::id() as libc::pid_t;
    // SAFETY: `pre_exec` небезопасен, потому что замыкание работает в
    // мультипоточном дочернем процессе после fork(2): в нём нельзя трогать
    // блокировки/аллокаторы/std-состояние. Наше замыкание только вызывает
    // сисколлы prctl(2) и getppid(2) и возвращает io::Result — это
    // async-signal-safe (ошибка сериализуется errno → io::Error, без
    // аллокаций: строки — &'static str).
    // Замыкание определено ОТДЕЛЬНО от unsafe-блока вызова pre_exec: его
    // собственные unsafe-блоки не оказываются вложенными (unused_unsafe),
    // а границы unsafe видны на месте каждого сисколла.
    let set_death_signal = move || {
        // SAFETY: prctl(2) — прямой сисколл без аллокаций/блокировок
        // (async-signal-safe после fork); SIGKILL — неперехватываемый
        // сигнал смерти родителя (§3.3).
        if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) } < 0 {
            return Err(io::Error::last_os_error());
        }
        // Гонка «родитель умер ДО установки PDEATHSIG»: сигнал уже не
        // придёт — проверяем родителя и отказываемся от exec (ребёнок
        // завершится по пути ошибки spawn в std).
        // SAFETY: getppid(2) — тривиальный сисколл, safe после fork.
        if unsafe { libc::getppid() } != parent_pid {
            // D2 (ревью): io::Error::other(&str) аллоцирует (String+Box) —
            // маллок после fork в мультипоточном ребёнке. RawOsError —
            // аллокаций нет; errno подбираем по смыслу (EPIPE — «родитель
            // исчез»).
            return Err(io::Error::from_raw_os_error(libc::EPIPE));
        }
        Ok(())
    };
    // SAFETY: `pre_exec` небезопасен, потому что замыкание работает в
    // мультипоточном дочернем процессе между fork(2) и exec: в нём нельзя
    // трогать блокировки/аллокаторы/std-состояние. `set_death_signal`
    // удовлетворяет этому: только prctl(2)/getppid(2) и io::Result
    // (ошибка — errno → io::Error, строки — &'static str, без аллокаций).
    unsafe { cmd.pre_exec(set_death_signal) };
    Ok(())
}

/// Windows-вариант [`platform_configure`]: `CREATE_NO_WINDOW` (§3.3);
/// групповая изоляция — Job Object, назначается после spawn (см.
/// [`JobGuard::create_and_assign`]).
#[cfg(windows)]
fn platform_configure(cmd: &mut Command) -> Result<(), CoreProcessError> {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    cmd.creation_flags(CREATE_NO_WINDOW);
    Ok(())
}

#[cfg(unix)]
impl RunningProcess {
    /// Шаг 3 §5: SIGTERM всей process-группе ядра (pgid = pid лидера,
    /// назначен `process_group(0)` при spawn; LNB-09 — по группе, не по имени).
    fn terminate_tree(&mut self) -> Result<(), CoreProcessError> {
        signal_process_group(&self.child, libc::SIGTERM)
    }

    /// Шаг 3 §5: SIGKILL группе (неперехватываемый, покрывает ext-детей).
    fn kill_tree(&mut self) -> Result<(), CoreProcessError> {
        signal_process_group(&self.child, libc::SIGKILL)
    }
}

/// Послать `sig` process-группе ядра; ESRCH (группа уже мертва) — успех.
#[cfg(unix)]
fn signal_process_group(child: &Child, sig: libc::c_int) -> Result<(), CoreProcessError> {
    let pgid = -(child.id() as libc::pid_t);
    // SAFETY: kill(2) с отрицательным pid — сигнал группе; pid валиден
    // (ребёнок наш, std владеет им и ещё не reapнут), сигналы TERM/KILL
    // не имеют UB-последствий для вызывающего процесса.
    let rc = unsafe { libc::kill(pgid, sig) };
    if rc == 0 {
        return Ok(());
    }
    match io::Error::last_os_error().raw_os_error() {
        Some(libc::ESRCH) => Ok(()), // уже мертвы — цель достигнута
        Some(errno) => Err(CoreProcessError::Kill(format!(
            "kill({pgid}, sig {sig}): os error {errno}"
        ))),
        None => Err(CoreProcessError::Kill(format!(
            "kill({pgid}, sig {sig}): unknown os error"
        ))),
    }
}

#[cfg(windows)]
impl RunningProcess {
    /// Шаг 3 §5: TerminateJobObject — завершает ВСЁ дерево ядра (лидер +
    /// ext-дети, все в job), по хэндлу job — не по имени (LNB-09).
    fn terminate_tree(&mut self) -> Result<(), CoreProcessError> {
        self.job.terminate()
    }

    /// Шаг 3 §5 (force): TerminateProcess по хэндлу лидера — фолбэк, если
    /// завершение job не сработало (ядро могло вырваться из job).
    fn kill_tree(&mut self) -> Result<(), CoreProcessError> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::ERROR_ACCESS_DENIED;
        use windows_sys::Win32::System::Threading::TerminateProcess;

        let handle = self.child.as_raw_handle();
        // SAFETY: хэндл принадлежит `self.child` (std валидирует его
        // время жизни, child ещё не reapнут); TerminateProcess(h, 1) —
        // документированное завершение процесса по хэндлу.
        let ok = unsafe { TerminateProcess(handle, 1) };
        if ok != 0 {
            return Ok(());
        }
        let err = io::Error::last_os_error();
        if err
            .raw_os_error()
            .is_some_and(|code| code as u32 == ERROR_ACCESS_DENIED)
        {
            // Уже мёртв (хэндл более не действует) либо добит job.
            return Ok(());
        }
        Err(CoreProcessError::Kill(format!("TerminateProcess: {err}")))
    }
}

/// Windows Job Object с `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (§3.3).
///
/// Дроп хэндла (смерть оболочки, паника, дроп драйвера) убивает ядро и ВСЕХ
/// его потомков — «сироты невозможны» (§1). Все методы — тонкие unsafe-FFI
/// обёртки с SAFETY-обоснованиемми.
#[cfg(windows)]
#[derive(Debug)]
struct JobGuard {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
impl JobGuard {
    /// Создать job с KILL_ON_JOB_CLOSE и назначить в него `child`.
    fn create_and_assign(child: &Child) -> Result<Self, CoreProcessError> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        // SAFETY: CreateJobObjectW(null, null) — безымянный job без
        // атрибутов безопасности; побочных эффектов кроме создания объекта
        // нет; null-параметры документированы как допустимые.
        let job: HANDLE = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(CoreProcessError::Spawn(format!(
                "CreateJobObjectW: {}",
                io::Error::last_os_error()
            )));
        }
        let guard = Self { handle: job };

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `job` — валидный хэндл (создан выше и не закрыт);
        // `info` — repr(C)-структура корректного для
        // JobObjectExtendedLimitInformation типа и размера.
        let ok = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            return Err(CoreProcessError::Spawn(format!(
                "SetInformationJobObject(KILL_ON_JOB_CLOSE): {}",
                io::Error::last_os_error()
            )));
        }

        // SAFETY: `job` валиден (см. выше); хэндл процесса принадлежит
        // `child` (std валидирует время жизни, процесс ещё не завершён);
        // AssignProcessToJobObject документирован для одного процесса
        // в одном job; потомки ядра наследуют членство автоматически.
        // (Известная гонка «ребёнок успел создать потомка до
        // AssignProcessToJobObject» для launcher-ядер: lavray-core поднимает
        // ext-детей позже, при старте инстанса — окно не задействовано.)
        let ok = unsafe { AssignProcessToJobObject(job, child.as_raw_handle()) };
        if ok == 0 {
            return Err(CoreProcessError::Spawn(format!(
                "AssignProcessToJobObject: {}",
                io::Error::last_os_error()
            )));
        }
        Ok(guard)
    }

    /// Завершить всё дерево ядра (шаг 3 §5, Windows-эквивалент SIGTERM-
    /// группы; graceful-часть до сигнала выполняет RPC W6).
    fn terminate(&self) -> Result<(), CoreProcessError> {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        // SAFETY: хэндл принадлежит self (создан и не закрыт — Drop
        // закрывает ровно один раз); TerminateJobObject(h, 1) завершает
        // все процессы job с кодом 1.
        let ok = unsafe { TerminateJobObject(self.handle, 1) };
        if ok != 0 {
            Ok(())
        } else {
            Err(CoreProcessError::Kill(format!(
                "TerminateJobObject: {}",
                io::Error::last_os_error()
            )))
        }
    }
}

#[cfg(windows)]
impl Drop for JobGuard {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;

        if !self.handle.is_null() {
            // SAFETY: хэндл создан CreateJobObjectW, не закрыт ранее и не
            // null (проверено); CloseHandle ровно здесь — double-close
            // невозможен (Drop вызывается один раз, handle не копируется).
            unsafe { CloseHandle(self.handle) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// base64url без padding: эталонные векторы RFC 4648 (§5, url-алфавит),
    /// сверены с эталонной реализацией (python base64.urlsafe_b64encode).
    #[test]
    fn base64url_known_vectors() {
        assert_eq!(base64url_nopad(b""), "");
        assert_eq!(base64url_nopad(b"h"), "aA"); // 0x68 → 011010 000000 → 26,0
        assert_eq!(base64url_nopad(b"he"), "aGU");
        assert_eq!(base64url_nopad(b"hel"), "aGVs");
        assert_eq!(base64url_nopad(b"hello"), "aGVsbG8");
        // url-алфавит: 62='-' 63='_' (в стандартном base64 было '+','/').
        assert_eq!(base64url_nopad(&[0xfb, 0xff]), "-_8"); // 62,63,111100→60
        assert_eq!(base64url_nopad(&[0xff, 0xff, 0xff]), "____");
        // 32 нулевых байта → ровно 43 'A' (форма §3.2).
        assert_eq!(base64url_nopad(&[0u8; AUTH_TOKEN_BYTES]), "A".repeat(43));
    }

    /// Токен §3.2: 32 байта CSPRNG → 43 символа base64url, вызовы уникальны.
    #[test]
    fn generated_token_has_spec_shape_and_is_unique() {
        let token = generate_auth_token().unwrap();
        assert_eq!(token.expose().len(), super::super::AUTH_TOKEN_B64_LEN);
        assert!(
            token
                .expose()
                .bytes()
                .all(|b| matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_')),
            "алфавит base64url"
        );
        let other = generate_auth_token().unwrap();
        assert_ne!(
            token.expose(),
            other.expose(),
            "CSPRNG, а не фиксированное значение"
        );
    }

    /// Парсер ready-строки §3.4: префикс + непустой url.
    #[test]
    fn parse_ready_line_accepts_only_prefixed_nonempty_url() {
        assert_eq!(
            parse_ready_line("LAVRAY_CORE_READY unix:///run/lavray/ctrl.sock"),
            Some("unix:///run/lavray/ctrl.sock")
        );
        assert_eq!(
            parse_ready_line("LAVRAY_CORE_READY 127.0.0.1:41276 "),
            Some("127.0.0.1:41276")
        );
        assert_eq!(parse_ready_line("LAVRAY_CORE_READY "), None, "пустой url");
        assert_eq!(
            parse_ready_line("grpc server listening"),
            None,
            "чужой формат"
        );
        assert_eq!(parse_ready_line(""), None);
    }

    /// Тайминги лестницы §5 по умолчанию — нормы §2.2.
    #[test]
    fn driver_timeouts_default_to_spec_values() {
        let t = DriverTimeouts::default();
        assert_eq!(t.sigterm_wait, T_SIGTERM_WAIT);
        assert_eq!(t.kill_grace, T_KILL_GRACE);
    }

    /// Драйвер без процесса: kill идемпотентен, wait_ready — NotRunning.
    #[test]
    fn idle_driver_kill_idempotent_wait_ready_not_running() {
        let mut driver = RealCoreProcess::new();
        assert!(!driver.is_running());
        assert_eq!(driver.kill(Duration::from_secs(1)), Ok(()));
        assert_eq!(
            driver.wait_ready(Duration::from_secs(1)),
            Err(CoreProcessError::NotRunning)
        );
    }
}
