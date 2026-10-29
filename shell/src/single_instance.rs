// SPDX-License-Identifier: GPL-3.0-only

//! Проверка single-instance между разными уровнями прав (T-81, ревью).
//!
//! Плагин `tauri-plugin-single-instance` берёт именованный мьютекс
//! `<identifier>-sim` (`CreateMutexW`) и передаёт аргументы окну первого
//! экземпляра. Мьютекс, созданный ПОВЫШЕННЫМ процессом, обычный процесс открыть
//! не может: `CreateMutexW` отвечает `ERROR_ACCESS_DENIED`, и плагин считает
//! себя первым. Результат — второе ядро на тех же данных, второй значок трея и
//! откат системного прокси первого экземпляра. Поэтому до плагина мьютекс
//! проверяется отдельно: «доступ запрещён» значит, что уже запущен экземпляр с
//! более высокими правами.

/// Суффикс имени мьютекса в плагине версии 2.5 без фичи `semver` (с ней к
/// имени добавляется версия; тест охраны проверяет, что фича не включена).
pub const MUTEX_SUFFIX: &str = "-sim";

/// Имя мьютекса плагина для идентификатора приложения.
pub fn mutex_name(identifier: &str) -> String {
    format!("{identifier}{MUTEX_SUFFIX}")
}

/// Что показала попытка открыть мьютекс.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    /// Мьютекса нет: первый экземпляр.
    Missing,
    /// Мьютекс открылся: экземпляр того же или более низкого уровня прав,
    /// плагин сам передаст ему аргументы.
    Opened,
    /// `ERROR_ACCESS_DENIED`: мьютекс принадлежит экземпляру с более высокими
    /// правами.
    AccessDenied,
    /// Другая ошибка: не мешаем запуску, решает плагин.
    Other,
}

/// Открытие мьютекса по имени; в тестах — подставка.
pub trait MutexProbe {
    fn probe(&self, name: &str) -> Probe;
}

/// Вердикт для запуска.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Продолжать запуск (плагин сам разберётся с первым/вторым).
    Proceed,
    /// Уже запущен экземпляр от администратора: показать сообщение и выйти.
    ElevatedInstanceRunning,
}

/// Решить, можно ли запускаться.
pub fn check(probe: &impl MutexProbe, identifier: &str) -> Verdict {
    match probe.probe(&mutex_name(identifier)) {
        Probe::AccessDenied => Verdict::ElevatedInstanceRunning,
        Probe::Missing | Probe::Opened | Probe::Other => Verdict::Proceed,
    }
}

/// Системная проверка: `OpenMutexW(SYNCHRONIZE)`.
pub struct System;

impl MutexProbe for System {
    #[cfg(windows)]
    fn probe(&self, name: &str) -> Probe {
        use windows_sys::Win32::Foundation::{
            CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND,
        };
        use windows_sys::Win32::System::Threading::OpenMutexW;

        /// Право ждать на мьютексе: достаточно для проверки существования.
        const SYNCHRONIZE: u32 = 0x0010_0000;
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        // SAFETY: имя нуль-терминировано и живёт до конца вызова.
        let handle = unsafe { OpenMutexW(SYNCHRONIZE, 0, wide.as_ptr()) };
        if !handle.is_null() {
            // SAFETY: хэндл открыт выше и закрывается ровно один раз.
            unsafe { CloseHandle(handle) };
            return Probe::Opened;
        }
        // SAFETY: читает код последней ошибки потока.
        match unsafe { GetLastError() } {
            ERROR_ACCESS_DENIED => Probe::AccessDenied,
            ERROR_FILE_NOT_FOUND => Probe::Missing,
            _ => Probe::Other,
        }
    }

    #[cfg(not(windows))]
    fn probe(&self, _name: &str) -> Probe {
        Probe::Missing
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Fake {
        answer: Probe,
        asked: RefCell<Vec<String>>,
    }

    impl MutexProbe for Fake {
        fn probe(&self, name: &str) -> Probe {
            self.asked.borrow_mut().push(name.to_string());
            self.answer
        }
    }

    fn verdict_for(answer: Probe) -> (Verdict, Vec<String>) {
        let fake = Fake {
            answer,
            asked: RefCell::new(Vec::new()),
        };
        let verdict = check(&fake, "io.example.app");
        (verdict, fake.asked.into_inner())
    }

    #[test]
    fn mutex_name_is_what_the_plugin_creates() {
        assert_eq!(mutex_name("io.example.app"), "io.example.app-sim");
    }

    #[test]
    fn access_denied_means_an_elevated_instance_is_running() {
        let (verdict, asked) = verdict_for(Probe::AccessDenied);
        assert_eq!(verdict, Verdict::ElevatedInstanceRunning);
        assert_eq!(asked, ["io.example.app-sim"]);
    }

    #[test]
    fn every_other_answer_lets_the_plugin_decide() {
        for answer in [Probe::Missing, Probe::Opened, Probe::Other] {
            assert_eq!(verdict_for(answer).0, Verdict::Proceed, "{answer:?}");
        }
    }

    #[test]
    fn plugin_name_scheme_is_pinned_in_the_manifest() {
        // с фичей `semver` плагин добавляет к имени версию, и проверка стала бы слепой
        let manifest =
            std::fs::read_to_string(format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR")))
                .expect("Cargo.toml");
        let line = manifest
            .lines()
            .find(|l| l.starts_with("tauri-plugin-single-instance"))
            .expect("зависимость плагина");
        assert!(
            !line.contains("semver") && !line.contains("features"),
            "{line}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn the_system_probe_sees_a_missing_mutex() {
        // уникальное имя, которого нет в системе; сам мьютекс не создаётся
        let name = format!("lavray-test-no-such-mutex-{}", std::process::id());
        assert_eq!(System.probe(&name), Probe::Missing);
    }
}
