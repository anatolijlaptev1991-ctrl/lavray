// SPDX-License-Identifier: GPL-3.0-only

//! Выбор папки через системный диалог (T-78): перенос из `NekoBox` просит
//! пользователя указать каталог `config`. Страница получает только строку с
//! выбранным путём (или `null` при отмене); читает каталог ядро, а не страница.

use std::path::PathBuf;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

/// Диалог выбора папки (в тестах — подставной, настоящий не открывается).
pub trait FolderDialog {
    /// Выбранная папка; `None` — отмена.
    fn pick(&self) -> Option<PathBuf>;
}

struct PluginFolderDialog<'a, R: Runtime>(&'a AppHandle<R>);

impl<R: Runtime> FolderDialog for PluginFolderDialog<'_, R> {
    fn pick(&self) -> Option<PathBuf> {
        self.0
            .dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
    }
}

/// Спросить папку и вернуть путь строкой; `None` — пользователь отменил.
pub fn pick_with<D: FolderDialog>(dialog: &D) -> Option<String> {
    dialog.pick().map(|p| p.to_string_lossy().into_owned())
}

/// `file_pick_folder` — «Выбрать папку…». Ответ: путь или `null` при отмене.
/// Диалог блокирующий, поэтому живёт в пуле блокирующих задач, а не в потоке IPC.
#[tauri::command]
pub async fn file_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || pick_with(&PluginFolderDialog(&app)))
        .await
        .map_err(|e| e.to_string())
}
