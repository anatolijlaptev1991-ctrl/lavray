// SPDX-License-Identifier: GPL-3.0-only

//! Профиль WebView у повышенного экземпляра (T-81, ревью).
//!
//! WebView2 не любит общий каталог данных у процессов с разной целостностью
//! (обычный и повышенный экземпляры по очереди открывают один профиль, а
//! процессы WebView2 старого ещё закрываются): окно может не создаться. Поэтому
//! повышенный экземпляр получает собственный каталог данных WebView. Настройки,
//! которые должны быть общими (язык, тема, режимы, выбор сервера, признак
//! онбординга), живут не в `localStorage` профиля, а в общем файле
//! `ui-state.json` — см. [`crate::ui_state`].

use std::path::{Path, PathBuf};

/// Каталог данных WebView для повышенного экземпляра: рядом с обычным
/// (`<local>/<identifier>/EBWebView`), но отдельный. Обычному экземпляру
/// (`None`) оставлен каталог по умолчанию.
pub fn webview_data_dir(local_data: &Path, identifier: &str, elevated: bool) -> Option<PathBuf> {
    elevated.then(|| local_data.join(identifier).join("EBWebView-admin"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_elevated_instance_gets_its_own_webview_directory() {
        // Сравнение по компонентам: тесты оболочки идут и на Linux CI, где `\`
        // в строке пути не разделитель.
        let local = Path::new(r"C:\Users\u\AppData\Local");
        assert_eq!(webview_data_dir(local, "io.example.app", false), None);
        let dir = webview_data_dir(local, "io.example.app", true).unwrap();
        assert!(dir.starts_with(local), "{}", dir.display());
        assert!(
            dir.ends_with(Path::new("io.example.app").join("EBWebView-admin")),
            "{}",
            dir.display()
        );
    }
}
