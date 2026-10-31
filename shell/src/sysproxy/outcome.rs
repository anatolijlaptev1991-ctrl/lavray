// SPDX-License-Identifier: GPL-3.0-only

//! Итоги операций с системным прокси.

/// Итог применения.
#[derive(Debug, Clone)]
pub struct Applied {
    /// Точка выхода прокси, которую увидит система.
    pub host: String,
    pub port: u16,
    /// Что не удалось применить, не сорвав включения (T-82): подключения RAS,
    /// WPAD. Пусто — прокси стоит везде.
    pub warnings: Vec<String>,
}

/// Предупреждения откатов, которых никто не ждёт (выход, падение ядра, старт),
/// идут в журнал оболочки (stderr).
pub(super) fn log_warnings(warnings: &[String]) {
    for warning in warnings {
        eprintln!("LAVRay: системный прокси: {warning}");
    }
}
