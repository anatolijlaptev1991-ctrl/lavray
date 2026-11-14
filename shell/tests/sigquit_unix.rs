// SPDX-License-Identifier: GPL-3.0-only

//! Настоящие сигналы в отдельном процессе (только unix; на Windows `main` пуст).
//!
//! Свой `main` вместо libtest (`harness = false` в `Cargo.toml`). Тест запускает
//! собственный бинарник с `LAVRAY_SIGQUIT_CHILD=<режим>`: ребёнок ставит
//! перехват, печатает `READY` и ждёт. Родитель шлёт сигнал и читает, что сделал
//! ребёнок: вызвал обработчик штатного выхода (`QUIT`), срочный выход (`FORCE`)
//! или умер от сигнала, не выполнив выход.
//!
//! Почему без libtest: ребёнок-тест libtest с `--test-threads=1` печатает
//! `test child_entry ... ` без перевода строки, и первая строка ребёнка была
//! `test child_entry ... HANDLERS:true`. Родитель искал строку, начинающуюся с
//! `HANDLERS:`, пропускал её и ждал 20 с впустую. Свой `main` печатает только
//! строки сценария.

#[cfg(unix)]
mod signals {
    use lavray_shell::sigquit::{start, Dispatcher};
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, Command, ExitStatus, Stdio};
    use std::sync::mpsc::{channel, Receiver};
    use std::sync::Arc;
    use std::time::Duration;

    const ENV: &str = "LAVRAY_SIGQUIT_CHILD";
    const WAIT: Duration = Duration::from_secs(20);

    /// Строка в stdout сразу, без буфера: родитель ждёт её построчно.
    fn say(line: &str) {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }

    /// Все три сигнала сейчас обрабатываются нашим обработчиком, а не умолчанием.
    fn handlers_installed() -> bool {
        [libc::SIGTERM, libc::SIGINT, libc::SIGHUP]
            .iter()
            .all(|&sig| {
                // SAFETY: запрос текущего действия (новое не задаётся); структура — обычная C.
                let action = unsafe {
                    let mut old: libc::sigaction = std::mem::zeroed();
                    libc::sigaction(sig, std::ptr::null(), std::ptr::from_mut(&mut old));
                    old
                };
                action.sa_sigaction != libc::SIG_DFL && action.sa_sigaction != libc::SIG_IGN
            })
    }

    /// Тело ребёнка. `graceful`: обработчик выхода печатает `QUIT` и завершает
    /// процесс. `hang`: обработчик не возвращается, срочный выход печатает
    /// `FORCE:<up>` и завершает процесс. `late`: обработчик выхода ставится
    /// спустя 1,5 с после `READY` (сигнал приходит раньше и не должен потеряться).
    fn child(mode: &str) -> ! {
        let dispatcher = Arc::new(Dispatcher::with_budget(Duration::from_secs(100), |up| {
            say(&format!("FORCE:{up}"));
            std::process::exit(3);
        }));
        start(&dispatcher).expect("start");
        say(&format!("HANDLERS:{}", handlers_installed()));
        say("READY");
        if mode == "hang" {
            dispatcher.install(Arc::new(|| std::thread::sleep(Duration::from_secs(100))));
        } else {
            if mode == "late" {
                std::thread::sleep(Duration::from_millis(1500));
            }
            dispatcher.install(Arc::new(|| {
                say("QUIT");
                std::process::exit(0);
            }));
        }
        std::thread::sleep(Duration::from_secs(30));
        say("TIMEOUT");
        std::process::exit(9);
    }

    struct Probe {
        child: Child,
        lines: Receiver<String>,
    }

    impl Probe {
        fn spawn(mode: &str) -> Self {
            let exe = std::env::current_exe().expect("current_exe");
            let mut child = Command::new(exe)
                .env(ENV, mode)
                .stdout(Stdio::piped())
                .spawn()
                .expect("spawn");
            let out = child.stdout.take().expect("stdout");
            let (tx, lines) = channel();
            std::thread::spawn(move || {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    let _ = tx.send(line);
                }
            });
            let mut probe = Self { child, lines };
            assert_eq!(probe.line_with("HANDLERS:"), "HANDLERS:true");
            probe.line_with("READY");
            probe
        }

        /// Первая строка, начинающаяся с `prefix`.
        fn line_with(&mut self, prefix: &str) -> String {
            loop {
                let line = self.lines.recv_timeout(WAIT).expect("ребёнок молчит");
                if line.starts_with(prefix) {
                    return line;
                }
            }
        }

        fn signal(&self, sig: libc::c_int) {
            let pid = libc::pid_t::try_from(self.child.id()).expect("pid");
            // SAFETY: pid — наш живой ребёнок, сигнал безопасен для вызывающего.
            assert_eq!(unsafe { libc::kill(pid, sig) }, 0);
        }

        fn finish(&mut self) -> ExitStatus {
            self.child.wait().expect("wait")
        }
    }

    impl Drop for Probe {
        /// Упавший сценарий не оставляет ребёнка жить ещё 30 с.
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    fn each_termination_signal_runs_the_graceful_quit() {
        for sig in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
            let mut probe = Probe::spawn("graceful");
            probe.signal(sig);
            assert_eq!(probe.line_with("QUIT"), "QUIT", "сигнал {sig}");
            let status = probe.finish();
            assert_eq!(
                status.code(),
                Some(0),
                "процесс не должен умирать от сигнала {sig}"
            );
        }
    }

    fn signal_before_the_quit_handler_is_installed_is_not_lost() {
        let mut probe = Probe::spawn("late");
        probe.signal(libc::SIGTERM);
        assert_eq!(probe.line_with("QUIT"), "QUIT");
        assert_eq!(probe.finish().code(), Some(0));
    }

    fn second_signal_forces_the_exit_when_the_quit_hangs() {
        let mut probe = Probe::spawn("hang");
        probe.signal(libc::SIGTERM);
        std::thread::sleep(Duration::from_millis(300));
        probe.signal(libc::SIGTERM);
        assert_eq!(probe.line_with("FORCE:"), "FORCE:true");
        assert_eq!(probe.finish().code(), Some(3));
    }

    const CASES: [(&str, fn()); 3] = [
        (
            "each_termination_signal_runs_the_graceful_quit",
            each_termination_signal_runs_the_graceful_quit,
        ),
        (
            "signal_before_the_quit_handler_is_installed_is_not_lost",
            signal_before_the_quit_handler_is_installed_is_not_lost,
        ),
        (
            "second_signal_forces_the_exit_when_the_quit_hangs",
            second_signal_forces_the_exit_when_the_quit_hangs,
        ),
    ];

    /// Ребёнок — сразу в своё тело; иначе сценарии параллельно, по потоку на
    /// каждый (у каждого свой процесс-ребёнок). Упавший печатает панику в stderr.
    pub fn run() {
        if let Ok(mode) = std::env::var(ENV) {
            child(&mode);
        }
        let running: Vec<_> = CASES
            .iter()
            .map(|&(name, case)| {
                let handle = std::thread::Builder::new()
                    .name(name.into())
                    .spawn(case)
                    .expect("thread");
                (name, handle)
            })
            .collect();
        let mut failed = 0;
        for (name, handle) in running {
            if handle.join().is_ok() {
                println!("test {name} ... ok");
            } else {
                println!("test {name} ... FAILED");
                failed += 1;
            }
        }
        println!("sigquit_unix: {} ok, {failed} failed", CASES.len() - failed);
        if failed > 0 {
            std::process::exit(101);
        }
    }
}

fn main() {
    #[cfg(unix)]
    signals::run();
}
