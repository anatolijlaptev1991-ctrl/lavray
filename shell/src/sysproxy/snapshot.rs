// SPDX-License-Identifier: GPL-3.0-only

//! Снимок настроек прокси и файл, в котором он хранится до отката.

use std::path::Path;

/// Снимок предыдущих настроек прокси.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ProxySnapshot {
    /// Версия формата (для будущих миграций).
    pub version: u32,
    /// ОС, где сделан снимок (`windows`/`linux`/`macos`).
    pub os: String,
    /// Параметры, которые надо восстановить (ОС-специфично).
    pub data: serde_json::Value,
}

/// Содержимое файла снимка: настройки «до нас» и «после нас».
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct StoredSnapshot {
    pub(super) original: ProxySnapshot,
    /// Что стояло сразу после включения. `None` — файл прошлой версии или
    /// включение не дошло до конца: откат безусловный.
    #[serde(default)]
    pub(super) applied: Option<ProxySnapshot>,
}

impl StoredSnapshot {
    /// Прочитать файл снимка. Понимает и прошлый формат: голый
    /// [`ProxySnapshot`] без `applied`.
    pub(super) fn load(path: &Path) -> Option<Self> {
        let raw = std::fs::read_to_string(path).ok()?;
        serde_json::from_str::<Self>(&raw).ok().or_else(|| {
            let original = serde_json::from_str::<ProxySnapshot>(&raw).ok()?;
            Some(Self {
                original,
                applied: None,
            })
        })
    }

    /// Записать файл снимка через временный файл: оборванная запись не
    /// оставит полуснимок.
    pub(super) fn save(&self, path: &Path) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, raw)
            .and_then(|()| std::fs::rename(&tmp, path))
            .map_err(|e| format!("snapshot: {e}"))
    }
}
