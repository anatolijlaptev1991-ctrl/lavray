// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use std::cell::{Cell, RefCell};

/// Диалог в памяти: отвечает заданным путём и запоминает, что предлагали.
struct FakeDialog {
    answer: Option<PathBuf>,
    asked: Cell<usize>,
    offered: RefCell<Option<String>>,
}

impl FakeDialog {
    fn answering(answer: Option<PathBuf>) -> Self {
        Self {
            answer,
            asked: Cell::new(0),
            offered: RefCell::new(None),
        }
    }
}

impl SaveDialog for FakeDialog {
    fn pick(&self, request: &save::SaveRequest) -> Option<PathBuf> {
        self.asked.set(self.asked.get() + 1);
        *self.offered.borrow_mut() = Some(request.file_name.clone());
        self.answer.clone()
    }
}

fn dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("lavray-save-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn save_writes_to_the_chosen_path_only() {
    let d = dir("ok");
    let chosen = d.join("chosen.txt");
    let dialog = FakeDialog::answering(Some(chosen.clone()));
    assert_eq!(save_with(&dialog, "lavray-log", "txt", b"line"), Ok(true));
    assert_eq!(std::fs::read(&chosen).unwrap(), b"line");
    assert_eq!(dialog.offered.borrow().as_deref(), Some("lavray-log.txt"));
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn cancel_writes_nothing() {
    let dialog = FakeDialog::answering(None);
    assert_eq!(save_with(&dialog, "x", "txt", b"data"), Ok(false));
    assert_eq!(dialog.asked.get(), 1);
}

#[test]
fn invalid_request_does_not_open_the_dialog() {
    let dialog = FakeDialog::answering(Some(PathBuf::from("never")));
    assert_eq!(
        save_with(&dialog, "../x", "txt", b""),
        Err("bad_name".into())
    );
    assert_eq!(
        save_with(&dialog, "x", "exe", b""),
        Err("bad_extension".into())
    );
    assert_eq!(dialog.asked.get(), 0);
}

#[test]
fn write_failure_is_an_io_code() {
    let d = dir("io");
    let dialog = FakeDialog::answering(Some(d.clone())); // выбран каталог
    let err = save_with(&dialog, "x", "txt", b"data").unwrap_err();
    assert!(err.starts_with("io:"), "{err}");
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn percent_decoding() {
    assert_eq!(
        percent_decode("lavray-log-1").as_deref(),
        Some("lavray-log-1")
    );
    assert_eq!(
        percent_decode("%D0%B6%D1%83%D1%80%D0%BD%D0%B0%D0%BB").as_deref(),
        Some("журнал")
    );
    assert_eq!(percent_decode("a%20b").as_deref(), Some("a b"));
    assert_eq!(
        percent_decode("%2F..%5C").as_deref(),
        Some("/..\\"),
        "проверит validate"
    );
    for bad in ["%", "%2", "%zz", "%FF"] {
        assert_eq!(percent_decode(bad), None, "{bad}");
    }
}

/// Диалог выбора папки в памяти (T-78): отвечает заданным путём, считает вызовы.
struct FakeFolderDialog {
    answer: Option<PathBuf>,
    asked: Cell<usize>,
}

impl pick::FolderDialog for FakeFolderDialog {
    fn pick(&self) -> Option<PathBuf> {
        self.asked.set(self.asked.get() + 1);
        self.answer.clone()
    }
}

#[test]
fn picked_folder_is_returned_as_a_string() {
    let chosen = PathBuf::from(r"C:\Users\Анна\Рабочий стол\nekoray\config");
    let dialog = FakeFolderDialog {
        answer: Some(chosen.clone()),
        asked: Cell::new(0),
    };
    assert_eq!(
        pick::pick_with(&dialog),
        Some(chosen.to_string_lossy().into_owned())
    );
    assert_eq!(dialog.asked.get(), 1, "диалог открывается ровно один раз");
}

#[test]
fn cancelled_folder_dialog_is_none() {
    let dialog = FakeFolderDialog {
        answer: None,
        asked: Cell::new(0),
    };
    assert_eq!(pick::pick_with(&dialog), None);
    assert_eq!(dialog.asked.get(), 1);
}
