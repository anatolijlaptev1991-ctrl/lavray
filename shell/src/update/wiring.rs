// SPDX-License-Identifier: GPL-3.0-only

//! Команды обновления для UI (T-75) и их состояние. Регистрируются в
//! `commands.rs`; `main.rs` их не знает. Тяжёлая работа (остановка ядра, UAC,
//! чтение файлов) идёт в пуле блокирующих потоков, не в потоке команд.
//!
//! Аргументы приходят из JS в camelCase и попадают в snake_case-параметры.
//! Ошибки — стабильные коды ([`ApplyError::code`]). Команды сами подпись не проверяют:
//! установщик перед повышением прав проверяет встроенное ядро (`core_verify.rs`).

use super::app_adapters::{schedule_exit, SupervisorCore, SysProxyReleaser};
use super::clock::{Clock, SystemClock};
use super::core_verify::CoreVerifier;
use super::error::{ApplyError, ApplyOutcome};
use super::heartbeat::HealthStore;
use super::layout::Layout;
use super::paths::RealFs;
use super::prepare::{apply_guarded, ApplyDeps, ApplyGate, ApplyRequest, Mode};
use super::previous::{installer_path, PreviousInfo, PreviousStore};
use super::real::{CopyWatchdog, Runas};
use super::verify::RealOpener;
use crate::integrity::CORE_SHA256;
use crate::os_integration::DataDir;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Замок «установка уже идёт» для общего состояния приложения.
#[must_use]
pub fn new_gate() -> Arc<ApplyGate> {
    Arc::new(ApplyGate::default())
}

/// Что установить.
struct ApplyJob {
    mode: Mode,
    candidate: PathBuf,
    sha256: String,
    version: String,
}

/// Установка с настоящими зависимостями; блокирует поток.
fn execute(
    app: &AppHandle,
    gate: &ApplyGate,
    data: &Path,
    job: &ApplyJob,
) -> Result<ApplyOutcome, ApplyError> {
    let layout = Layout::new(data);
    let app_exe = std::env::current_exe().map_err(|_| ApplyError::PrepareFailed)?;
    let core = SupervisorCore::new(app.clone());
    let proxy = SysProxyReleaser {
        data_dir: data.to_path_buf(),
    };
    let store = PreviousStore::new(layout.clone());
    let app_exe_for_core = app_exe.clone();
    let watchdog = CopyWatchdog {
        layout: layout.clone(),
        app_exe,
    };
    // подпись проверяет ВСТРОЕННОЕ ядро (из каталога установки, с вшитым хэшем)
    let signature = CoreVerifier::bundled(&app_exe_for_core, Some(CORE_SHA256), data)?;
    let dir = match job.mode {
        Mode::Update => layout.staging(),
        Mode::Rollback => layout.previous_dir(),
    };
    let opener = RealOpener::within(&dir);
    let deps = ApplyDeps {
        fs: &RealFs,
        opener: &opener,
        core: &core,
        proxy: &proxy,
        elevator: &Runas,
        signature: &signature,
        archive: &store,
        watchdog: &watchdog,
    };
    let request = ApplyRequest {
        layout: &layout,
        mode: job.mode,
        candidate: &job.candidate,
        sha256: &job.sha256,
        version: &job.version,
    };
    apply_guarded(gate, &deps, &request)
}

/// Выполнить установку в пуле блокирующих потоков; после запуска установщика
/// приложение выходит само (ядро и прокси уже сняты).
async fn run_job(
    app: AppHandle,
    gate: Arc<ApplyGate>,
    data: PathBuf,
    job: ApplyJob,
) -> Result<ApplyOutcome, String> {
    let worker = app.clone();
    let outcome =
        tauri::async_runtime::spawn_blocking(move || execute(&worker, &gate, &data, &job))
            .await
            .map_err(|_| "worker_failed".to_string())?
            .map_err(|e| e.code().to_string())?;
    if outcome == ApplyOutcome::Installing {
        schedule_exit(&app);
    }
    Ok(outcome)
}

/// `update_apply` — установить проверенный ядром установщик из `updates/staging`:
/// повторная проверка SHA-256 под блокировкой, остановка ядра, снятие прокси,
/// запуск NSIS `/S` с одним запросом UAC. `{"status":"installing"}` — приложение
/// сейчас выйдет; `{"status":"uac_cancelled"}` — отказ в UAC, ничего не изменено.
#[tauri::command]
pub async fn update_apply(
    app: AppHandle,
    gate: State<'_, Arc<ApplyGate>>,
    dir: State<'_, DataDir>,
    staged_path: String,
    sha256: String,
    version: String,
) -> Result<ApplyOutcome, String> {
    let job = ApplyJob {
        mode: Mode::Update,
        candidate: PathBuf::from(staged_path),
        sha256,
        version,
    };
    run_job(app, Arc::clone(&gate), dir.0.clone(), job).await
}

/// `update_rollback` — вернуть прошлую версию её установщиком из `updates/previous`.
/// Нет прошлого установщика — `rollback_unavailable`.
#[tauri::command]
pub async fn update_rollback(
    app: AppHandle,
    gate: State<'_, Arc<ApplyGate>>,
    dir: State<'_, DataDir>,
) -> Result<ApplyOutcome, String> {
    let layout = Layout::new(&dir.0);
    let info = PreviousStore::new(layout.clone())
        .available()
        .ok_or(ApplyError::RollbackUnavailable.code())?;
    let job = ApplyJob {
        mode: Mode::Rollback,
        candidate: installer_path(&layout, &info),
        sha256: info.sha256,
        version: info.version,
    };
    run_job(app, Arc::clone(&gate), dir.0.clone(), job).await
}

/// `update_health_ok` — UI сообщает: ядро готово и первый кадр нарисован. Пишет
/// `updates/health.json` с версией самого приложения; повтор безвреден.
#[tauri::command]
pub async fn update_health_ok(dir: State<'_, DataDir>) -> Result<(), String> {
    let layout = Layout::new(&dir.0);
    tauri::async_runtime::spawn_blocking(move || {
        HealthStore::new(&layout).write_ok(env!("CARGO_PKG_VERSION"), SystemClock.now_ms())
    })
    .await
    .map_err(|_| "worker_failed".to_string())?
    .map_err(|_| "health_write_failed".to_string())
}

/// `update_previous_info` — описание прошлого установщика (`null`, если отката нет).
#[tauri::command]
pub async fn update_previous_info(dir: State<'_, DataDir>) -> Result<Option<PreviousInfo>, String> {
    let store = PreviousStore::new(Layout::new(&dir.0));
    tauri::async_runtime::spawn_blocking(move || store.available())
        .await
        .map_err(|_| "worker_failed".to_string())
}
