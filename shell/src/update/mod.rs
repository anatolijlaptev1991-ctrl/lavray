// SPDX-License-Identifier: GPL-3.0-only

//! Установка обновлений оболочкой (T-75, Э-4). Ядро скачивает и проверяет
//! подпись, кладёт установщик в `<data>/updates/staging/<sha256>-<имя>`; здесь
//! его повторно проверяют, останавливают ядро, снимают системный прокси и
//! запускают NSIS с повышением (`/S`), а копия старого exe (watchdog) следит,
//! чтобы новая версия отметилась здоровьем за [`crate::updater::HEARTBEAT_GRACE`],
//! иначе откатывает прежним установщиком.
//!
//! Всё, что трогает ОС (UAC, процессы, открытие с блокировкой), стоит за
//! трейтами; настоящие реализации крошечные и лежат в `cfg(windows)`-файлах,
//! тесты работают только с подставками.
//!
//! Модули (по одной ответственности):
//! - [`layout`] — пути каталога `<data>/updates`;
//! - [`error`] — стабильные коды ошибок и исход `update_apply`;
//! - [`hash`] — потоковый SHA-256, hex, сравнение за постоянное время;
//! - [`paths`] — путь только внутри каталога после канонизации;
//! - [`verify`] — `verify_locked`: открытие с запретом записи и хэш того же дескриптора;
//! - [`install`] — трейт `Elevator` и запуск установщика с `/S`;
//! - [`previous`] — один прошлый установщик для отката и `previous.json`;
//! - [`heartbeat`] — `health.json` и вердикт «здоровье отмечено»;
//! - [`watchdog`] — решение «ждать / здоров / откат» и цикл режима `--update-watchdog`;
//! - [`gate`] — замок «установка идёт»; [`ports`] — трейты установки (ядро, прокси, watchdog);
//! - [`prepare`] — порядок «проверить → остановить ядро → снять прокси → запустить»;
//! - [`rollback`] — запуск прошлого установщика;
//! - [`stage`] — копия выбранного пользователем установщика в staging;
//! - [`pick`] — диалог «Из файла» и копия выбранного установщика (путь не от страницы);
//! - [`wiring`] — Tauri-команды и общее состояние; [`watchdog_entry`] — вход режима watchdog.

pub mod clock;
pub mod error;
pub mod gate;
pub mod hash;
pub mod heartbeat;
pub mod install;
pub mod layout;
pub mod paths;
pub mod pick;
pub mod ports;
pub mod prepare;
pub mod previous;
pub mod real;
pub mod rollback;
pub mod stage;
pub mod verify;
pub mod watchdog;
pub mod watchdog_args;
pub mod watchdog_entry;
pub mod wiring;

mod app_adapters;
#[cfg(windows)]
mod proc_win;
#[cfg(windows)]
mod runas_win;

#[cfg(test)]
mod testkit;
