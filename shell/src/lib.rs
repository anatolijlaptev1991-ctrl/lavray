// SPDX-License-Identifier: GPL-3.0-only

// Обоснованные исключения pedantic (аудит Linux-180, секция A/K):
// - Tauri IPC требует owned-типы (String/AppHandle) для десериализации команд;
// - Win32 FFI требует точных ширин整数 (usize→u32 для DWORD);
// - Result-типы самодокументируемы, варианты ошибок описаны на уровне модуля;
// - state-структуры естественно содержат >3 bool-флагов.
#![allow(clippy::needless_pass_by_value)] // Tauri IPC: owned types required
#![allow(clippy::cast_possible_truncation)] // Win32 FFI: DWORD = u32
#![allow(clippy::cast_sign_loss)] // Win32 FFI: LONG → DWORD
#![allow(clippy::cast_possible_wrap)] // Win32 FFI: RECT coordinates
#![allow(clippy::missing_errors_doc)] // Result variants documented at module level
#![allow(clippy::missing_panics_doc)] // panics documented inline with SAFETY
#![allow(clippy::must_use_candidate)] // not all pure fns need must_use
#![allow(clippy::struct_excessive_bools)] // state flags are natural
#![allow(clippy::doc_markdown)] // backticks not needed for all identifiers
#![allow(unknown_lints)] // forward-compat: новые линты clippy (assert_is_empty в 1.100)
#![allow(clippy::assert_is_empty)] // assert!(x.is_empty()) в тестах идиоматичен

//! Библиотечная часть оболочки `LAVRay` (этап 3, скаффолд).
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
//! - [`endpoint`] — адрес/токен ядра для UI, событие `core-endpoint` и адаптер
//!   к циклу надзора `coreproc::runner` (T-56): публикует адрес, шлёт событие
//!   и снимает системный прокси при смерти ядра (T-03);
//! - [`integrity`] — сверка SHA-256 ядра с вшитым при сборке (T-44);
//! - `oemtext` (только Windows) — вывод консольных программ (`reg.exe`) из OEM-
//!   кодовой страницы в строку (S-02);
//! - [`tray`] — конфигурация меню трея (§9), проверяемая без GUI;
//! - [`elevation`] — запущено ли приложение с повышенными правами (T-46) и
//!   перезапуск от администратора (T-81);
//! - [`killswitch`] — не снимать системный прокси при падении ядра, если так
//!   настроено; отключение и выход снимают его всегда (хвосты B);
//! - [`launch`] — аргументы запуска `--tray`, `--elevated-relaunch`,
//!   `--wait-pid` и ожидание выхода прежнего экземпляра (T-81, T-82);
//! - [`token`] — SID пользователя и тип повышения токена процесса (T-81, T-82);
//! - [`single_instance`] — проверка мьютекса single-instance между разными
//!   уровнями прав (T-81);
//! - [`profile`] — отдельный каталог данных `WebView` повышенного экземпляра (T-81);
//! - [`ui_state`] — общий файл настроек UI `ui-state.json` для обоих профилей
//!   `WebView` (T-81);
//! - [`agent`] — доступ ИИ-агентов (MCP): агентский токен ядра и файл
//!   `agent-endpoint.json` с защищённым дескриптором (MCP);
//! - [`msgbox`] — сообщения до появления окна (T-81);
//! - [`autostart`] — автозапуск с системой: задача планировщика или `Run`
//!   в реестре, команды — через внедряемый исполнитель (T-82);
//! - [`uiprotocol`] — протокол UI ↔ shell (команды/события, serde, версия
//!   протокола);
//! - [`updater`] — автомат состояний автообновления TUF-lite (§8.3), без сети;
//! - [`update`] — установка подписанных обновлений: повторная проверка под
//!   блокировкой, остановка ядра, UAC, откат по heartbeat (T-75).
//!
//! ПЛАН: имя `ipc` свободно под нижний канал shell ↔ ядро — Connect-клиент
//! (UDS/named pipe из ready-строки §3.4, JSON-кодировка, Bearer-auth-токен
//! §3.2; CoreService.Disconnect/Shutdown для лестницы §5) — будущий
//! `src/ipc.rs` по дереву §10, реализация при врезке реального ядра.

pub mod agent;
pub mod autostart;
pub mod capture;
pub mod coreproc;
pub mod elevation;
pub mod endpoint;
pub mod files;
pub mod hotkey;
pub mod integrity;
pub mod killswitch;
pub mod launch;
pub mod msgbox;
pub mod notify;
#[cfg(windows)]
mod oemtext;
pub mod os_integration;
pub mod prefs;
mod private_file;
pub mod profile;
pub mod single_instance;
pub mod sysproxy;
pub mod token;
pub mod tray;
pub mod ui_state;
pub mod uiprotocol;
pub mod update;
pub mod updater;
pub mod window_geometry;
pub mod window_policy;
