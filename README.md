# LAVRay

[![CI](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml/badge.svg)](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)](core/)
[![Rust](https://img.shields.io/badge/Rust-Tauri%202-DEA584?logo=rust&logoColor=white)](shell/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](ui/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

**LAVRay** — наследник NekoBox/NekoRay: спокойный, профессиональный контроль соединения.
Цель — Windows · Linux · macOS · OpenWrt; сейчас выпускается только сборка для Windows.

Архитектура: **Go-ядро** (форк neko-слоя над sing-box 1.14) + **Rust/Tauri 2 оболочка** +
**единый React UI**: окно приложения на десктопах (работает) и веб-панель на роутере
(в разработке).

> **Статус: ранняя версия.** Установленное приложение (NSIS) запускает окно, оболочка
> поднимает Go-ядро, UI общается с ним по ConnectRPC, а соединение через mixed-вход
> пропускает трафик (проверка — тест `TestSingBoxRunnerSurvivesStartContextCancel`, job
> `core-run` в CI). Что готово и что нет — в таблице и списке ниже.

---

## Возможности

| Область | Что есть |
|---|---|
| **Подключение** | системный прокси или TUN, статус, активный сервер; TUN запускается только от администратора (отдельной службы нет) |
| **Серверы** | импорт ссылок (vmess/vless/ss/trojan/hysteria2/tuic/nekoray), файлов и подписок, двухфазное подтверждение, экспорт ссылок, поиск, удаление |
| **Подписки** | создание и обновление, срок и трафик, защита от обновлений, удаляющих больше половины серверов |
| **Маршрутизация** | 5 встроенных пресетов (**LAV Preset RU** с Riot-пином, CN, Глобальный, всё-через-прокси, всё-напрямую); выбор применяется при (пере)подключении |
| **DNS** | простой режим (DoH/DoT/локальный/свои серверы), расширенный JSON, раздельный DNS по пресету, FakeIP для TUN |
| **Диагностика** | самопроверки, проверка маршрута адреса, публичный IP, журнал ядра с маскированием секретов |
| **Платформы** | Windows: установщик NSIS и portable-архив. Linux и macOS: ядро кросс-компилируется, пакеты не выпускались. OpenWrt: есть режим `--headless`, пакетов и веб-панели нет |

## В разработке

Этих возможностей в приложении ещё нет (кнопки и разделы могут быть видны, но действие не выполняют):

- обновление приложения: проверка подписей есть как библиотека, но не подключена к ядру; установки и отката нет;
- веб-панель и пакеты OpenWrt (procd, LuCI, ipk/apk);
- импорт по QR-коду и перенос данных из NekoBox;
- список соединений, график и счётчики трафика;
- создание и правка своих наборов маршрутов;
- служба для режима TUN (сейчас — запуск от администратора);
- интеграция с ОС: автозапуск, глобальные горячие клавиши, уведомления, нативные диалоги;
- настоящая резервная копия (сейчас экспортируются только настройки, без шифрования);
- URL- и полный тест соединения серверов (работает TCP-пинг).

---

## Карта репозиториев

| Репозиторий | Назначение |
|---|---|
| **lavray** (этот) | общая кодовая база: ядро, оболочка, UI, контракты, дизайн-система, пресеты, документация |
| [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows) | Windows: релизы (установщик NSIS и ZIP), инструкция по установке |
| [lavray-linux](https://github.com/anatolijlaptev1991-ctrl/lavray-linux) | Linux: .deb + AppImage (в разработке, релизов нет) |
| [lavray-macos](https://github.com/anatolijlaptev1991-ctrl/lavray-macos) | macOS: .dmg (в разработке, релизов нет; без подписи и нотаризации) |
| [lavray-openwrt](https://github.com/anatolijlaptev1991-ctrl/lavray-openwrt) | OpenWrt: procd-сервис, .ipk/.apk, веб-панель, luci-app (в разработке, релизов нет) |

---

## Структура

```
proto/       контракт UI ↔ ядро (ConnectRPC): 13 сервисов (число RPC и сообщений — scripts/repo-stats.py)
core/        Go-ядро (CGO-free):
  internal/model        профили/группы/настройки (bean-иерархия NekoBox)
  internal/store        SQLite WAL, права 0700/0600; импортёр каталога NekoBox (в приложении не подключён)
  internal/links        парсеры ссылок всех схем (фаззинг-тесты FuzzParseLink, FuzzParseContent)
  internal/subs         подписки, импорт из других клиентов, SSRF-защита
  internal/presets      5 встроенных пресетов + конвертер NekoRay + golden RU
  internal/cfgbuild     конфиг sing-box: golden-тесты, сверка реальным ядром (тег singbox_check в CI)
  internal/inst         менеджер инстанса sing-box (FSM: Idle/Starting/Ready/Stopping/Crashed)
  internal/api          ConnectRPC-сервисы + recover-интерсептор (часть RPC — заглушки)
  internal/web          логика входа веб-панели (пакет есть, к ядру не подключён)
  internal/logs         мультиплексор логов + маскирование секретов
  internal/updates      клиент проверки обновлений TUF-lite (библиотека, к ядру не подключена)
  internal/gateway      шлюз OpenWrt: nftables-рендер, per-MAC, watchdog (пакет есть, к ядру не подключён)
  internal/headless     сервисный режим без UI (--headless): автозапуск последнего профиля, авторестарт
  internal/mcp          MCP-сервер для ИИ-агентов (lavray-core mcp, по stdio): docs/MCP.md
  cmd/lavray-core       процесс ядра: спавн-протокол оболочки (§3)
shell/       Rust/Tauri 2: FSM жизненного цикла, драйвер процесса ядра, IPC
ui/          React + TS: 10 экранов, 5 языков (ru/en/zh/es/de), токены DS v1.2
presets/     встроенные пресеты (lav-ru/lav-cn/global/all-proxy/all-direct)
design/      прототип v1.2 + приёмочные скрипты + скриншоты
docs/        требования (FR-UI-001…281), аудит, баги, DS, обновления, безопасность
scripts/     служебные скрипты: проверки документов, SPDX-заголовки, факты о репозитории
```

---

## Сборка

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File shell\build.ps1
```

Скрипт делает: `npm ci && npm run build` (UI) → `go build` (ядро, CGO-free) →
`cargo tauri build --bundles nsis`. Результат:
`shell\target\release\bundle\nsis\LAVRay_<ver>_x64-setup.exe`.

Требования: Go 1.27+, Node 24 (как в CI), Rust stable (проверено на 1.96), WebView2 (в Windows 10/11 из коробки).

### Linux

```bash
./shell/build.sh     # .deb + AppImage
```

### macOS

```bash
./shell/build.sh     # .app + .dmg (универсальный: --target universal-apple-darwin)
```

> Сборки v1 **неподписаны** (решение владельца): Windows покажет SmartScreen,
> macOS — Gatekeeper. Инструкции по запуску — в README платформенных репозиториев.
> Целостность артефактов проверяется по `SHA256SUMS.txt` из релиза; подписанных
> манифестов и minisign-подписей пока нет (см. `docs/UPDATE-SYSTEM.md`, «Статус реализации»).

### Разработка

```bash
cd ui && npm run dev            # UI в браузере (ядро нужно запустить отдельно)
cd ui && npx vitest run         # тесты UI
cd core && go test ./...        # тесты ядра
cd shell && cargo test          # тесты оболочки
python scripts/repo-stats.py    # проверяемые числа: контракт, заглушки, ключи словарей
```

---

## Безопасность

- Автообновление в приложении пока не работает. Библиотека проверки (`internal/updates`,
  TUF-lite: подписи ed25519, монотонный serial, срок timestamp ≤7 дней, защита от
  downgrade) есть и покрыта тестами, но к ядру не подключена; доверенный ключ сейчас
  один (порог 2-из-3 — следующая фаза, `docs/UPDATE-SYSTEM.md` §3.1).
- Секреты маскируются в журнале при приёме строки (`logs.Redact`).
- Подписки: SSRF-защита (приватные адреса, закрепление IP против DNS-rebinding), лимит
  размера ответа, custom-поля из подписок и ссылок отбрасываются.
- Веб-панель: в разработке. Логика входа (PBKDF2, HttpOnly/SameSite=Strict, CSRF + Origin,
  backoff, привязка только к loopback без `web.allow_remote`) лежит в `internal/web`, но
  в ядро не подключена; HTTPS и Argon2id — в планах.

Политика и контакты: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Документация

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — 281 FR
- [`docs/BUGS.md`](docs/BUGS.md) — каталог LNB-багов и их закрытие
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — дизайн-система v1.2
- [`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) — TUF-lite v2.0
- [`docs/MCP.md`](docs/MCP.md) — доступ ИИ-агентов (Claude Desktop, Claude Code, Cursor)
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) · [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md)
- [`docs/FIX-REPORT.md`](docs/FIX-REPORT.md) — приёмка аудита
- [`docs/stage3/core-port-plan.md`](docs/stage3/core-port-plan.md) — план W1–W8

## Лицензия

[GPL-3.0](LICENSE). Производная nekoray (GPL-3.0) и sing-box; версия ядра
указывается в «О программе → Лицензии». Исходные файлы помечены строкой
`SPDX-License-Identifier: GPL-3.0-only` (`python scripts/add-spdx.py --check`).
Скрипт есть, но пакеты на Linux не собирались и не проверялись: CI только компилирует
оболочку (ubuntu-24.04).

Не собиралось ни в CI, ни вручную; ядро кросс-компилируется под darwin/arm64.

