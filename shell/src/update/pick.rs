// SPDX-License-Identifier: GPL-3.0-only

//! «Установить из файла» без пути от страницы (T-75): системный диалог
//! открытия выбирает пользователь, оболочка копирует выбранный установщик в
//! staging (`stage_local`). Страница получает только `{staged_path, sha256}` и не
//! может подсунуть произвольный путь; JS-права на диалог не нужны (как у
//! `file_save`).

use super::layout::Layout;
use super::stage::{stage_local, StageError, StagedFile, MAX_INSTALLER_BYTES};
use crate::os_integration::DataDir;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;

/// Диалог выбора установщика (в тестах — подставной).
pub trait OpenDialog {
    /// Выбранный путь; `None` — отмена.
    fn pick(&self) -> Option<PathBuf>;
}

struct PluginOpen<'a, R: Runtime>(&'a AppHandle<R>);

impl<R: Runtime> OpenDialog for PluginOpen<'_, R> {
    fn pick(&self) -> Option<PathBuf> {
        self.0
            .dialog()
            .file()
            .add_filter("Installer", &["exe"])
            .blocking_pick_file()
            .and_then(|path| path.into_path().ok())
    }
}

/// Спросить файл и положить его в staging; `Ok(None)` — пользователь отменил.
pub fn pick_and_stage(
    dialog: &dyn OpenDialog,
    layout: &Layout,
    max: u64,
) -> Result<Option<StagedFile>, StageError> {
    match dialog.pick() {
        None => Ok(None),
        Some(path) => stage_local(layout, &path, max).map(Some),
    }
}

/// update_pick_installer — «Из файла»: диалог выбора установщика и копия в
/// staging. `null` — диалог закрыт без выбора. Дальше ядро проверяет подпись
/// (`VerifyLocalUpdate`), а `update_apply` ставит.
#[tauri::command]
pub async fn update_pick_installer(
    app: AppHandle,
    dir: State<'_, DataDir>,
) -> Result<Option<StagedFile>, String> {
    let layout = Layout::new(&dir.0);
    tauri::async_runtime::spawn_blocking(move || {
        pick_and_stage(&PluginOpen(&app), &layout, MAX_INSTALLER_BYTES)
    })
    .await
    .map_err(|_| "worker_failed".to_string())?
    .map_err(|e| e.code().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::testkit::TempDir;

    struct Fixed(Option<PathBuf>);

    impl OpenDialog for Fixed {
        fn pick(&self) -> Option<PathBuf> {
            self.0.clone()
        }
    }

    #[test]
    fn a_cancelled_dialog_stages_nothing() {
        let tmp = TempDir::new("pick-cancel");
        let layout = Layout::new(tmp.path());
        assert_eq!(
            pick_and_stage(&Fixed(None), &layout, MAX_INSTALLER_BYTES),
            Ok(None)
        );
        assert!(!layout.staging().exists());
    }

    #[test]
    fn a_picked_file_lands_in_staging() {
        let tmp = TempDir::new("pick-ok");
        let layout = Layout::new(&tmp.path().join("data"));
        let source = tmp.path().join("setup.exe");
        std::fs::write(&source, b"installer").unwrap();
        let staged = pick_and_stage(&Fixed(Some(source)), &layout, MAX_INSTALLER_BYTES)
            .unwrap()
            .expect("файл выбран");
        assert!(PathBuf::from(&staged.staged_path).starts_with(layout.staging()));
        assert_eq!(staged.sha256.len(), 64);
    }

    #[test]
    fn an_unusable_pick_is_an_error_not_a_cancel() {
        let tmp = TempDir::new("pick-bad");
        let layout = Layout::new(tmp.path());
        let missing = tmp.path().join("nope.exe");
        assert_eq!(
            pick_and_stage(&Fixed(Some(missing)), &layout, MAX_INSTALLER_BYTES),
            Err(StageError::InvalidSource)
        );
    }
}
