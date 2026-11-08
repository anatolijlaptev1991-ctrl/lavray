// SPDX-License-Identifier: GPL-3.0-only

//! Заглушка R0: Rust читает те же файлы, что и Go-тест `core/internal/conformance`.

use lavray_conformance::{load_manifest, repo_root, verify_all};

const REQUIRED: [&str; 8] = [
    "cfgbuild-deviations",
    "cfgbuild-golden",
    "fuzz-corpus",
    "generated-backup",
    "generated-updates",
    "store-migrations",
    "testdata-store-nekoimport",
    "testdata-subs",
];

#[test]
fn manifest_files_match_disk() {
    let root = repo_root();
    let manifest = load_manifest(&root).expect("manifest.json читается");
    assert_eq!(manifest.schema, 1);
    let bad = verify_all(&root, &manifest);
    assert!(bad.is_empty(), "расхождения с диском:\n{}", bad.join("\n"));
}

#[test]
fn required_categories_are_not_empty() {
    let manifest = load_manifest(&repo_root()).expect("manifest.json читается");
    for name in REQUIRED {
        let cat = manifest
            .categories
            .get(name)
            .unwrap_or_else(|| panic!("нет категории {name}"));
        assert!(!cat.files.is_empty(), "категория {name} пуста");
        assert!(
            !cat.description.is_empty(),
            "у категории {name} нет описания"
        );
    }
}

#[test]
fn generated_cases_are_valid_json() {
    let root = repo_root();
    for rel in ["backup", "updates"] {
        let path = root.join(format!("conformance/generated/{rel}/cases.json"));
        let raw = std::fs::read(&path).expect("cases.json читается");
        let v: serde_json::Value = serde_json::from_slice(&raw).expect("cases.json — JSON");
        assert!(
            v["cases"].as_array().is_some_and(|c| !c.is_empty()),
            "{rel}: нет cases"
        );
    }
}
