// SPDX-License-Identifier: GPL-3.0-only

//! Тесты KDE sysproxy: разбор/сериализация kioslaverc, capture/apply/restore/
//! clear на реальных файлах во временном каталоге, сохранение чужих секций.

use super::*;
use std::path::PathBuf;

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let mut r = [0u8; 8];
        getrandom::fill(&mut r).unwrap();
        let name: String = r.iter().map(|b| format!("{b:02x}")).collect();
        let d = std::env::temp_dir().join(format!("lavray-kde-test-{name}"));
        std::fs::create_dir_all(&d).unwrap();
        Self(d)
    }
    fn path(&self) -> PathBuf {
        self.0.join("kioslaverc")
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const SAMPLE: &str = "\
[Proxy Settings]
ProxyType=1
httpProxy=http://old:8080
httpsProxy=http://old:8080
NoProxyFor=localhost

[Other Section]
SomeKey=value
";

#[test]
fn parse_reads_proxy_settings() {
    let p = parse(SAMPLE);
    assert_eq!(p.proxy_type, 1);
    assert_eq!(p.http, "http://old:8080");
    assert_eq!(p.https, "http://old:8080");
    assert_eq!(p.no_proxy, "localhost");
}

#[test]
fn parse_empty_file_is_defaults() {
    let p = parse("");
    assert_eq!(p, KdeProxy::default());
}

#[test]
fn parse_ignores_other_sections() {
    let text = "[Other]\nProxyType=9\nhttpProxy=evil\n[Proxy Settings]\nProxyType=2\n";
    let p = parse(text);
    assert_eq!(p.proxy_type, 2);
    assert_eq!(p.http, "");
}

#[test]
fn parse_invalid_proxy_type_defaults_to_zero() {
    let p = parse("[Proxy Settings]\nProxyType=abc\n");
    assert_eq!(p.proxy_type, 0);
}

#[test]
fn parse_comments_and_blank_lines_skipped() {
    let p = parse("[Proxy Settings]\n# comment\n\nProxyType=1\n");
    assert_eq!(p.proxy_type, 1);
}

#[test]
fn render_preserves_other_sections() {
    let p = KdeProxy {
        proxy_type: 0,
        http: String::new(),
        https: String::new(),
        no_proxy: String::new(),
    };
    let out = render(SAMPLE, &p);
    assert!(out.contains("[Other Section]"));
    assert!(out.contains("SomeKey=value"));
    assert!(out.contains("ProxyType=0"));
    assert!(!out.contains("http://old:8080"));
}

#[test]
fn render_creates_section_when_absent() {
    let p = KdeProxy {
        proxy_type: 1,
        http: "http://x:1".into(),
        https: "http://x:1".into(),
        no_proxy: String::new(),
    };
    let out = render("", &p);
    assert!(out.contains("[Proxy Settings]"));
    assert!(out.contains("ProxyType=1"));
    assert!(out.contains("httpProxy=http://x:1"));
}

#[test]
fn render_round_trips() {
    let p = parse(SAMPLE);
    let rendered = render(SAMPLE, &p);
    let p2 = parse(&rendered);
    assert_eq!(p, p2);
}

#[test]
fn apply_sets_manual_proxy() {
    let dir = TempDir::new();
    std::fs::write(dir.path(), SAMPLE).unwrap();
    apply_at(&dir.path(), "127.0.0.1", 2080).unwrap();
    let text = std::fs::read_to_string(dir.path()).unwrap();
    let p = parse(&text);
    assert_eq!(p.proxy_type, 1);
    assert_eq!(p.http, "http://127.0.0.1:2080");
    assert_eq!(p.https, "http://127.0.0.1:2080");
    // Чужая секция сохранена.
    assert!(text.contains("[Other Section]"));
}

#[test]
fn apply_creates_file_and_dirs() {
    let dir = TempDir::new();
    let nested = dir.0.join("sub").join("kioslaverc");
    apply_at(&nested, "10.0.0.1", 3128).unwrap();
    assert!(nested.exists());
    let p = parse(&std::fs::read_to_string(&nested).unwrap());
    assert_eq!(p.proxy_type, 1);
}

#[test]
fn capture_restore_round_trip() {
    let dir = TempDir::new();
    std::fs::write(dir.path(), SAMPLE).unwrap();
    let snap = capture_at(&dir.path()).unwrap();
    assert_eq!(snap.data["backend"], "kde");
    assert_eq!(snap.data["proxy_type"], 1);

    apply_at(&dir.path(), "127.0.0.1", 2080).unwrap();
    restore_at(&dir.path(), &snap).unwrap();
    let p = parse(&std::fs::read_to_string(dir.path()).unwrap());
    assert_eq!(p.http, "http://old:8080");
    assert_eq!(p.proxy_type, 1);
}

#[test]
fn clear_sets_proxy_type_zero() {
    let dir = TempDir::new();
    std::fs::write(dir.path(), SAMPLE).unwrap();
    clear_at(&dir.path()).unwrap();
    let p = parse(&std::fs::read_to_string(dir.path()).unwrap());
    assert_eq!(p.proxy_type, 0);
    assert_eq!(p.http, "");
}

#[test]
fn capture_missing_file_is_empty_snapshot() {
    let dir = TempDir::new();
    let snap = capture_at(&dir.path()).unwrap();
    assert_eq!(snap.data["proxy_type"], 0);
}

#[test]
fn restore_non_kde_snapshot_clears() {
    let dir = TempDir::new();
    std::fs::write(dir.path(), SAMPLE).unwrap();
    let snap = ProxySnapshot {
        version: 1,
        os: "linux".into(),
        data: serde_json::json!({"backend": "gnome"}),
    };
    restore_at(&dir.path(), &snap).unwrap();
    let p = parse(&std::fs::read_to_string(dir.path()).unwrap());
    assert_eq!(p.proxy_type, 0);
}

#[test]
fn parse_case_insensitive_section() {
    let p = parse("[proxy settings]\nProxyType=3\n");
    assert_eq!(p.proxy_type, 3);
}

#[test]
fn render_no_duplicate_proxy_keys() {
    let p = KdeProxy {
        proxy_type: 1,
        http: "http://a:1".into(),
        https: "http://a:1".into(),
        no_proxy: String::new(),
    };
    let out = render(SAMPLE, &p);
    assert_eq!(out.matches("ProxyType=").count(), 1);
    assert_eq!(out.matches("httpProxy=").count(), 1);
}
