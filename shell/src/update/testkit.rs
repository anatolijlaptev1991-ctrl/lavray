// SPDX-License-Identifier: GPL-3.0-only

//! Общие подставки для тестов модуля `update`: временный каталог, журнал
//! событий и файловая система в памяти. Настоящий UAC, процессы и реестр тесты
//! не трогают; файлы создаются только во временной папке.

use super::paths::FsProbe;
use super::verify::{LockedFile, LockedOpener};
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::io::{self, Cursor, Read};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicU32, Ordering};

/// Каталог во временной папке; удаляется при выходе из области видимости.
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new(tag: &str) -> Self {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("lavray-update-{tag}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Общий журнал событий: подставки пишут в него в порядке вызова.
#[derive(Clone, Default)]
pub struct Log(Rc<RefCell<Vec<String>>>);

impl Log {
    pub fn push(&self, event: &str) {
        self.0.borrow_mut().push(event.to_string());
    }

    pub fn events(&self) -> Vec<String> {
        self.0.borrow().clone()
    }

    /// Позиция первого события `event`.
    pub fn pos(&self, event: &str) -> Option<usize> {
        self.0.borrow().iter().position(|e| e == event)
    }

    pub fn count(&self, event: &str) -> usize {
        self.0.borrow().iter().filter(|e| *e == event).count()
    }
}

/// Файловая система в памяти: путь → его «настоящий» путь и набор ссылок.
#[derive(Default)]
pub struct MemFs {
    pub real: RefCell<HashMap<PathBuf, PathBuf>>,
    pub links: RefCell<HashSet<PathBuf>>,
}

impl MemFs {
    /// Каталог и файл в нём, оба «настоящие».
    pub fn with_file(dir: &Path, name: &str) -> Self {
        let fs = Self::default();
        fs.add(dir, dir);
        fs.add(&dir.join(name), &dir.join(name));
        fs
    }

    pub fn add(&self, path: &Path, real: &Path) {
        self.real
            .borrow_mut()
            .insert(path.to_path_buf(), real.to_path_buf());
    }

    pub fn mark_link(&self, path: &Path) {
        self.links.borrow_mut().insert(path.to_path_buf());
    }
}

impl FsProbe for MemFs {
    fn canonicalize(&self, path: &Path) -> io::Result<PathBuf> {
        self.real
            .borrow()
            .get(path)
            .cloned()
            .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
    }

    fn is_link(&self, path: &Path) -> io::Result<bool> {
        Ok(self.links.borrow().contains(path))
    }
}

/// Имя установщика в staging для суммы из одной цифры (64 символа).
pub fn staged_name(digit: char, file: &str) -> String {
    format!("{}-{file}", digit.to_string().repeat(64))
}

/// Читатель, который падает на первом чтении.
pub struct Broken;

impl Read for Broken {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("диск отвалился"))
    }
}

/// Дескриптор в памяти; пишет в журнал, когда его отпускают.
struct Tracked {
    inner: Cursor<Vec<u8>>,
    log: Option<Log>,
}

impl Read for Tracked {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buf)
    }
}

impl Drop for Tracked {
    fn drop(&mut self) {
        if let Some(log) = &self.log {
            log.push("handle.drop");
        }
    }
}

/// Открытие файлов из памяти; считает открытия, чтобы доказать «один дескриптор».
#[derive(Default)]
pub struct MemOpener {
    pub files: RefCell<HashMap<PathBuf, Vec<u8>>>,
    pub opens: Cell<u32>,
    pub unreadable: bool,
    pub log: Option<Log>,
}

impl MemOpener {
    pub fn with(path: &Path, bytes: &[u8]) -> Self {
        let opener = Self::default();
        opener.put(path, bytes);
        opener
    }

    pub fn put(&self, path: &Path, bytes: &[u8]) {
        self.files
            .borrow_mut()
            .insert(path.to_path_buf(), bytes.to_vec());
    }
}

impl LockedOpener for MemOpener {
    fn open_locked(&self, path: &Path) -> io::Result<Box<dyn LockedFile>> {
        self.opens.set(self.opens.get() + 1);
        if let Some(log) = &self.log {
            log.push("verify_open");
        }
        if self.unreadable {
            return Ok(Box::new(Broken));
        }
        let bytes = self.files.borrow().get(path).cloned();
        let bytes = bytes.ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
        Ok(Box::new(Tracked {
            inner: Cursor::new(bytes),
            log: self.log.clone(),
        }))
    }
}
