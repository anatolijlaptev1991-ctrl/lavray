// SPDX-License-Identifier: GPL-3.0-only

//! Доступ к TUN на Linux без перезапуска GUI от root. Ядру `lavray-core` нужен
//! `CAP_NET_ADMIN`; его выдаёт `setcap` на файл ядра (`pkexec setcap …`), и
//! права действуют на каждый запуск ядра, а оболочка остаётся обычной.
//!
//! Решение [`decide`] — чистая функция от собранных [`Facts`] (тесты идут и на
//! Windows); сбор фактов у системы — в `probe` (только Linux), команды Tauri —
//! в [`commands`].

pub mod caps;
pub mod commands;
pub mod mounts;
#[cfg(target_os = "linux")]
mod probe;
#[cfg(test)]
mod tests;

use crate::exec::Output;
use mounts::MountFlags;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Права, которые выдаются ядру.
pub const GRANT_CAPS: &str = "cap_net_admin+ep";

/// Метаданные файла или каталога на пути к ядру.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileMeta {
    pub is_file: bool,
    pub is_dir: bool,
    pub uid: u32,
    /// Права доступа (`st_mode`).
    pub mode: u32,
}

impl FileMeta {
    /// Владелец root, группе и остальным запись закрыта.
    #[must_use]
    pub fn root_only_writable(&self) -> bool {
        self.uid == 0 && self.mode & 0o022 == 0
    }
}

/// Что известно о файле ядра.
#[derive(Debug, Clone)]
pub struct CoreFacts {
    /// Канонический путь (без симлинков).
    pub path: PathBuf,
    /// Сам файл, затем его каталог и все каталоги выше — до корня.
    pub chain: Vec<FileMeta>,
    pub flags: MountFlags,
    /// У файла есть permitted + effective `CAP_NET_ADMIN`.
    pub file_caps: bool,
    /// Работающий процесс ядра запущен без `CAP_NET_ADMIN` в `CapEff`.
    pub running_lacks_caps: bool,
}

/// Все факты, от которых зависит решение.
#[derive(Debug, Clone, Default)]
pub struct Facts {
    pub euid_root: bool,
    /// У процесса оболочки `CAP_NET_ADMIN` в ambient-наборе (наследуется ядром).
    pub ambient_net_admin: bool,
    /// Задана переменная `APPIMAGE`.
    pub appimage: bool,
    pub core: Option<CoreFacts>,
    pub pkexec: Option<PathBuf>,
    pub setcap: Option<PathBuf>,
}

/// Вывод [`decide`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// TUN можно поднимать.
    Ready,
    /// Права выдаст кнопка в приложении (`pkexec setcap`).
    Grantable,
    /// Автоматически нельзя: пользователь выполняет команду сам.
    Manual(&'static str),
    /// Права выдать нельзя (AppImage, `nosuid`, только чтение).
    Unavailable(&'static str),
}

impl CoreFacts {
    /// Файл — обычный, а он и все каталоги над ним принадлежат root и закрыты
    /// на запись группе и остальным: подменить файл между проверкой и `setcap`
    /// обычному пользователю нечем.
    #[must_use]
    pub fn tamper_proof(&self) -> bool {
        let file_ok = self.chain.first().is_some_and(|m| m.is_file);
        let dirs_ok = self.chain.len() > 1 && self.chain[1..].iter().all(|m| m.is_dir);
        file_ok && dirs_ok && self.chain.iter().all(FileMeta::root_only_writable)
    }
}

/// Состояние доступа к TUN. Порядок: готово → недоступно → можно выдать → вручную.
#[must_use]
pub fn decide(facts: &Facts) -> Access {
    let core = facts.core.as_ref();
    let caps_work = core.is_some_and(|c| c.file_caps && !c.flags.nosuid);
    if facts.euid_root || facts.ambient_net_admin || caps_work {
        return Access::Ready;
    }
    if facts.appimage {
        return Access::Unavailable("appimage");
    }
    if let Some(core) = core {
        if core.flags.nosuid {
            return Access::Unavailable("nosuid");
        }
        if core.flags.read_only {
            return Access::Unavailable("read_only");
        }
    }
    let Some(core) = core else {
        return Access::Manual("core_not_found");
    };
    if !core.tamper_proof() {
        return Access::Manual("not_secure");
    }
    match (&facts.pkexec, &facts.setcap) {
        (Some(_), Some(_)) => Access::Grantable,
        (None, _) => Access::Manual("no_pkexec"),
        (_, None) => Access::Manual("no_setcap"),
    }
}

/// Права у файла есть, а ядро, уже работающее, получило их не при запуске:
/// нужен перезапуск ядра.
#[must_use]
pub fn needs_core_restart(facts: &Facts) -> bool {
    !facts.euid_root
        && facts
            .core
            .as_ref()
            .is_some_and(|c| c.file_caps && c.running_lacks_caps)
}

/// Команда для терминала (одинарные кавычки в пути экранируются).
#[must_use]
pub fn manual_command(core: &Path) -> String {
    let quoted = core.to_string_lossy().replace('\'', "'\\''");
    format!("sudo setcap {GRANT_CAPS} '{quoted}'")
}

/// Что запускать для выдачи прав: `pkexec <setcap> <права> <ядро>`.
#[must_use]
pub fn grant_argv(facts: &Facts) -> Option<(PathBuf, Vec<OsString>)> {
    let (pkexec, setcap, core) = (facts.pkexec.clone()?, facts.setcap.clone()?, &facts.core);
    let args = vec![
        setcap.into_os_string(),
        OsString::from(GRANT_CAPS),
        core.as_ref()?.path.clone().into_os_string(),
    ];
    Some((pkexec, args))
}

/// Итог запуска `pkexec` для интерфейса: `cancelled` (код 126 — окно пароля
/// закрыто) или `failed: <текст>`.
pub fn grant_result(out: &Output) -> Result<(), String> {
    match out.code {
        Some(0) => Ok(()),
        Some(126) => Err("cancelled".into()),
        code => {
            let text = out.stderr.trim();
            let detail = match (text.is_empty(), code) {
                (false, _) => text.to_string(),
                (true, Some(code)) => format!("pkexec: код {code}"),
                (true, None) => "pkexec завершён сигналом".to_string(),
            };
            Err(format!("failed: {detail}"))
        }
    }
}

/// Выдать права ядру, только если состояние [`Access::Grantable`]. `run`
/// запускает программу (в продакшене — с большим таймаутом: человек вводит пароль).
pub fn grant_with(
    facts: &Facts,
    run: impl FnOnce(&Path, &[OsString]) -> Result<Output, String>,
) -> Result<(), String> {
    if decide(facts) != Access::Grantable {
        return Err("not_grantable".into());
    }
    let (program, args) = grant_argv(facts).ok_or("not_grantable")?;
    let out = run(&program, &args).map_err(|e| format!("failed: {e}"))?;
    grant_result(&out)
}
