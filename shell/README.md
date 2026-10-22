# shell/ — Tauri 2 оболочка LAVRay

Rust-оболочка на **Tauri 2**: нативный каркас приложения (окно, трей, системная интеграция)
и жизненный цикл Go-ядра.

## Зоны ответственности

- **Жизненный цикл ядра:** запуск бинаря `lavray-core` как дочернего процесса, контроль
  здоровья (heartbeat), перезапуск с экспоненциальной задержкой, гарантированное завершение
  (никаких осиротевших процессов), передача порта/токена ConnectRPC.
- **Нативный каркас:** окно (мин. 960×640), кастомный титл-бар, трей-иконка (шеврон-глиф 16px),
  автозапуск, deep-link `lavray://`, системный прокси, интеграция с Tauri updater
  (см. `../docs/UPDATE-SYSTEM.md`).
- **Шлюз IPC:** UI (React) ↔ команды Tauri ↔ ConnectRPC ядра; стриминг статистики/логов.

## Платформенная упаковка — вне этого репозитория

Оболочка и сборка приложения общие, но упаковка/CI/релизы живут в платформенных репозиториях:
[lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows),
[lavray-linux](https://github.com/anatolijlaptev1991-ctrl/lavray-linux),
[lavray-macos](https://github.com/anatolijlaptev1991-ctrl/lavray-macos),
[lavray-openwrt](https://github.com/anatolijlaptev1991-ctrl/lavray-openwrt)
(там оболочка не нужна — веб-панель из `../ui/`).

## Справочные документы

- `../docs/REQUIREMENTS.md` — раздел 15 «Системная интеграция», раздел 19.
- `../docs/UPDATE-SYSTEM.md` — канал обновлений, подписи, откат.
