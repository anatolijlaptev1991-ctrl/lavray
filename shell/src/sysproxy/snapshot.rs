// SPDX-License-Identifier: GPL-3.0-only

//! Снимок настроек прокси и файл, в котором он хранится до отката.

use crate::files::bounded::read_bounded;
use std::io::Write;
use std::path::Path;

/// Сколько записей телефонной книги RAS считаем законными: на деле их единицы,
/// тысяча — заведомый запас.
const MAX_RAS_ENTRIES: u64 = 1024;
/// Запись снимка одной записи RAS, байт: имя (≤ 256 UTF-16 единиц, до 3 байт
/// каждая — 768) плюс сервер и список исключений (по ~4 КиБ), адрес PAC
/// (~2 КиБ), ключи JSON и отступы `to_string_pretty` — округлено до 12 КиБ.
const MAX_RAS_ENTRY_BYTES: u64 = 12 * 1024;
/// Записи RAS лежат и в `original`, и в `applied`; ещё LAN-часть и поля.
const SNAPSHOT_COPIES: u64 = 2;
const SNAPSHOT_OVERHEAD: u64 = 64 * 1024;
/// Наибольший законный файл снимка (~24 МиБ; настоящий — сотни байт). Больше
/// — файл испорчен или подменён, и читать его целиком нельзя.
pub(super) const MAX_SNAPSHOT_BYTES: u64 =
    MAX_RAS_ENTRIES * MAX_RAS_ENTRY_BYTES * SNAPSHOT_COPIES + SNAPSHOT_OVERHEAD;

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
        let raw = String::from_utf8(read_bounded(path, MAX_SNAPSHOT_BYTES).ok()?).ok()?;
        serde_json::from_str::<Self>(&raw).ok().or_else(|| {
            let original = serde_json::from_str::<ProxySnapshot>(&raw).ok()?;
            Some(Self {
                original,
                applied: None,
            })
        })
    }

    /// Записать файл снимка через временный файл: запись, `sync_all`, закрытие
    /// и только потом `rename` — оборванная запись не оставит полуснимок, а
    /// сбой питания после `rename` не подсунет пустой файл.
    pub(super) fn save(&self, path: &Path) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        let written = write_synced(&tmp, raw.as_bytes()).and_then(|()| std::fs::rename(&tmp, path));
        if written.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        written.map_err(|e| format!("snapshot: {e}"))
    }
}

/// Создать файл, записать, сбросить на диск; дескриптор закрывается на выходе.
fn write_synced(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::File::create(path)?;
    file.write_all(data)?;
    file.sync_all()
}
