// SPDX-License-Identifier: GPL-3.0-only

//! Тесты доступа агентов: файл появляется, меняется и исчезает вместе с режимом
//! и ядром; на Windows у файла защищённый дескриптор с двумя записями —
//! пользователь и SYSTEM (проверка через `icacls /save`, как в `ui_state`).

use super::*;

const URL: &str = "tcp://127.0.0.1:50001";
const TOKEN: &str = "AgentTokenAgentTokenAgentTokenAgentToken01";

fn temp_dir(tag: &str) -> PathBuf {
    let mut random = [0u8; 6];
    getrandom::fill(&mut random).unwrap();
    let name: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let dir = std::env::temp_dir().join(format!("lavray-agent-{tag}-{name}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// SID для тестов: на Windows настоящий (файл создаётся с его правами), иначе условный.
fn test_sid() -> String {
    crate::token::user_sid().unwrap_or_else(|| "S-1-5-21-1-2-3-1001".to_owned())
}

fn access(dir: &Path) -> AgentAccess {
    AgentAccess::new(dir.to_path_buf(), Some(test_sid()))
}

fn read(access: &AgentAccess) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(access.path()).ok()?;
    Some(serde_json::from_str(&text).expect("файл — корректный JSON"))
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn mode_values_match_the_core_setting() {
    for (text, mode) in [
        ("off", AgentMode::Off),
        ("read", AgentMode::Read),
        ("control", AgentMode::Control),
    ] {
        assert_eq!(AgentMode::parse(text), Some(mode));
        assert_eq!(mode.as_str(), text);
    }
    for bad in ["", "Read", "admin", "on", "off "] {
        assert_eq!(AgentMode::parse(bad), None, "{bad:?}");
    }
    assert_eq!(
        AgentMode::default(),
        AgentMode::Off,
        "по умолчанию доступа нет"
    );
}

#[test]
fn file_holds_exactly_url_token_and_mode() {
    let json: serde_json::Value =
        serde_json::from_str(&endpoint_json(URL, TOKEN, AgentMode::Control)).unwrap();
    let object = json.as_object().unwrap();
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["mode", "token", "url"]);
    assert_eq!(json["url"], URL);
    assert_eq!(json["token"], TOKEN);
    assert_eq!(json["mode"], "control");
}

#[test]
fn file_follows_mode_and_core() {
    let dir = temp_dir("follow");
    let agent = access(&dir);

    // режим включён, ядра ещё нет — файла нет
    agent.set_mode(AgentMode::Read).unwrap();
    assert!(read(&agent).is_none());

    // ядро запущено — файл появился
    agent.core_up(URL, TOKEN).unwrap();
    let file = read(&agent).unwrap();
    assert_eq!(file["url"], URL);
    assert_eq!(file["token"], TOKEN);
    assert_eq!(file["mode"], "read");

    // режим сменился без перезапуска ядра: тот же токен, новый режим
    agent.set_mode(AgentMode::Control).unwrap();
    let file = read(&agent).unwrap();
    assert_eq!(file["token"], TOKEN);
    assert_eq!(file["mode"], "control");

    // доступ выключен — файла нет, хотя ядро живо
    agent.set_mode(AgentMode::Off).unwrap();
    assert!(read(&agent).is_none());
    assert_eq!(
        names(&dir),
        Vec::<String>::new(),
        "временных файлов не осталось"
    );

    // включён снова — файл вернулся
    agent.set_mode(AgentMode::Read).unwrap();
    assert!(read(&agent).is_some());

    // ядро остановлено — файл удалён
    agent.core_down().unwrap();
    assert!(read(&agent).is_none());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn off_mode_never_writes_a_file() {
    let dir = temp_dir("off");
    let agent = access(&dir);
    agent.core_up(URL, TOKEN).unwrap();
    assert!(read(&agent).is_none(), "режим off по умолчанию");
    agent.set_mode(AgentMode::Off).unwrap();
    agent.core_down().unwrap();
    assert_eq!(names(&dir), Vec::<String>::new());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_restarted_core_gets_a_new_address_and_token() {
    let dir = temp_dir("restart");
    let agent = access(&dir);
    agent.set_mode(AgentMode::Control).unwrap();
    agent.core_up(URL, TOKEN).unwrap();

    // ядро умерло: токен недействителен, файла нет до следующего запуска
    agent.core_down().unwrap();
    assert!(read(&agent).is_none());

    let next = "OtherTokenOtherTokenOtherTokenOtherToken02";
    agent.core_up("tcp://127.0.0.1:50002", next).unwrap();
    let file = read(&agent).unwrap();
    assert_eq!(file["url"], "tcp://127.0.0.1:50002");
    assert_eq!(file["token"], next);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn shutdown_removes_the_file_and_it_never_comes_back() {
    let dir = temp_dir("shutdown");
    let agent = access(&dir);
    agent.set_mode(AgentMode::Read).unwrap();
    agent.core_up(URL, TOKEN).unwrap();
    assert!(read(&agent).is_some());

    agent.shutdown().unwrap();
    assert!(read(&agent).is_none());
    // ни смена режима, ни «поздний» запуск ядра файл не воскрешают
    agent.set_mode(AgentMode::Control).unwrap();
    agent.core_up(URL, TOKEN).unwrap();
    assert!(read(&agent).is_none());
    assert_eq!(names(&dir), Vec::<String>::new());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_stale_file_from_a_crashed_run_is_removed_at_start() {
    let dir = temp_dir("stale");
    std::fs::write(
        dir.join(FILE_NAME),
        endpoint_json(URL, TOKEN, AgentMode::Control),
    )
    .unwrap();
    let agent = access(&dir);
    agent.remove_stale().unwrap();
    assert!(!agent.path().exists());
    agent.remove_stale().unwrap(); // повторно — не ошибка
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_failed_write_is_reported() {
    let dir = temp_dir("fail");
    let blocker = dir.join("not-a-dir");
    std::fs::write(&blocker, "это файл").unwrap();
    // каталог данных — обычный файл: создать в нём нечего
    let agent = AgentAccess::new(blocker.clone(), Some(test_sid()));
    agent.set_mode(AgentMode::Read).unwrap();
    assert!(agent.core_up(URL, TOKEN).is_err());
    assert!(!agent.path().exists());
    std::fs::remove_dir_all(&dir).unwrap();
}

/// Токен агентов приходит только из `core_up`: основной токен ядра в файл попасть
/// не может, потому что `AgentAccess` его не получает вовсе.
#[test]
fn the_file_never_contains_the_main_core_token() {
    let dir = temp_dir("main");
    let main_token = "MainCoreTokenMainCoreTokenMainCoreToken0001";
    let agent = access(&dir);
    agent.set_mode(AgentMode::Control).unwrap();
    agent.core_up(URL, TOKEN).unwrap();
    let text = std::fs::read_to_string(agent.path()).unwrap();
    assert!(text.contains(TOKEN) && !text.contains(main_token));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[cfg(unix)]
#[test]
fn the_file_is_private_to_its_owner() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir("mode600");
    let agent = access(&dir);
    agent.set_mode(AgentMode::Read).unwrap();
    agent.core_up(URL, TOKEN).unwrap();
    let mode = std::fs::metadata(agent.path())
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    std::fs::remove_dir_all(&dir).unwrap();
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
            .map(|p| u16::from_le_bytes(*p))
            .collect();
        let _ = std::fs::remove_file(&out);
        String::from_utf16_lossy(&units)
    }

    fn clean(text: &str) -> String {
        text.trim_end_matches(|c: char| c.is_control() || c == ')')
            .to_owned()
    }

    /// Записи DACL: (флаги, права, субъект).
    fn aces(sddl: &str) -> Vec<(String, String, String)> {
        sddl.split('(')
            .skip(1)
            .filter_map(|ace| {
                let parts: Vec<&str> = ace.trim_end_matches(')').split(';').collect();
                (parts.len() >= 6 && parts[0] == "A")
                    .then(|| (parts[1].to_owned(), parts[2].to_owned(), clean(parts[5])))
            })
            .collect()
    }

    #[test]
    fn the_descriptor_text_names_only_user_and_system_and_blocks_inheritance() {
        assert_eq!(
            sddl("S-1-5-21-1-2-3-1001"),
            "D:P(A;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;SY)"
        );
    }

    #[test]
    fn the_file_is_readable_only_by_the_user_and_system() {
        let dir = temp_dir("acl");
        let sid = test_sid();
        let agent = AgentAccess::new(dir.clone(), Some(sid.clone()));
        agent.set_mode(AgentMode::Control).unwrap();
        agent.core_up(URL, TOKEN).unwrap();

        let sddl = saved_sddl(&agent.path());
        assert!(sddl.contains("D:P"), "DACL защищён от наследования: {sddl}");
        let entries = aces(&sddl);
        assert!(
            entries.iter().all(|(flags, _, _)| !flags.contains("ID")),
            "унаследованных записей нет: {sddl}"
        );
        let mut subjects: Vec<String> = entries
            .iter()
            .map(|(_, _, who)| {
                if who == "S-1-5-18" {
                    "SY".to_owned()
                } else {
                    who.clone()
                }
            })
            .collect();
        subjects.sort();
        let mut expected = vec![sid.clone(), "SY".to_owned()];
        expected.sort();
        assert_eq!(subjects, expected, "только пользователь и SYSTEM: {sddl}");
        assert!(
            entries
                .iter()
                .all(|(_, rights, _)| rights == "FA" || rights == "0x1f01ff"),
            "полный доступ: {sddl}"
        );

        // пользователь файл читает и после перезаписи режима
        agent.set_mode(AgentMode::Read).unwrap();
        assert_eq!(read(&agent).unwrap()["mode"], "read");
        let after = aces(&saved_sddl(&agent.path()));
        assert_eq!(after.len(), 2, "перезапись сохранила защиту: {after:?}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn without_a_user_sid_nothing_is_written() {
        let dir = temp_dir("nosid");
        let agent = AgentAccess::new(dir.clone(), None);
        agent.set_mode(AgentMode::Read).unwrap();
        assert!(
            agent.core_up(URL, TOKEN).is_err(),
            "файл с токеном без защиты не создаётся"
        );
        assert!(!agent.path().exists());
        assert_eq!(names(&dir), Vec::<String>::new());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
