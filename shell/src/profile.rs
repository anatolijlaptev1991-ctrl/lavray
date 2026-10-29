// SPDX-License-Identifier: GPL-3.0-only

//! Профиль окна у повышенного экземпляра (T-81, ревью).
//!
//! WebView2 не любит общий каталог данных у процессов с разной целостностью
//! (обычный и повышенный экземпляры по очереди открывают один профиль, а
//! процессы WebView2 старого ещё закрываются): окно может не создаться. Поэтому
//! повышенный экземпляр получает собственный каталог данных WebView, а то, что
//! UI хранит в `localStorage` (язык, тема, выбранный сервер, режимы, флаг
//! первого запуска), старый экземпляр перед перезапуском передаёт новому через
//! небольшой файл в каталоге данных приложения.
//!
//! Файл читает только экземпляр, запущенный с `--elevated-relaunch`, один раз и
//! не позднее [`MAX_AGE`] после записи. Принимаются лишь ключи `lavray.*` с
//! ограниченным числом и размером значений: файл лежит в каталоге пользователя,
//! доверять ему как коду нельзя.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Имя файла передачи в каталоге данных приложения.
pub const FILE_NAME: &str = "ui-handoff.json";
/// Принимаются только ключи с этим префиксом.
pub const KEY_PREFIX: &str = "lavray.";
/// Наибольшая длина ключа.
pub const MAX_KEY_LEN: usize = 64;
/// Наибольший размер значения, байт.
pub const MAX_VALUE_BYTES: usize = 16 * 1024;
/// Наибольшее число записей.
pub const MAX_ENTRIES: usize = 32;
/// Дольше этого файл считается устаревшим и не читается.
pub const MAX_AGE: Duration = Duration::from_secs(120);

/// Записи `localStorage`: ключ → значение.
pub type Entries = BTreeMap<String, String>;

/// Каталог данных WebView для повышенного экземпляра: рядом с обычным
/// (`<local>/<identifier>/EBWebView`), но отдельный. Обычному экземпляру
/// (`None`) оставлен каталог по умолчанию.
pub fn webview_data_dir(local_data: &Path, identifier: &str, elevated: bool) -> Option<PathBuf> {
    elevated.then(|| local_data.join(identifier).join("EBWebView-admin"))
}

fn key_allowed(key: &str) -> bool {
    key.len() <= MAX_KEY_LEN
        && key.len() > KEY_PREFIX.len()
        && key.starts_with(KEY_PREFIX)
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// Оставить только допустимые записи; лишнее отбрасывается молча.
pub fn sanitize(entries: Entries) -> Entries {
    entries
        .into_iter()
        .filter(|(key, value)| key_allowed(key) && value.len() <= MAX_VALUE_BYTES)
        .take(MAX_ENTRIES)
        .collect()
}

/// Записать записи для следующего экземпляра.
pub fn save(dir: &Path, entries: Entries) -> Result<(), String> {
    let text = serde_json::to_string(&sanitize(entries)).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join(FILE_NAME);
    std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Забрать записи: файл читается один раз и удаляется всегда, устаревший или
/// испорченный даёт пустой результат.
pub fn take(dir: &Path, now: SystemTime) -> Entries {
    let path = dir.join(FILE_NAME);
    let Ok(modified) = std::fs::metadata(&path).and_then(|meta| meta.modified()) else {
        return Entries::new();
    };
    let text = std::fs::read_to_string(&path);
    let _ = std::fs::remove_file(&path);
    // `Err` у duration_since — файл «из будущего»: тоже недоверие
    let fresh = now.duration_since(modified).is_ok_and(|age| age <= MAX_AGE);
    if !fresh {
        return Entries::new();
    }
    text.ok()
        .and_then(|text| serde_json::from_str::<Entries>(&text).ok())
        .map(sanitize)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let mut random = [0u8; 6];
        getrandom::fill(&mut random).unwrap();
        let name = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let dir = std::env::temp_dir().join(format!("lavray-handoff-{tag}-{name}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entries(pairs: &[(&str, &str)]) -> Entries {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn only_an_elevated_instance_gets_its_own_webview_directory() {
        let local = Path::new(r"C:\Users\u\AppData\Local");
        assert_eq!(webview_data_dir(local, "io.example.app", false), None);
        assert_eq!(
            webview_data_dir(local, "io.example.app", true),
            Some(PathBuf::from(
                r"C:\Users\u\AppData\Local\io.example.app\EBWebView-admin"
            ))
        );
    }

    #[test]
    fn saved_entries_come_back_once() {
        let dir = temp_dir("roundtrip");
        let sent = entries(&[
            ("lavray.lang", "ru"),
            ("lavray.modes", r#"{"sysProxy":false,"tunMode":true}"#),
            ("lavray.onboarded", "1"),
        ]);
        save(&dir, sent.clone()).unwrap();
        assert_eq!(take(&dir, SystemTime::now()), sent);
        assert!(!dir.join(FILE_NAME).exists(), "файл прочитан один раз");
        assert!(take(&dir, SystemTime::now()).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn foreign_keys_and_oversized_values_are_dropped() {
        let big = "x".repeat(MAX_VALUE_BYTES + 1);
        let clean = sanitize(entries(&[
            ("lavray.lang", "en"),
            ("lavray.big", &big),
            ("other.key", "1"),
            ("lavray.", "1"),
            ("lavray.bad key", "1"),
            ("lavray.путь", "1"),
            ("lavray.theme", "dark"),
        ]));
        assert_eq!(
            clean,
            entries(&[("lavray.lang", "en"), ("lavray.theme", "dark")])
        );

        let many: Entries = (0..MAX_ENTRIES + 10)
            .map(|i| (format!("lavray.k{i:03}"), "v".to_string()))
            .collect();
        assert_eq!(sanitize(many).len(), MAX_ENTRIES);
    }

    #[test]
    fn a_hostile_file_is_filtered_on_read() {
        let dir = temp_dir("hostile");
        std::fs::write(
            dir.join(FILE_NAME),
            r#"{"lavray.lang":"de","__proto__":"x","lavray.a b":"y","token":"secret"}"#,
        )
        .unwrap();
        assert_eq!(
            take(&dir, SystemTime::now()),
            entries(&[("lavray.lang", "de")])
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_stale_or_broken_file_is_ignored_and_removed() {
        let dir = temp_dir("stale");
        save(&dir, entries(&[("lavray.lang", "ru")])).unwrap();
        let later = SystemTime::now() + MAX_AGE + Duration::from_secs(5);
        assert!(take(&dir, later).is_empty(), "старше MAX_AGE");
        assert!(!dir.join(FILE_NAME).exists());

        save(&dir, entries(&[("lavray.lang", "ru")])).unwrap();
        let earlier = SystemTime::now() - Duration::from_secs(60 * 60);
        assert!(take(&dir, earlier).is_empty(), "дата файла из будущего");

        std::fs::write(dir.join(FILE_NAME), "не json").unwrap();
        assert!(take(&dir, SystemTime::now()).is_empty());
        assert!(!dir.join(FILE_NAME).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn no_file_means_no_entries() {
        let dir = temp_dir("none");
        assert!(take(&dir, SystemTime::now()).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
