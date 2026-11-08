// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::update::testkit::TempDir;

/// Установщик в staging с суммой из одной повторяющейся цифры.
fn staged(tmp: &TempDir, digit: char, version: &str) -> (PathBuf, PreviousInfo) {
    let sha256 = digit.to_string().repeat(64);
    let file = format!("{sha256}-setup.exe");
    let dir = tmp.path().join("updates").join("staging");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(&file);
    std::fs::write(&path, format!("installer {version}")).unwrap();
    let info = PreviousInfo {
        version: version.to_string(),
        sha256,
        file,
    };
    (path, info)
}

/// Полный цикл применения одного установщика.
fn apply(store: &PreviousStore, tmp: &TempDir, digit: char, version: &str) -> PreviousInfo {
    let (path, info) = staged(tmp, digit, version);
    store.stage(&path, &info).unwrap();
    store.commit_update(&info).unwrap();
    info
}

fn store(tmp: &TempDir) -> PreviousStore {
    PreviousStore::new(Layout::new(tmp.path()))
}

/// Имена в порядке сортировки (порядок обхода каталога не определён).
fn sorted(mut names: Vec<String>) -> Vec<String> {
    names.sort();
    names
}

fn names(dir: &Path) -> Vec<String> {
    let mut found: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    found
}

#[test]
fn rollback_unavailable_without_previous() {
    let tmp = TempDir::new("prev-none");
    let store = store(&tmp);
    assert_eq!(store.available(), None, "ничего не ставили");

    apply(&store, &tmp, 'a', "0.5.0");
    assert_eq!(store.available(), None, "первое обновление: прошлого нет");
}

#[test]
fn a_damaged_previous_is_not_offered() {
    let tmp = TempDir::new("prev-damaged");
    let store = store(&tmp);
    apply(&store, &tmp, 'a', "0.5.0");
    let info = apply(&store, &tmp, 'b', "0.5.1");
    let previous = Layout::new(tmp.path()).previous_dir();
    assert!(store.available().is_some());

    // файл установщика пропал
    std::fs::remove_file(previous.join(format!("{}-setup.exe", "a".repeat(64)))).unwrap();
    assert_eq!(store.available(), None);

    // повреждённый JSON
    std::fs::write(previous.join(INFO_FILE), b"{oops").unwrap();
    assert_eq!(store.available(), None);

    // имя файла с разделителем и сумма не hex
    for (sha256, file) in [
        ("a".repeat(64), "..\\evil.exe".to_string()),
        ("zz".repeat(32), "zz-setup.exe".to_string()),
    ] {
        let bad = PreviousInfo {
            version: info.version.clone(),
            sha256,
            file,
        };
        std::fs::write(previous.join(INFO_FILE), serde_json::to_vec(&bad).unwrap()).unwrap();
        assert_eq!(store.available(), None, "{bad:?}");
    }
}

#[test]
fn previous_keeps_one() {
    let tmp = TempDir::new("prev-one");
    let store = store(&tmp);
    let layout = Layout::new(tmp.path());
    let a = apply(&store, &tmp, 'a', "0.5.0");
    let b = apply(&store, &tmp, 'b', "0.5.1");
    assert_eq!(store.available(), Some(a));

    let c = apply(&store, &tmp, 'c', "0.5.2");
    let kept = store.available().expect("прошлый установщик");
    assert_eq!(kept, b, "прошлым стал предыдущий применённый, а не A");
    assert_eq!(
        names(&layout.previous_dir()),
        sorted(vec![b.file.clone(), INFO_FILE.to_string()]),
        "в previous ровно один установщик и его описание"
    );
    assert_eq!(
        names(&layout.applied_dir()),
        sorted(vec![APPLIED_FILE.to_string(), c.file.clone()])
    );
    let hint = format!("{}-setup.exe", "a".repeat(64));
    assert!(!layout.previous_dir().join(&hint).exists());
    assert!(!layout.applied_dir().join(&hint).exists());
}

#[test]
fn previous_json_has_the_agreed_shape() {
    let tmp = TempDir::new("prev-json");
    let store = store(&tmp);
    apply(&store, &tmp, 'a', "0.5.0");
    apply(&store, &tmp, 'b', "0.5.1");
    let raw =
        std::fs::read_to_string(Layout::new(tmp.path()).previous_dir().join(INFO_FILE)).unwrap();
    let sha = "a".repeat(64);
    assert_eq!(
        raw,
        format!(r#"{{"version":"0.5.0","sha256":"{sha}","file":"{sha}-setup.exe"}}"#)
    );
}

#[test]
fn reapplying_the_same_installer_does_not_clobber_previous() {
    let tmp = TempDir::new("prev-same");
    let store = store(&tmp);
    apply(&store, &tmp, 'a', "0.5.0");
    let b = apply(&store, &tmp, 'b', "0.5.1");
    apply(&store, &tmp, 'c', "0.5.2");
    apply(&store, &tmp, 'c', "0.5.2"); // повтор после отказа UAC или сбоя
    assert_eq!(store.available(), Some(b));
}

#[test]
fn discard_drops_only_the_pending_copy() {
    let tmp = TempDir::new("prev-discard");
    let store = store(&tmp);
    let layout = Layout::new(tmp.path());
    let a = apply(&store, &tmp, 'a', "0.5.0");
    let (path, info) = staged(&tmp, 'b', "0.5.1");
    store.stage(&path, &info).unwrap();
    assert!(layout.pending_dir().exists());

    store.discard();
    assert!(!layout.pending_dir().exists());
    assert_eq!(
        names(&layout.applied_dir()),
        sorted(vec![APPLIED_FILE.to_string(), a.file])
    );
}

#[test]
fn a_failed_stage_leaves_no_pending_directory() {
    let tmp = TempDir::new("prev-stage-fail");
    let store = store(&tmp);
    let info = PreviousInfo {
        version: "0.5.0".into(),
        sha256: "a".repeat(64),
        file: format!("{}-setup.exe", "a".repeat(64)),
    };
    let missing = tmp.path().join("nope.exe");
    assert!(store.stage(&missing, &info).is_err());
    assert!(!Layout::new(tmp.path()).pending_dir().exists());
}

#[test]
fn commit_rollback_makes_the_previous_installer_the_current_one() {
    let tmp = TempDir::new("prev-rollback");
    let store = store(&tmp);
    let layout = Layout::new(tmp.path());
    let a = apply(&store, &tmp, 'a', "0.5.0");
    apply(&store, &tmp, 'b', "0.5.1");

    store.commit_rollback().unwrap();
    assert_eq!(store.available(), None, "откатываться дальше некуда");
    assert_eq!(
        names(&layout.applied_dir()),
        sorted(vec![APPLIED_FILE.to_string(), a.file.clone()]),
        "стоит A: его установщик снова «текущий»"
    );

    // следующее обновление: A становится прошлым
    apply(&store, &tmp, 'c', "0.5.2");
    assert_eq!(store.available(), Some(a));
}

#[test]
fn an_interrupted_rotation_never_reports_a_broken_previous() {
    let tmp = TempDir::new("prev-interrupted");
    let store = store(&tmp);
    let layout = Layout::new(tmp.path());
    apply(&store, &tmp, 'a', "0.5.0");
    // как после падения между переименованием каталога и файла описания
    std::fs::create_dir_all(layout.previous_dir()).unwrap();
    std::fs::copy(
        layout.applied_dir().join(APPLIED_FILE),
        layout.previous_dir().join(APPLIED_FILE),
    )
    .unwrap();
    assert_eq!(store.available(), None);
}

/// Подпись рядом с установщиком в staging (как её кладёт ядро).
fn sign(path: &Path) {
    let mut name = path.as_os_str().to_os_string();
    name.push(".minisig");
    std::fs::write(name, "untrusted comment: x\nsig").unwrap();
}

fn has_sig(dir: &Path, info: &PreviousInfo) -> bool {
    dir.join(format!("{}.minisig", info.file)).is_file()
}

#[test]
fn the_signature_travels_with_the_installer_through_rotation_and_rollback() {
    let tmp = TempDir::new("prev-sig");
    let store = store(&tmp);
    let layout = Layout::new(tmp.path());
    let (path_a, a) = staged(&tmp, 'a', "0.5.0");
    sign(&path_a);
    store.stage(&path_a, &a).unwrap();
    store.commit_update(&a).unwrap();
    assert!(has_sig(&layout.applied_dir(), &a), "подпись ушла в applied");

    let (path_b, b) = staged(&tmp, 'b', "0.5.1");
    sign(&path_b);
    store.stage(&path_b, &b).unwrap();
    store.commit_update(&b).unwrap();
    assert!(
        has_sig(&layout.previous_dir(), &a),
        "подпись прошлого версии A рядом с ним"
    );
    assert!(has_sig(&layout.applied_dir(), &b));

    store.commit_rollback().unwrap();
    assert!(
        has_sig(&layout.applied_dir(), &a),
        "после отката A снова текущая, с подписью"
    );
}

#[test]
fn a_missing_signature_is_not_invented() {
    let tmp = TempDir::new("prev-nosig");
    let store = store(&tmp);
    let layout = Layout::new(tmp.path());
    let a = apply(&store, &tmp, 'a', "0.5.0");
    apply(&store, &tmp, 'b', "0.5.1");
    assert!(
        !has_sig(&layout.previous_dir(), &a),
        "подписи не было — её и нет"
    );
    assert!(store.available().is_some());
}

/// Описание больше предела — повреждённое, даже если это годный JSON.
#[test]
fn an_oversized_previous_json_is_not_offered() {
    let tmp = TempDir::new("prev-oversized");
    let store = store(&tmp);
    apply(&store, &tmp, 'a', "0.5.0");
    apply(&store, &tmp, 'b', "0.5.1");
    let path = Layout::new(tmp.path()).previous_dir().join(INFO_FILE);
    let mut raw = std::fs::read(&path).unwrap();
    let limit = usize::try_from(MAX_INFO_BYTES).unwrap();
    raw.resize(limit, b' ');
    std::fs::write(&path, &raw).unwrap();
    assert!(store.available().is_some(), "ровно на пределе читается");
    raw.push(b' ');
    std::fs::write(&path, &raw).unwrap();
    assert_eq!(store.available(), None);
}
