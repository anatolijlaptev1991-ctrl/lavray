// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::integrity::sha256_file;
use crate::update::testkit::TempDir;
use std::cell::RefCell;
use std::rc::Rc;

const SHA: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

type Seen = Rc<RefCell<Vec<(PathBuf, Vec<OsString>)>>>;

struct FakeRunner {
    answer: io::Result<RunOutput>,
    seen: Seen,
}

impl FakeRunner {
    fn new(answer: io::Result<RunOutput>) -> (Self, Seen) {
        let seen = Seen::default();
        (
            Self {
                answer,
                seen: Rc::clone(&seen),
            },
            seen,
        )
    }
}

impl CoreRunner for FakeRunner {
    fn run(&self, exe: &Path, args: &[OsString]) -> io::Result<RunOutput> {
        self.seen
            .borrow_mut()
            .push((exe.to_path_buf(), args.to_vec()));
        match &self.answer {
            Ok(out) => Ok(RunOutput {
                success: out.success,
                stdout: out.stdout.clone(),
            }),
            Err(e) => Err(io::Error::new(e.kind(), "сбой запуска")),
        }
    }
}

fn ok_output(version: &str, sha: &str) -> RunOutput {
    RunOutput {
        success: true,
        stdout: format!(r#"{{"version":"{version}","sha256":"{sha}"}}"#).into_bytes(),
    }
}

// Каталог установки без букв диска: тесты идут и на Linux, где «\» — не
// разделитель пути.
fn install_root() -> PathBuf {
    PathBuf::from("Program Files").join("LAVRay")
}

fn verifier(runner: FakeRunner) -> CoreVerifier {
    CoreVerifier::new(
        install_root().join("binaries").join("lavray-core.exe"),
        PathBuf::from("userdata"),
        Box::new(runner),
    )
}

#[test]
fn arguments_name_the_files_and_allow_older_only_for_rollback() {
    let args = |older| {
        verify_args(
            Path::new("a.exe"),
            Path::new("a.exe.minisig"),
            Path::new("d"),
            older,
        )
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
    };
    assert_eq!(
        args(false),
        [
            "verify-artifact",
            "--file",
            "a.exe",
            "--sig",
            "a.exe.minisig",
            "--data",
            "d"
        ]
    );
    assert_eq!(args(true).last().unwrap(), "--allow-older");
}

#[test]
fn only_a_zero_exit_with_well_formed_json_is_accepted() {
    let good = interpret(&ok_output("0.5.1", SHA)).unwrap();
    assert_eq!(
        (good.version.as_str(), good.sha256.as_str()),
        ("0.5.1", SHA)
    );

    let failed = RunOutput {
        success: false,
        stdout: ok_output("0.5.1", SHA).stdout,
    };
    assert_eq!(interpret(&failed), Err(ApplyError::SignatureInvalid));
    for stdout in [
        &b""[..],
        b"not json",
        br#"{"version":"0.5.1"}"#,
        br#"{"version":"","sha256":"0123"}"#,
    ] {
        let out = RunOutput {
            success: true,
            stdout: stdout.to_vec(),
        };
        assert_eq!(
            interpret(&out),
            Err(ApplyError::SignatureInvalid),
            "{stdout:?}"
        );
    }
    assert_eq!(
        interpret(&ok_output("0.5.1", "abc")),
        Err(ApplyError::SignatureInvalid),
        "сумма не 64 hex"
    );
    assert_eq!(
        interpret(&ok_output("0.5.1 evil", SHA)),
        Err(ApplyError::SignatureInvalid),
        "версия с пробелом"
    );
}

#[test]
fn the_bundled_core_runs_from_the_install_dir_with_the_given_files() {
    let (runner, seen) = FakeRunner::new(Ok(ok_output("0.5.1", SHA)));
    let v = verifier(runner);
    let facts = v
        .verify(
            Path::new(r"C:\data\updates\staging\x.exe"),
            Path::new(r"C:\data\updates\staging\x.exe.minisig"),
            false,
        )
        .unwrap();
    assert_eq!(facts.version, "0.5.1");
    let seen = seen.borrow();
    assert_eq!(seen.len(), 1);
    assert!(seen[0].0.starts_with(install_root()));
    assert!(!seen[0].0.to_string_lossy().contains("staging"));
    assert!(!seen[0].0.to_string_lossy().contains("data"));
}

#[test]
fn a_core_that_cannot_run_means_core_unavailable_not_a_pass() {
    let (runner, _) = FakeRunner::new(Err(io::Error::from(io::ErrorKind::NotFound)));
    let v = verifier(runner);
    assert_eq!(
        v.verify(Path::new("a"), Path::new("b"), false),
        Err(ApplyError::CoreUnavailable)
    );
}

#[test]
fn candidates_are_only_inside_the_install_directory() {
    let exe = install_root().join("LAVRay.exe");
    let found = bundled_core_candidates(&exe);
    assert_eq!(found.len(), 3);
    for path in found {
        assert!(path.starts_with(install_root()), "{path:?}");
    }
}

fn install_dir(tag: &str, core: &[u8]) -> (TempDir, PathBuf) {
    let tmp = TempDir::new(tag);
    let bin = tmp.path().join("binaries");
    std::fs::create_dir_all(&bin).unwrap();
    let name = if cfg!(windows) {
        "lavray-core.exe"
    } else {
        "lavray-core"
    };
    std::fs::write(bin.join(name), core).unwrap();
    let exe = tmp.path().join("LAVRay.exe");
    (tmp, exe)
}

#[test]
fn a_pinned_core_must_match_its_hash_and_an_unpinned_one_just_exist() {
    let (_tmp, exe) = install_dir("core-pin", b"core bytes");
    let sum = sha256_file(&bundled_core_candidates(&exe)[0]).unwrap();
    assert!(bundled_core(&exe, Some(&sum)).is_ok());
    assert_eq!(
        bundled_core(&exe, Some(&"0".repeat(64))),
        Err(ApplyError::CoreUnavailable),
        "подменённое ядро не запускается"
    );
    assert!(bundled_core(&exe, None).is_ok());

    let empty = TempDir::new("core-none");
    assert_eq!(
        bundled_core(&empty.path().join("LAVRay.exe"), None),
        Err(ApplyError::CoreUnavailable)
    );
}
