// SPDX-License-Identifier: GPL-3.0-only

//! Тесты общего хранилища настроек UI: запись и чтение, явный список ключей,
//! отказ от мусора, атомарность записи, права файла от повышенного процесса.

use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn temp_dir(tag: &str) -> PathBuf {
    let mut random = [0u8; 6];
    getrandom::fill(&mut random).unwrap();
    let name: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let dir = std::env::temp_dir().join(format!("lavray-uistate-{tag}-{name}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn files(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn text(v: &str) -> Option<String> {
    Some(v.to_string())
}

#[test]
fn values_written_by_one_instance_are_read_by_the_next() {
    let dir = temp_dir("roundtrip");
    assert_eq!(load(&dir), Loaded::default(), "файла ещё нет");

    set(&dir, "lavray.lang", text("de"), None).unwrap();
    set(
        &dir,
        "lavray.modes",
        text(r#"{"sysProxy":false,"tunMode":true}"#),
        None,
    )
    .unwrap();
    set(&dir, "lavray.onboarded", text("1"), None).unwrap();

    // «другой экземпляр» читает тот же каталог данных
    let loaded = load(&dir);
    assert!(loaded.exists);
    assert_eq!(loaded.entries.len(), 3);
    assert_eq!(loaded.entries["lavray.lang"], "de");
    assert_eq!(loaded.entries["lavray.onboarded"], "1");

    // изменение одного ключа не трогает остальные; None удаляет
    set(&dir, "lavray.lang", text("ru"), None).unwrap();
    set(&dir, "lavray.onboarded", None, None).unwrap();
    let after = load(&dir).entries;
    assert_eq!(after["lavray.lang"], "ru");
    assert!(!after.contains_key("lavray.onboarded"));
    assert!(after.contains_key("lavray.modes"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn only_the_explicit_key_list_is_stored() {
    let dir = temp_dir("keys");
    for bad in [
        "lavray.subErrors", // кэш ошибок подписок, не настройка
        "lavray.token",     // секреты в общий файл не попадают
        "token",
        "lavray.",
        "__proto__",
        "lavray.lang\u{0}x",
    ] {
        assert!(set(&dir, bad, text("x"), None).is_err(), "{bad:?}");
    }
    assert!(!dir.join(FILE_NAME).exists(), "отказ ничего не создал");

    let big = "x".repeat(MAX_VALUE_BYTES + 1);
    assert!(set(&dir, "lavray.lang", Some(big), None).is_err());
    let max = "y".repeat(MAX_VALUE_BYTES);
    set(&dir, "lavray.server", Some(max.clone()), None).unwrap();
    assert_eq!(load(&dir).entries["lavray.server"], max);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_hostile_file_is_filtered_on_read() {
    let dir = temp_dir("hostile");
    let big = "z".repeat(MAX_VALUE_BYTES + 1);
    let json = format!(
        r#"{{"lavray.lang":"en","lavray.token":"secret","token":"x","lavray.theme":5,"lavray.accent":null,"lavray.server":"{big}","lavray.modes":"ok"}}"#
    );
    std::fs::write(dir.join(FILE_NAME), json).unwrap();
    let loaded = load(&dir);
    assert!(loaded.exists);
    let keys: Vec<&str> = loaded.entries.keys().map(String::as_str).collect();
    assert_eq!(keys, ["lavray.lang", "lavray.modes"]);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn garbage_and_oversized_files_are_ignored_and_healed_by_the_next_write() {
    let dir = temp_dir("garbage");
    for garbage in ["не json", "[1,2]", "\"строка\"", "", "{\"lavray.lang\":"] {
        std::fs::write(dir.join(FILE_NAME), garbage).unwrap();
        assert_eq!(load(&dir), Loaded::default(), "{garbage:?}");
    }
    std::fs::write(
        dir.join(FILE_NAME),
        vec![b' '; usize::try_from(MAX_FILE_BYTES).unwrap() + 1],
    )
    .unwrap();
    assert!(!load(&dir).exists, "слишком большой файл не читается");

    // следующая запись заменяет испорченный файл целиком
    std::fs::write(dir.join(FILE_NAME), "не json").unwrap();
    set(&dir, "lavray.lang", text("es"), None).unwrap();
    let loaded = load(&dir);
    assert!(loaded.exists);
    assert_eq!(loaded.entries["lavray.lang"], "es");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_directory_in_place_of_the_file_is_ignored() {
    let dir = temp_dir("dirfile");
    std::fs::create_dir(dir.join(FILE_NAME)).unwrap();
    assert_eq!(load(&dir), Loaded::default());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn writing_leaves_no_temporary_files() {
    let dir = temp_dir("tmp");
    for i in 0..5 {
        set(&dir, "lavray.server", Some(i.to_string()), None).unwrap();
    }
    assert_eq!(files(&dir), [FILE_NAME]);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_failed_write_keeps_the_previous_file_and_cleans_up() {
    let dir = temp_dir("failed");
    set(&dir, "lavray.lang", text("ru"), None).unwrap();
    let before = std::fs::read(dir.join(FILE_NAME)).unwrap();

    // имя файла настроек занято каталогом: переименование невозможно
    let blocked = temp_dir("blocked");
    std::fs::create_dir(blocked.join(FILE_NAME)).unwrap();
    assert!(set(&blocked, "lavray.lang", text("de"), None).is_err());
    assert_eq!(files(&blocked), [FILE_NAME], "временный файл убран");

    // а в исправном каталоге прежний файл цел
    assert_eq!(std::fs::read(dir.join(FILE_NAME)).unwrap(), before);
    std::fs::remove_dir_all(&dir).unwrap();
    std::fs::remove_dir_all(&blocked).unwrap();
}

#[test]
fn concurrent_writers_lose_nothing_and_readers_never_see_a_torn_file() {
    let dir = temp_dir("race");
    set(&dir, "lavray.lang", text("ru"), None).unwrap();
    let stop = Arc::new(AtomicBool::new(false));

    // читатель берёт байты напрямую: любой прочитанный файл — полный JSON
    let reader = {
        let (dir, stop) = (dir.clone(), Arc::clone(&stop));
        std::thread::spawn(move || {
            let mut torn = 0u32;
            let mut reads = 0u32;
            while !stop.load(Ordering::SeqCst) {
                if let Ok(bytes) = std::fs::read(dir.join(FILE_NAME)) {
                    reads += 1;
                    if serde_json::from_slice::<serde_json::Value>(&bytes).is_err() {
                        torn += 1;
                    }
                }
            }
            (reads, torn)
        })
    };

    let writers: Vec<_> = ALLOWED_KEYS
        .iter()
        .enumerate()
        .map(|(n, key)| {
            let dir = dir.clone();
            let key = (*key).to_string();
            std::thread::spawn(move || {
                for i in 0..15 {
                    set(&dir, &key, Some(format!("{n}-{i}")), None).unwrap();
                }
            })
        })
        .collect();
    for writer in writers {
        writer.join().unwrap();
    }
    stop.store(true, Ordering::SeqCst);
    let (reads, torn) = reader.join().unwrap();

    assert!(reads > 0);
    assert_eq!(
        torn, 0,
        "читатель увидел недописанный файл ({reads} чтений)"
    );
    let loaded = load(&dir);
    assert_eq!(
        loaded.entries.len(),
        ALLOWED_KEYS.len(),
        "ни одно изменение не потеряно"
    );
    for (n, key) in ALLOWED_KEYS.iter().enumerate() {
        assert_eq!(loaded.entries[*key], format!("{n}-14"), "{key}");
    }
    assert_eq!(files(&dir), [FILE_NAME]);
    std::fs::remove_dir_all(&dir).unwrap();
}

/// Список ключей в оболочке и в UI — один и тот же, и в `localStorage` UI нет
/// ключей `lavray.*`, о которых список не знает (кроме явно исключённых).
#[test]
fn the_key_list_matches_the_ui_sources() {
    let ui = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("ui")
        .join("src");
    let tracker = std::fs::read_to_string(ui.join("lib").join("uiState.ts")).expect("uiState.ts");
    for key in ALLOWED_KEYS {
        assert!(
            tracker.contains(&format!("'{key}'")),
            "нет {key} в uiState.ts"
        );
    }
    // кэш, который намеренно остаётся только в профиле окна
    let excluded = ["lavray.subErrors"];

    fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                if !matches!(
                    path.file_name().and_then(|n| n.to_str()),
                    Some("gen" | "dictionaries")
                ) {
                    sources(&path, out);
                }
            } else if matches!(
                path.extension().and_then(|e| e.to_str()),
                Some("ts" | "tsx")
            ) && !path.to_string_lossy().contains(".test.")
            {
                out.push(path);
            }
        }
    }
    let mut all = Vec::new();
    sources(&ui, &mut all);
    assert!(all.len() > 50);
    for file in all {
        let code = std::fs::read_to_string(&file).unwrap();
        for (at, _) in code.match_indices("'lavray.") {
            let rest = &code[at + 1..];
            let part = &rest[..rest.find('\'').unwrap_or(rest.len())];
            assert!(
                ALLOWED_KEYS.contains(&part) || excluded.contains(&part),
                "ключ {part} ({}) не входит в список общих настроек UI",
                file.display()
            );
        }
    }
}

#[cfg(windows)]
mod windows_acl {
    use super::*;

    /// SDDL файла так, как его печатает `icacls /save` (UTF-16 без BOM).
    fn saved_sddl(path: &Path) -> String {
        let out = path.with_extension("acl");
        let status = std::process::Command::new("icacls")
            .arg(path)
            .arg("/save")
            .arg(&out)
            .output()
            .expect("icacls запускается");
        assert!(status.status.success(), "icacls /save не удался");
        let bytes = std::fs::read(&out).unwrap();
        let units: Vec<u16> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|p| u16::from_le_bytes([p[0], p[1]]))
            .collect();
        let _ = std::fs::remove_file(&out);
        String::from_utf16_lossy(&units)
    }

    /// Явные (не унаследованные) записи: `(A;;<права>;;;<субъект>)`.
    fn explicit_full_control(sddl: &str, aliases: &[&str]) -> bool {
        sddl.split('(').skip(1).any(|ace| {
            let parts: Vec<&str> = ace.trim_end_matches(')').split(';').collect();
            parts.len() >= 6
                && parts[0] == "A"
                && !parts[1].contains("ID")
                && matches!(parts[2], "FA" | "0x1f01ff")
                && aliases
                    .contains(&parts[5].trim_end_matches(|c: char| c.is_control() || c == ')'))
        })
    }

    #[test]
    fn a_file_created_for_an_elevated_writer_is_fully_open_to_the_user() {
        let dir = temp_dir("acl");
        let sid = crate::token::user_sid().expect("SID пользователя");
        assert!(sddl_ok(&sid));

        set(&dir, "lavray.lang", text("ru"), Some(&sid)).unwrap();
        let sddl = saved_sddl(&dir.join(FILE_NAME));

        // обычный экземпляр того же пользователя сможет файл перезаписать
        // встроенный администратор (RID 500, раннер CI) записан в SDDL как «LA»
        let alias = if sid.ends_with("-500") {
            "LA"
        } else {
            sid.as_str()
        };
        assert!(
            explicit_full_control(&sddl, &[sid.as_str(), alias]),
            "пользователь: {sddl}"
        );
        assert!(
            explicit_full_control(&sddl, &["BA", "S-1-5-32-544"]),
            "администраторы: {sddl}"
        );
        assert!(
            explicit_full_control(&sddl, &["SY", "S-1-5-18"]),
            "SYSTEM: {sddl}"
        );

        // и действительно может: перезапись обычным путём
        set(&dir, "lavray.lang", text("de"), None).unwrap();
        assert_eq!(load(&dir).entries["lavray.lang"], "de");
        assert_eq!(files(&dir), [FILE_NAME]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn sddl_ok(sid: &str) -> bool {
        sid.starts_with("S-1-") && sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    }

    #[test]
    fn the_descriptor_text_names_user_administrators_and_system() {
        assert_eq!(
            acl::sddl("S-1-5-21-1-2-3-1001"),
            "D:(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;BA)(A;;FA;;;SY)"
        );
    }
}
