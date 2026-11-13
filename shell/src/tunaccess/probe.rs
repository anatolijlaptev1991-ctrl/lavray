// SPDX-License-Identifier: GPL-3.0-only

//! Linux: сбор фактов для [`super::decide`] — тонкий слой над `/proc`, `stat` и
//! `getxattr`. Вся логика разбора — в `caps` и `mounts` (проверяются на любой ОС).

use super::caps::{has_bit, parse_file_caps, status_caps, FileCaps, CAP_NET_ADMIN};
use super::mounts::mount_flags;
use super::{CoreFacts, Facts, FileMeta};
use crate::integrity::{core_search_paths, find_trusted_core, CORE_SHA256};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Каталоги, где ищутся `pkexec` и `setcap`: фиксированные, не через `PATH`
/// (его подменяет пользователь, а запускаются они с правами администратора).
const TOOL_DIRS: [&str; 4] = ["/usr/bin", "/usr/sbin", "/bin", "/sbin"];

/// Найденный и проверенный по SHA-256 путь к ядру: хэш считается один раз.
static CORE_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

fn meta_of(path: &Path) -> FileMeta {
    match std::fs::metadata(path) {
        Ok(m) => FileMeta {
            is_file: m.is_file(),
            is_dir: m.is_dir(),
            uid: m.uid(),
            mode: m.mode(),
        },
        // Не прочитать — доверять нечему: чужой владелец и открытая запись.
        Err(_) => FileMeta {
            is_file: false,
            is_dir: false,
            uid: u32::MAX,
            mode: 0o777,
        },
    }
}

fn find_tool(name: &str) -> Option<PathBuf> {
    TOOL_DIRS
        .iter()
        .map(|dir| Path::new(dir).join(name))
        .find(|p| std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.mode() & 0o111 != 0))
}

/// Канонический путь к доверенному ядру — тем же способом, что при запуске
/// (`integrity`). `fresh` — перепроверить хэш, а не брать запомненный путь.
pub fn locate_core(fresh: bool) -> Option<PathBuf> {
    let mut cached = CORE_PATH
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !fresh {
        if let Some(path) = cached.clone() {
            return Some(path);
        }
    }
    let found = core_search_paths()
        .and_then(|paths| find_trusted_core(&paths, CORE_SHA256))
        .ok()
        .and_then(|path| std::fs::canonicalize(path).ok());
    cached.clone_from(&found);
    found
}

fn file_caps(path: &Path) -> Option<FileCaps> {
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut buf = [0u8; 64];
    // SAFETY: `c_path` и имя атрибута — нуль-терминированные C-строки, живущие
    // до конца вызова; `buf` — записываемый буфер указанной длины.
    let len = unsafe {
        libc::getxattr(
            c_path.as_ptr(),
            c"security.capability".as_ptr(),
            buf.as_mut_ptr().cast(),
            buf.len(),
        )
    };
    parse_file_caps(buf.get(..usize::try_from(len).ok()?)?)
}

/// Есть ли работающий процесс ядра (`/proc/<pid>/exe` — этот файл) без
/// `CAP_NET_ADMIN` в `CapEff`. Чужие процессы, чей `exe` не прочитать, пропускаются.
fn core_process_lacks_caps(core: &Path) -> bool {
    let Ok(dir) = std::fs::read_dir("/proc") else {
        return false;
    };
    dir.flatten()
        .filter(|e| e.file_name().as_bytes().iter().all(u8::is_ascii_digit))
        .filter(|e| std::fs::read_link(e.path().join("exe")).is_ok_and(|exe| exe == core))
        .any(|e| {
            let status = std::fs::read_to_string(e.path().join("status")).unwrap_or_default();
            status_caps(&status, "CapEff").is_some_and(|mask| !has_bit(mask, CAP_NET_ADMIN))
        })
}

fn core_facts(path: PathBuf) -> CoreFacts {
    let mountinfo = std::fs::read_to_string("/proc/self/mountinfo").unwrap_or_default();
    let granted = file_caps(&path).is_some_and(|caps| caps.grants_net_admin());
    CoreFacts {
        chain: path.ancestors().map(meta_of).collect(),
        flags: path
            .to_str()
            .and_then(|text| mount_flags(&mountinfo, text))
            .unwrap_or_default(),
        file_caps: granted,
        running_lacks_caps: granted && core_process_lacks_caps(&path),
        path,
    }
}

/// Собрать факты. `fresh` — заново проверить хэш ядра (перед выдачей прав).
pub fn gather(fresh: bool) -> Facts {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    Facts {
        euid_root: crate::elevation::is_elevated(),
        ambient_net_admin: status_caps(&status, "CapAmb")
            .is_some_and(|mask| has_bit(mask, CAP_NET_ADMIN)),
        appimage: std::env::var_os("APPIMAGE").is_some_and(|v| !v.is_empty()),
        core: locate_core(fresh).map(core_facts),
        pkexec: find_tool("pkexec"),
        setcap: find_tool("setcap"),
    }
}
