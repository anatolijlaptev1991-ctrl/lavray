// SPDX-License-Identifier: GPL-3.0-only

//! Адаптеры установки к живому приложению: остановка ядра через надзирателя,
//! снятие системного прокси штатной логикой `sysproxy`, выход приложения.
//! Привязаны к Tauri и ОС, поэтому в модульных тестах не участвуют: порядок
//! шагов проверяется на подставках в `prepare`.

use super::prepare::{CoreController, ProxyReleaser};
use crate::coreproc::runner::SupervisorHandle;
use crate::launch::ARG_WAIT_PID;
use crate::sysproxy::SysProxy;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// Сколько ждать остановки ядра: лестница §5 — до 15 с, как при выходе.
const CORE_STOP_WAIT: Duration = Duration::from_secs(16);
/// Период опроса «надзор закончен».
const STOP_POLL: Duration = Duration::from_millis(50);
/// Пауза перед выходом: ответ команды должен дойти до окна.
pub const EXIT_DELAY: Duration = Duration::from_millis(1500);

/// Ядро под надзирателем приложения.
pub struct SupervisorCore {
    app: AppHandle,
}

impl SupervisorCore {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl CoreController for SupervisorCore {
    fn stop(&self) -> Result<(), String> {
        let Some(supervisor) = self.app.try_state::<Arc<SupervisorHandle>>() else {
            return Ok(()); // ядра под надзором нет — останавливать нечего
        };
        supervisor.stop();
        let deadline = Instant::now() + CORE_STOP_WAIT;
        while !supervisor.is_stopped() {
            if Instant::now() >= deadline {
                return Err("ядро не остановилось за отведённое время".to_string());
            }
            std::thread::sleep(STOP_POLL);
        }
        Ok(())
    }

    /// Надзиратель после остановки завершён и заново не запускается, поэтому
    /// ядро возвращается перезапуском самой оболочки: новый экземпляр ждёт
    /// выхода этого (`--wait-pid`), поднимает ядро и окно.
    fn restart(&self) {
        let spawned = std::env::current_exe().and_then(|exe| {
            std::process::Command::new(exe)
                .arg(format!("{ARG_WAIT_PID}={}", std::process::id()))
                .spawn()
        });
        match spawned {
            Ok(_) => schedule_exit(&self.app),
            Err(e) => eprintln!("LAVRay: не удалось перезапустить оболочку: {e}"),
        }
    }
}

/// Снятие системного прокси так же, как при выходе из приложения.
pub struct SysProxyReleaser {
    pub data_dir: PathBuf,
}

impl ProxyReleaser for SysProxyReleaser {
    fn release(&self) -> Result<(), String> {
        SysProxy::new(&self.data_dir).release_on_quit()
    }
}

/// Выйти через [`EXIT_DELAY`]: ядро и прокси уже сняты, остальное прибирает
/// событие `Exit` (повторное снятие прокси, файл доступа агентов).
pub fn schedule_exit(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(EXIT_DELAY);
        app.exit(0);
    });
}
