// SPDX-License-Identifier: GPL-3.0-only

//! Системная часть перехвата: обработчики сигналов, канал и поток-читатель.
//! Тонкая: решения принимает [`Dispatcher`](super::Dispatcher).

use super::Dispatcher;
use crate::killswitch::{self, Exit};
use std::io;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;

/// Сигналы, которые завершают сеанс или процесс «по-хорошему».
const QUIT_SIGNALS: [libc::c_int; 3] = [libc::SIGTERM, libc::SIGINT, libc::SIGHUP];

/// Код выхода при срочном завершении.
const EXIT_FORCED: libc::c_int = 1;

/// Записывающий конец канала; -1 — перехват не запущен.
static WRITE_FD: AtomicI32 = AtomicI32::new(-1);

/// Адрес `errno` текущего потока (получение адреса безопасно).
fn errno_location() -> *mut libc::c_int {
    // SAFETY: функция libc без аргументов возвращает адрес errno вызывающего потока.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    unsafe {
        libc::__errno_location()
    }
    // SAFETY: то же для macOS и BSD.
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    unsafe {
        libc::__error()
    }
}

/// Обработчик: только async-signal-safe действия. Номер сигнала уходит байтом в
/// канал; `errno` прерванного кода сохраняется и возвращается.
extern "C" fn on_signal(sig: libc::c_int) {
    let fd = WRITE_FD.load(Ordering::Relaxed);
    if fd < 0 {
        return;
    }
    let byte = u8::try_from(sig).unwrap_or(0);
    // SAFETY: errno_location даёт errno текущего потока; write(2) —
    // async-signal-safe, буфер — локальная переменная; канал неблокирующий,
    // переполненный канал просто теряет байт (сигналов уже накоплено достаточно).
    unsafe {
        let saved = *errno_location();
        let _ = libc::write(fd, std::ptr::from_ref(&byte).cast(), 1);
        *errno_location() = saved;
    }
}

fn set_handler(sig: libc::c_int, handler: libc::sighandler_t) -> io::Result<()> {
    // SAFETY: sigaction — обычная структура C, обнуление допустимо; sigemptyset
    // пишет в её поле; обработчик — extern "C" fn либо SIG_DFL.
    let rc = unsafe {
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = handler;
        action.sa_flags = libc::SA_RESTART; // блокирующие вызовы других потоков не обрываем
        libc::sigemptyset(std::ptr::addr_of_mut!(action.sa_mask));
        libc::sigaction(sig, std::ptr::from_ref(&action), std::ptr::null_mut())
    };
    if rc == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// Вернуть сигналам умолчание (процесс снова умирает от них, как раньше).
fn reset_handlers() {
    for sig in QUIT_SIGNALS {
        let _ = set_handler(sig, libc::SIG_DFL);
    }
}

fn close_pair(fds: [libc::c_int; 2]) {
    WRITE_FD.store(-1, Ordering::SeqCst);
    for fd in fds {
        // SAFETY: закрываются только дескрипторы, открытые этим модулем.
        unsafe { libc::close(fd) };
    }
}

/// Канал «обработчик → поток»: оба конца не наследуются при `exec`, записывающий
/// неблокирующий (обработчик не должен ждать).
fn make_pipe() -> io::Result<[libc::c_int; 2]> {
    let mut fds = [-1; 2];
    // SAFETY: pipe пишет два дескриптора в массив из двух элементов; fcntl
    // получает только что открытые дескрипторы.
    unsafe {
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            return Err(io::Error::last_os_error());
        }
        let flags = libc::fcntl(fds[1], libc::F_GETFL);
        let ok = flags >= 0
            && libc::fcntl(fds[1], libc::F_SETFL, flags | libc::O_NONBLOCK) == 0
            && libc::fcntl(fds[0], libc::F_SETFD, libc::FD_CLOEXEC) == 0
            && libc::fcntl(fds[1], libc::F_SETFD, libc::FD_CLOEXEC) == 0;
        if !ok {
            let e = io::Error::last_os_error();
            close_pair(fds);
            return Err(e);
        }
    }
    Ok(fds)
}

/// Поставить обработчики и завести поток-читатель; звать до создания остальных
/// потоков процесса. Сигнал, пришедший до запуска читателя, ждёт в канале.
pub fn start(dispatcher: &Arc<Dispatcher>) -> io::Result<()> {
    if WRITE_FD.load(Ordering::SeqCst) >= 0 {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    let fds = make_pipe()?;
    WRITE_FD.store(fds[1], Ordering::SeqCst);
    let handler = on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t;
    if let Err(e) = QUIT_SIGNALS
        .iter()
        .try_for_each(|&sig| set_handler(sig, handler))
    {
        reset_handlers();
        close_pair(fds);
        return Err(e);
    }
    let dispatcher = Arc::clone(dispatcher);
    let spawned = std::thread::Builder::new()
        .name("lavray-signals".into())
        .spawn(move || read_loop(&dispatcher, fds[0]));
    if let Err(e) = spawned {
        reset_handlers();
        close_pair(fds);
        return Err(e);
    }
    Ok(())
}

/// Каждый байт канала — один сигнал.
fn read_loop(dispatcher: &Arc<Dispatcher>, read_fd: libc::c_int) {
    let mut buf = [0u8; 16];
    loop {
        // SAFETY: буфер валиден на длину buf.len(), дескриптор открыт и не закрывается.
        let n = unsafe { libc::read(read_fd, buf.as_mut_ptr().cast(), buf.len()) };
        if n > 0 {
            for _ in 0..n {
                dispatcher.on_signal();
            }
            continue;
        }
        let err = io::Error::last_os_error();
        if n < 0 && err.kind() == io::ErrorKind::Interrupted {
            continue;
        }
        // читать больше нечем: пусть сигналы действуют, как до перехвата
        eprintln!("LAVRay: канал сигналов закрыт: {err}");
        reset_handlers();
        return;
    }
}

/// Срочный выход: вернуть прокси по снимку (если приложение уже могло его
/// включить) и завершиться без деструкторов — вызывается из чужого потока,
/// пока остальные работают. Ядро гаснет по EOF stdin/PDEATHSIG.
pub fn release_and_exit(up: bool) {
    if up {
        let _ = killswitch::apply_exit(&crate::datadir::data_dir(), Exit::Quit, false);
    }
    // SAFETY: _exit(2) завершает процесс немедленно и не возвращается.
    unsafe { libc::_exit(EXIT_FORCED) }
}
