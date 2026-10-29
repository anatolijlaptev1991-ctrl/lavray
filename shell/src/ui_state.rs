// SPDX-License-Identifier: GPL-3.0-only

//! Общее хранилище настроек UI (T-81, ревью): `ui-state.json` в каталоге данных
//! приложения (`%APPDATA%\LAVRay`), один для обычного и повышенного экземпляров
//! одного пользователя.
//!
//! У повышенного экземпляра отдельный профиль WebView (см. `profile`), поэтому
//! `localStorage` у двух экземпляров разный. Язык, тема, режимы, выбор сервера и
//! признак пройденного онбординга должны быть одинаковыми, поэтому источник
//! истины — этот файл, а `localStorage` — кэш: UI до первого рендера применяет
//! значения из файла и пишет в него каждое изменение отслеживаемых ключей.
//!
//! Файл лежит в каталоге пользователя, доверять ему как коду нельзя: принимаются
//! только ключи из явного списка [`ALLOWED_KEYS`] (без токенов и секретов),
//! значения-строки ограниченного размера; испорченный или слишком большой файл
//! игнорируется (и перезаписывается при следующем изменении).
//!
//! Запись атомарна: временный файл в том же каталоге, `fsync`, затем
//! переименование поверх прежнего. Читатель видит либо старую, либо новую версию.
//! Если файл создаёт повышенный процесс, он явно выдаёт текущему пользователю
//! (SID из токена) полный доступ: владельцем становится группа администраторов,
//! и обычный экземпляр того же пользователя должен суметь файл перезаписать.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Имя файла в каталоге данных приложения.
pub const FILE_NAME: &str = "ui-state.json";
/// Ключи `localStorage`, которые общие для двух профилей WebView. Список
/// повторяет `ui/src/lib/uiState.ts` (сверяется тестом).
pub const ALLOWED_KEYS: [&str; 6] = [
    "lavray.lang",
    "lavray.theme",
    "lavray.accent",
    "lavray.modes",
    "lavray.server",
    "lavray.onboarded",
];
/// Наибольший размер значения, байт.
pub const MAX_VALUE_BYTES: usize = 16 * 1024;
/// Файл больше этого размера не читается.
pub const MAX_FILE_BYTES: u64 = 128 * 1024;

/// Записи: ключ → значение.
pub type Entries = BTreeMap<String, String>;

/// Прочитанный файл.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize)]
pub struct Loaded {
    /// Корректный файл был. `false` — файла нет или он испорчен: UI заполнит его
    /// из своего `localStorage`.
    pub exists: bool,
    pub entries: Entries,
}

/// Записи по явному списку и лимиту размера; лишнее отбрасывается молча.
pub fn sanitize(entries: Entries) -> Entries {
    entries
        .into_iter()
        .filter(|(key, value)| key_allowed(key) && value.len() <= MAX_VALUE_BYTES)
        .collect()
}

fn key_allowed(key: &str) -> bool {
    ALLOWED_KEYS.contains(&key)
}

/// Прочитать файл. Нет файла, не JSON-объект, слишком большой: `exists = false`.
/// В объекте остаются только допустимые строковые записи.
pub fn load(dir: &Path) -> Loaded {
    let path = dir.join(FILE_NAME);
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_file() && meta.len() <= MAX_FILE_BYTES => {}
        _ => return Loaded::default(),
    }
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Loaded::default();
    };
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(&text)
    else {
        return Loaded::default();
    };
    let entries = map
        .into_iter()
        .filter_map(|(key, value)| match value {
            serde_json::Value::String(text) => Some((key, text)),
            _ => None,
        })
        .collect();
    Loaded {
        exists: true,
        entries: sanitize(entries),
    }
}

/// Записи делаются из нескольких потоков: чтение-изменение-запись под замком,
/// иначе два быстрых изменения потеряли бы друг друга.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Установить (`Some`) или удалить (`None`) значение ключа. `owner_sid` — SID
/// пользователя, если пишет повышенный процесс: файл создаётся с явным полным
/// доступом для него.
pub fn set(
    dir: &Path,
    key: &str,
    value: Option<String>,
    owner_sid: Option<&str>,
) -> Result<(), String> {
    if !key_allowed(key) {
        return Err(format!("ключ {key} не входит в список настроек UI"));
    }
    if value.as_ref().is_some_and(|v| v.len() > MAX_VALUE_BYTES) {
        return Err(format!("значение {key} больше {MAX_VALUE_BYTES} байт"));
    }
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // испорченный файл заменяется: чтение вернуло пустой список
    let mut entries = load(dir).entries;
    match value {
        Some(value) => entries.insert(key.to_string(), value),
        None => entries.remove(key),
    };
    let text = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    write_atomic(dir, FILE_NAME, text.as_bytes(), owner_sid)
}

/// Временный файл рядом с целевым: случайное имя, создаётся эксклюзивно.
fn temp_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let mut random = [0u8; 6];
    getrandom::fill(&mut random).map_err(|e| format!("случайное имя файла: {e}"))?;
    let suffix: String = random.iter().map(|b| format!("{b:02x}")).collect();
    Ok(dir.join(format!("{name}.{suffix}.tmp")))
}

fn create_new(path: &Path, owner_sid: Option<&str>) -> std::io::Result<File> {
    #[cfg(windows)]
    if let Some(sid) = owner_sid {
        return acl::create_new_for_user(path, sid);
    }
    #[cfg(not(windows))]
    let _ = owner_sid;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
}

/// Атомарная запись: временный файл в том же каталоге, `fsync`, переименование.
fn write_atomic(
    dir: &Path,
    name: &str,
    bytes: &[u8],
    owner_sid: Option<&str>,
) -> Result<(), String> {
    write_atomic_with(dir, name, bytes, |tmp| create_new(tmp, owner_sid))
}

/// То же с собственным способом создания временного файла: `create` создаёт
/// новый файл по пути (права, дескриптор безопасности). Файл `agent-endpoint.json`
/// задаёт так защищённый дескриптор (`agent`).
pub(crate) fn write_atomic_with(
    dir: &Path,
    name: &str,
    bytes: &[u8],
    create: impl FnOnce(&Path) -> std::io::Result<File>,
) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let tmp = temp_path(dir, name)?;
    let target = dir.join(name);
    let result = (|| -> std::io::Result<()> {
        let mut file = create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file); // закрыть до переименования
        std::fs::rename(&tmp, &target)
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{}: {e}", target.display()));
    }
    Ok(())
}

#[cfg(windows)]
mod acl {
    use std::fs::File;
    use std::path::Path;

    /// SDDL файла: полный доступ пользователю, администраторам и SYSTEM.
    /// Унаследованные от каталога записи добавляются к явным.
    pub fn sddl(sid: &str) -> String {
        format!("D:(A;;FA;;;{sid})(A;;FA;;;BA)(A;;FA;;;SY)")
    }

    /// Создать новый файл (`CREATE_NEW`) с явной защитой из [`sddl`].
    pub fn create_new_for_user(path: &Path, sid: &str) -> std::io::Result<File> {
        crate::private_file::create_new_with_sddl(path, &sddl(sid))
    }
}

#[cfg(test)]
mod tests;
