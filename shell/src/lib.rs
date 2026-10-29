//! Библиотечная часть оболочки LAVRay (этап 3, скаффолд).
//!
//! Спек: `docs/stage3/shell-lifecycle.md` (§10 — каркас крейта). GUI-часть
//! (окно/трей/рантайм) живёт в `main.rs` на Tauri 2; вся логика жизненного
//! цикла вынесена сюда и тестируется без запуска GUI.
//!
//! Модули:
//! - [`coreproc`] — FSM жизненного цикла Go-ядра `lavray-core` (§2), backoff,
//!   пайп логов (§4), детекторы teardown-проверки сети (§6, заглушки);
//!   интеграция с процессом — через трейт [`coreproc::CoreProcess`]
//!   (продакшн-реализация — позже, в тестах — [`coreproc::MockCoreProcess`]);
//! - [`endpoint`] — адрес/токен ядра для UI, событие `core-endpoint` и цикл
//!   надзирателя, перезапускающий ядро и снимающий системный прокси (T-03);
//! - [`integrity`] — сверка SHA-256 ядра с вшитым при сборке (T-44);
//! - [`tray`] — конфигурация меню трея (§9), проверяемая без GUI;
//! - [`uiprotocol`] — протокол UI ↔ shell (команды/события, serde, версия
//!   протокола);
//! - [`updater`] — автомат состояний автообновления TUF-lite (§8.3), без сети.
//!
//! ПЛАН: имя `ipc` свободно под нижний канал shell ↔ ядро — Connect-клиент
//! (UDS/named pipe из ready-строки §3.4, JSON-кодировка, Bearer-auth-токен
//! §3.2; CoreService.Disconnect/Shutdown для лестницы §5) — будущий
//! `src/ipc.rs` по дереву §10, реализация при врезке реального ядра.

pub mod coreproc;
pub mod endpoint;
pub mod integrity;
pub mod sysproxy;
pub mod tray;
pub mod uiprotocol;
pub mod updater;
