// SPDX-License-Identifier: GPL-3.0-only

//! Настоящее открытие установщика под блокировкой (T-75): запрет записи на
//! Windows, отказ идти по ссылкам и проверка по дескриптору, что файл лежит
//! прямо в ожидаемом каталоге. Логика проверки хэша — в `verify.rs`.

use super::verify::{LockedFile, LockedOpener};
use std::io;
use std::path::{Path, PathBuf};

/// Настоящее открытие. Файл открывается так, чтобы между проверкой пути и
/// открытием его нельзя было подменить ссылкой: на Windows — с запретом записи
/// и удаления (`FILE_SHARE_READ`), без перехода по точкам повторной обработки
/// (`FILE_FLAG_OPEN_REPARSE_POINT`) и с проверкой по дескриптору, что файл
/// физически лежит прямо в заданном каталоге (`GetFinalPathNameByHandleW`).
/// Остальные ОС не умеют обязательных блокировок, там обычное чтение.
pub struct RealOpener {
    root: Option<PathBuf>,
}

impl RealOpener {
    /// Без привязки к каталогу (копия exe для watchdog и т. п.).
    pub fn any() -> Self {
        Self { root: None }
    }

    /// Файл обязан лежать прямо в `dir` (staging или previous).
    pub fn within(dir: &Path) -> Self {
        Self {
            root: Some(dir.to_path_buf()),
        }
    }
}

impl LockedOpener for RealOpener {
    fn open_locked(&self, path: &Path) -> io::Result<Box<dyn LockedFile>> {
        let file = open_shared_read(path)?;
        if let Some(root) = &self.root {
            let real = final_path(&file)?;
            let root = std::fs::canonicalize(root)?;
            if !directly_in(&real, &root) {
                return Err(io::Error::other("файл лежит не в ожидаемом каталоге"));
            }
        }
        Ok(Box::new(file))
    }
}

/// Приставка «расширенного» пути Windows, которую `canonicalize` и
/// `GetFinalPathNameByHandleW` добавляют по-разному.
fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text).to_string())
}

/// `real` — прямой потомок `root` (без учёта регистра на Windows, где пути такие).
pub fn directly_in(real: &Path, root: &Path) -> bool {
    let (real, root) = (strip_verbatim(real), strip_verbatim(root));
    real.parent().is_some_and(|parent| {
        let (a, b) = (parent.to_string_lossy(), root.to_string_lossy());
        if cfg!(windows) {
            a.eq_ignore_ascii_case(&b)
        } else {
            a == b
        }
    })
}

#[cfg(windows)]
fn open_shared_read(path: &Path) -> io::Result<std::fs::File> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    /// `FILE_SHARE_READ`: другим можно читать, писать и удалять — нельзя.
    const FILE_SHARE_READ: u32 = 0x1;
    /// Не переходить по символьной ссылке или junction: открывается сама ссылка.
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    if super::paths::is_reparse_attr(file.metadata()?.file_attributes()) {
        return Err(io::Error::other("установщик — ссылка, а не файл"));
    }
    Ok(file)
}

#[cfg(not(windows))]
fn open_shared_read(path: &Path) -> io::Result<std::fs::File> {
    std::fs::File::open(path)
}

/// Настоящий путь открытого файла по дескриптору (не по имени).
#[cfg(windows)]
fn final_path(file: &std::fs::File) -> io::Result<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFinalPathNameByHandleW, FILE_NAME_NORMALIZED, VOLUME_NAME_DOS,
    };
    let mut buf = vec![0u16; 1024];
    loop {
        // SAFETY: дескриптор жив (его держит `file`), буфер и его длина согласованы.
        let n = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buf.as_mut_ptr(),
                buf.len() as u32,
                FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
            )
        };
        if n == 0 {
            return Err(io::Error::last_os_error());
        }
        if (n as usize) < buf.len() {
            buf.truncate(n as usize);
            return Ok(PathBuf::from(OsString::from_wide(&buf)));
        }
        buf.resize(n as usize + 1, 0);
    }
}

#[cfg(not(windows))]
fn final_path(file: &std::fs::File) -> io::Result<PathBuf> {
    use std::os::fd::AsRawFd;
    std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))
}
