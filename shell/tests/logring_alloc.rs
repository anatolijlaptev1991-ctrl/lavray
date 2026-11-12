// SPDX-License-Identifier: GPL-3.0-only

//! Горячий путь логов ядра: 0 alloc/realloc у `LogRing` в устоявшемся режиме.
//!
//! Отдельный бинарник теста: свой `#[global_allocator]` считает вызовы только
//! на потоке, который «взвёл» счётчик (флаг в thread-local), поэтому
//! параллельные потоки libtest результат не искажают. Тест в бинарнике один.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use lavray_shell::coreproc::logs::{strip_ansi_into, LogRing, RING_CAPACITY};

static ALLOCS: AtomicUsize = AtomicUsize::new(0);
static REALLOCS: AtomicUsize = AtomicUsize::new(0);

thread_local! {
    static ARMED: Cell<bool> = const { Cell::new(false) };
}

fn armed() -> bool {
    ARMED.try_with(Cell::get).unwrap_or(false)
}

struct Counting;

// SAFETY: все вызовы делегируются `System` без изменений; счётчики — атомики,
// флаг — thread-local `Cell<bool>` без аллокаций и деструктора.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if armed() {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
        }
        System.alloc(layout)
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        if armed() {
            ALLOCS.fetch_add(1, Ordering::Relaxed);
        }
        System.alloc_zeroed(layout)
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if armed() {
            REALLOCS.fetch_add(1, Ordering::Relaxed);
        }
        System.realloc(ptr, layout, new_size)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

const MAX_LEN: usize = 256;

/// Считает (alloc, realloc) внутри `body`.
fn counted(body: impl FnOnce()) -> (usize, usize) {
    ALLOCS.store(0, Ordering::SeqCst);
    REALLOCS.store(0, Ordering::SeqCst);
    ARMED.with(|a| a.set(true));
    body();
    ARMED.with(|a| a.set(false));
    (
        ALLOCS.load(Ordering::SeqCst),
        REALLOCS.load(Ordering::SeqCst),
    )
}

/// Строки разной длины (≤ `MAX_LEN` после очистки): обычные, с ANSI, Unicode.
fn corpus() -> Vec<String> {
    (0..64)
        .map(|i| {
            let body = "x".repeat(1 + (i * 7) % MAX_LEN.min(200));
            match i % 4 {
                0 => body,
                1 => format!("\x1b[3{}m{body}\x1b[0m", i % 8),
                2 => format!("юникод {body}"),
                _ => format!("\x1b]0;title\x07{body}"),
            }
        })
        .collect()
}

fn push_line(ring: &Mutex<LogRing>, work: &mut String, line: &str) {
    work.clear();
    strip_ansi_into(line, work);
    ring.lock().unwrap().push_reusing(work);
}

#[test]
fn ring_hot_path_is_allocation_free_in_steady_state() {
    let ring = Mutex::new(LogRing::with_default_capacity());
    let mut work = String::new();
    let lines = corpus();

    // Прогрев: каждый из RING_CAPACITY + 1 буферов (слоты и рабочий) должен
    // хоть раз принять строку максимальной длины — ёмкость растёт один раз.
    let longest = "w".repeat(MAX_LEN);
    for _ in 0..(3 * (RING_CAPACITY + 1)) {
        push_line(&ring, &mut work, &longest);
    }

    let (allocs, reallocs) = counted(|| {
        for i in 0..20_000 {
            push_line(&ring, &mut work, &lines[i % lines.len()]);
        }
    });
    assert_eq!((allocs, reallocs), (0, 0), "горячий путь не аллоцирует");
    assert_eq!(ring.lock().unwrap().len(), RING_CAPACITY);

    // Контроль: прежний путь (`push` — новая String на строку) считается.
    let (control, _) = counted(|| {
        for i in 0..1_000 {
            ring.lock().unwrap().push(&lines[i % lines.len()]);
        }
    });
    assert!(control >= 1_000, "счётчик работает: {control}");
}
