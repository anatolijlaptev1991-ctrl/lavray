// SPDX-License-Identifier: GPL-3.0-only

//! «Сохранить как» через системный диалог (T-82).
//!
//! Страница присылает данные (сырое тело запроса), предложенное имя и
//! расширение; путь выбирает пользователь в диалоге ОС, и только туда оболочка
//! пишет. Так страница не может записать файл по произвольному пути. Открытие
//! файлов не нужно оболочке: `<input type="file">` в WebView2 уже открывает
//! системный диалог и читает выбранный файл. Выбор папки (`pick`) нужен
//! переносу из NekoBox: `<input webkitdirectory>` не отдаёт путь.

pub mod io;
pub mod pick;
pub mod save;

use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

/// Заголовок с предложенным именем (encodeURIComponent: в заголовке только ASCII).
pub const NAME_HEADER: &str = "x-lavray-name";
/// Заголовок с расширением.
pub const EXT_HEADER: &str = "x-lavray-ext";

/// Диалог «Сохранить как» (в тестах — подставной).
pub trait SaveDialog {
    /// Путь, выбранный пользователем; `None` — отмена.
    fn pick(&self, request: &save::SaveRequest) -> Option<PathBuf>;
}

struct PluginDialog<'a, R: Runtime>(&'a AppHandle<R>);

impl<R: Runtime> SaveDialog for PluginDialog<'_, R> {
    fn pick(&self, request: &save::SaveRequest) -> Option<PathBuf> {
        self.0
            .dialog()
            .file()
            .set_file_name(&request.file_name)
            .add_filter(request.extension, &[request.extension])
            .blocking_save_file()
            .and_then(|p| p.into_path().ok())
    }
}

/// Ранний отказ по размеру: до копирования тела и до диалога.
pub fn ensure_size(len: usize) -> Result<(), String> {
    if len > save::MAX_SAVE_BYTES {
        return Err(save::SaveError::TooLarge.code().to_string());
    }
    Ok(())
}

/// Сохранить: проверить запрос, спросить путь, записать атомарно.
/// `Ok(false)` — пользователь отменил диалог.
pub fn save_with<D: SaveDialog>(
    dialog: &D,
    name: &str,
    ext: &str,
    data: &[u8],
) -> Result<bool, String> {
    let request = save::validate(name, ext, data.len()).map_err(|e| e.code().to_string())?;
    let Some(path) = dialog.pick(&request) else {
        return Ok(false);
    };
    io::write_atomic(&path, data).map_err(|e| io::io_code(&e))?;
    Ok(true)
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or("bad_request")?;
    percent_decode(raw).ok_or_else(|| "bad_name".to_string())
}

/// Раскодировать `encodeURIComponent`; испорченная последовательность — `None`.
pub fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// file_save — «Сохранить как»: тело — байты файла, заголовки — имя и
/// расширение. Ответ: `true` — записано, `false` — отменено. Ошибки:
/// `bad_request`, `bad_name`, `bad_extension`, `too_large`, `io:<вид>`.
#[tauri::command]
pub async fn file_save(app: AppHandle, request: Request<'_>) -> Result<bool, String> {
    let name = header(&request, NAME_HEADER)?;
    let ext = header(&request, EXT_HEADER)?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("bad_request".into());
    };
    ensure_size(data.len())?;
    let data = data.clone();
    tauri::async_runtime::spawn_blocking(move || save_with(&PluginDialog(&app), &name, &ext, &data))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
