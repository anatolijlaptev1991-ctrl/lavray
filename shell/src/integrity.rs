// SPDX-License-Identifier: GPL-3.0-only

//! Проверка ядра перед запуском (T-44, A2-07).
//!
//! Ядро лежит рядом с `LAVRay.exe`. В распакованной папке пользователя
//! любой процесс этого пользователя мог подменить `binaries\lavray-core.exe`,
//! а при запуске оболочки от администратора (TUN) подмена давала права
//! администратора. Поэтому `build.rs` считает SHA-256 ядра и вшивает его в
//! оболочку, а перед запуском оболочка сверяет файл с этим хэшем. Проверка
//! защищает от подмены «на диске»; от записи, успевшей между проверкой и
//! запуском, она не защищает.

use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

/// SHA-256 ядра, посчитанный `build.rs` при сборке оболочки. Пусто — при
/// сборке ядра не было.
pub const CORE_SHA256: &str = env!("LAVRAY_CORE_SHA256");

/// Имя приложения из `tauri.conf.json` (вшито `build.rs`): по нему Tauri
/// раскладывает ресурсы на Linux.
pub const PRODUCT_NAME: &str = env!("LAVRAY_PRODUCT_NAME");

/// Каталоги, в которых позволено лежать ядру (T-44): ресурсы установки, а не
/// пользовательские каталоги. Windows — рядом с exe (NSIS); Linux — ресурсы
/// пакета `/usr/lib/<имя>` и, в AppImage, `$APPDIR/usr/lib/<имя>`
/// (соответствует `resource_dir` в tauri-utils).
pub fn core_search_paths() -> Result<Vec<PathBuf>, String> {
    let core = if cfg!(windows) {
        "lavray-core.exe"
    } else {
        "lavray-core"
    };
    let exe = std::env::current_exe().map_err(|e| format!("путь к LAVRay.exe: {e}"))?;
    let dir = exe
        .parent()
        .ok_or("у LAVRay.exe нет каталога")?
        .to_path_buf();
    // На не-Linux ветки cfg ниже нет, и mut не нужен — как в tauri-utils
    // (resource_dir_from).
    #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
    let mut paths = vec![
        dir.join("binaries").join(core),
        dir.join("resources").join("binaries").join(core),
        dir.join("resources").join(core),
    ];
    #[cfg(target_os = "linux")]
    {
        // Нестандартная установка (распакованный deb, извлечённый AppImage):
        // Tauri находит ресурсы через exe_dir/../lib — оболочка ищет там же.
        paths.push(
            dir.join("../lib")
                .join(PRODUCT_NAME)
                .join("binaries")
                .join(core),
        );
        if let Some(appdir) = std::env::var_os("APPDIR") {
            paths.push(
                PathBuf::from(appdir)
                    .join("usr")
                    .join("lib")
                    .join(PRODUCT_NAME)
                    .join("binaries")
                    .join(core),
            );
        }
        paths.push(
            PathBuf::from("/usr/lib")
                .join(PRODUCT_NAME)
                .join("binaries")
                .join(core),
        );
    }
    Ok(paths)
}

/// SHA-256 файла в нижнем регистре.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            return Ok(format!("{:x}", hasher.finalize()));
        }
        hasher.update(&buf[..n]);
    }
}

/// Первый СУЩЕСТВУЮЩИЙ ФАЙЛ из `candidates` (каталог с именем ядра файлом не
/// считается — D6/D7), если его SHA-256 равен `expected`; иначе понятная ошибка.
pub fn find_trusted_core(candidates: &[PathBuf], expected: &str) -> Result<PathBuf, String> {
    let path = candidates
        .iter()
        .find(|p| p.is_file())
        .ok_or("ядро lavray-core не найдено рядом с приложением: переустановите LAVRay")?;
    if expected.is_empty() {
        return Err(
            "в оболочку не вшит хэш ядра (при сборке ядра не было): соберите LAVRay заново".into(),
        );
    }
    let actual =
        sha256_file(path).map_err(|e| format!("не удалось прочитать {}: {e}", path.display()))?;
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "{} изменён после сборки: SHA-256 {actual} не совпадает с вшитым {expected}. \
             Ядро не запущено; переустановите LAVRay",
            path.display()
        ));
    }
    Ok(path.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SHA-256("abc") — контрольный вектор FIPS 180-2.
    const ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn search_paths_start_next_to_the_exe() {
        let paths = core_search_paths().unwrap();
        assert!(!paths.is_empty(), "перечень каталогов не пуст");
        // Первый кандидат — ресурсы рядом с exe (портативный/NSIS): одинаково
        // на всех платформах и не зависит от PRODUCT_NAME.
        let exe = std::env::current_exe().unwrap();
        assert!(
            paths[0].starts_with(exe.parent().unwrap()),
            "{:?}",
            paths[0]
        );
        assert!(paths.iter().all(|p| p.file_name().is_some()), "{paths:?}");
    }

    #[test]
    fn product_name_is_embedded() {
        assert!(!PRODUCT_NAME.is_empty(), "{PRODUCT_NAME:?}");
        assert_eq!(PRODUCT_NAME, "LAVRay", "имя из tauri.conf.json");
    }

    fn core_file(tag: &str, content: &[u8]) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lavray-integrity-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("lavray-core.exe");
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn sha256_matches_the_known_vector() {
        assert_eq!(sha256_file(&core_file("vector", b"abc")).unwrap(), ABC);
    }

    #[test]
    fn build_script_embeds_a_sha256_or_nothing() {
        // Пусто — при сборке не было файла ядра (например, чистая Linux-сборка).
        let hex = CORE_SHA256.bytes().all(|b| b.is_ascii_hexdigit());
        assert!(
            CORE_SHA256.is_empty() || (hex && CORE_SHA256.len() == 64),
            "{CORE_SHA256:?}"
        );
    }

    #[test]
    fn spawn_refuses_a_core_with_one_changed_byte() {
        let planted = core_file("planted", b"abd");
        let err = find_trusted_core(&[planted], ABC).unwrap_err();
        assert!(err.contains("изменён после сборки"), "{err}");
        assert!(err.contains(ABC), "в ошибке есть вшитый хэш: {err}");
    }

    #[test]
    fn intact_core_is_accepted_and_the_first_existing_candidate_is_used() {
        let missing = std::env::temp_dir()
            .join("lavray-integrity-no-such-dir")
            .join("lavray-core.exe");
        let intact = core_file("intact", b"abc");
        assert_eq!(
            find_trusted_core(&[missing, intact.clone()], &ABC.to_uppercase()).unwrap(),
            intact
        );
    }

    #[test]
    fn missing_core_and_unpinned_build_are_reported() {
        let missing = std::env::temp_dir()
            .join("lavray-integrity-no-such-dir")
            .join("lavray-core.exe");
        assert!(find_trusted_core(&[missing], ABC)
            .unwrap_err()
            .contains("не найдено"));
        assert!(find_trusted_core(&[core_file("unpinned", b"abc")], "")
            .unwrap_err()
            .contains("не вшит хэш"));
    }
}
