# LAVRay

**Русский** · [English](README.en.md) · [中文](README.zh.md) · [Español](README.es.md) · [Deutsch](README.de.md)

[![CI](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml/badge.svg)](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)](core/)
[![Rust](https://img.shields.io/badge/Rust-Tauri%202-DEA584?logo=rust&logoColor=white)](shell/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](ui/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

**LAVRay** — наследник NekoBox/NekoRay: спокойный, профессиональный контроль соединения.
Цель — Windows · Linux · macOS · OpenWrt; сейчас выпускается только сборка для Windows.

Архитектура: **Go-ядро** (форк neko-слоя над sing-box 1.14) + **Rust/Tauri 2 оболочка** +
**единый React UI**: окно приложения на десктопах (работает) и веб-панель на роутере
(ядро раздаёт её и принимает вход по паролю; пакеты OpenWrt — вне этого репозитория).

> **Статус: версия 0.9.2, выпускается только для Windows.** Всё из таблицы ниже есть в
> выпуске. Что ещё не сделано или работает с оговорками — в разделе «В разработке».

---

## Возможности

| Область | Что есть |
|---|---|
| **Подключение** | системный прокси (в том числе для VPN-подключений Windows) или TUN, статус, активный сервер, публичный IP через туннель. Kill switch: в TUN — строгая маршрутизация, в режиме прокси по настройке прокси не снимается при падении ядра. TUN запускается только от администратора (отдельной службы нет) |
| **Серверы** | импорт ссылок (vmess/vless/ss/trojan/hysteria2/tuic/nekoray), файлов, подписок и QR-кода (файл, буфер обмена, снимок экрана) с двухфазным подтверждением; показ QR и экспорт ссылок; TCP-пинг, URL-тест и полный тест; поиск, клонирование, перенос между группами, удаление недоступных и дубликатов, разрешение доменов в IP; свой outbound/config JSON применяется только после подтверждения по diff |
| **Подписки** | создание и обновление (по одной и все сразу), откат обновления подписки, срок и трафик, защита от обновлений, удаляющих больше половины серверов |
| **Маршрутизация** | 5 встроенных пресетов (**LAV Preset RU** с закреплением доменов Riot Games за прокси, CN, Глобальный, Всё через прокси, Всё напрямую) и свои наборы: копия встроенного, правка списков и правил процессов, экспорт и импорт, импорт маршрутов NekoRay, правило из соединения. Выбор применяется при (пере)подключении |
| **DNS** | простой режим (DoH/DoT/локальный/свои серверы), расширенный JSON, раздельный DNS по пресету, FakeIP для TUN |
| **Соединения и трафик** | скорость в строке состояния, активные и закрытые соединения с байтами и правилом, закрытие соединения, учёт трафика по профилям и сессиям |
| **Перенос из NekoBox** | поиск каталога NekoBox, предпросмотр, перенос групп, серверов, цепочек, маршрутов и части настроек; повторный перенос без дублей |
| **Резервная копия** | файл `.lavbk` со всеми данными, включая подписки и секреты, зашифрован паролем (Argon2id + XChaCha20-Poly1305); восстановление заменяет данные целиком |
| **Интеграция с ОС** | автозапуск (у установленной копии — задачей планировщика с правами администратора, чтобы TUN поднимался сразу после входа; переводится в неё сам при запуске от администратора), автоподключение к последнему удачному серверу при запуске, закрытие в трей, запуск свёрнутым, глобальная горячая клавиша, уведомления, системные диалоги открытия и сохранения, запоминание размера и положения окна |
| **Обновления** | центр обновлений: подписанные метаданные и minisign-подпись файлов, загрузка с докачкой, установка с одним запросом UAC, откат. В выпусках 0.9.x пока не настроен (см. «В разработке») |
| **Диагностика** | самопроверки, проверка маршрута адреса, журнал ядра с маскированием секретов, экспорт конфига sing-box (с предупреждением о секретах) |
| **ИИ-агенты** | MCP-сервер `lavray-core mcp` с режимами «Только чтение» и «Чтение и управление»: [`docs/MCP.md`](docs/MCP.md) |
| **Платформы** | Windows: установщик NSIS и portable-архив. Linux: оболочка компилируется и тестируется в CI, пакеты не собирались. macOS: ядро кросс-компилируется, оболочка не собиралась. OpenWrt: ядро `lavray-core-linux-{amd64,arm64}` со встроенной веб-панелью (`--web-bind`) и шлюзом TProxy (`--platform openwrt`) выпускается в релизе; пакетов (procd, LuCI, ipk/apk) пока нет |

## В разработке

Этого ещё нет или работает с оговорками:

- обновления не настроены: центр обновлений готов, но в выпусках нет корня доверия. Его создаёт владелец
  церемонией ключей ([`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) §12.4); до неё экран «Обновления»
  показывает «Обновления не настроены», а новые версии ставятся вручную;
- служба для режима TUN (сейчас — запуск от администратора); полная блокировка трафика при падении ядра
  (WFP) — исследование;
- транспорт XHTTP: ссылки импортируются с пометкой, но ядро такой транспорт не поддерживает;
- ссылки `lavray://` (deep link);
- пакеты Linux (.deb, AppImage) и сборка для macOS;
- пакеты OpenWrt (procd, LuCI, ipk/apk): их спецификация — [`docs/OPENWRT-PACKAGING.md`](docs/OPENWRT-PACKAGING.md), сборка вне этого репозитория;
- подпись кода: установщик не подписан, Windows показывает SmartScreen.

---

## Карта репозиториев

| Репозиторий | Назначение |
|---|---|
| **lavray** (этот) | общая кодовая база: ядро, оболочка, UI, контракты, дизайн-система, пресеты, документация |
| [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows) | Windows: релизы (установщик NSIS и ZIP), инструкция по установке |
| lavray-linux | Linux: .deb + AppImage (закрытый, в разработке, релизов нет) |
| lavray-macos | macOS: .dmg (закрытый, в разработке, релизов нет; без подписи и нотаризации) |
| lavray-openwrt | OpenWrt: procd-сервис, .ipk/.apk, веб-панель, luci-app (закрытый, в разработке, релизов нет) |

---

## Структура

```
proto/       контракт UI ↔ ядро (ConnectRPC): 13 сервисов (число RPC и сообщений — scripts/repo-stats.py)
core/        Go-ядро (CGO-free):
  internal/model        профили/группы/настройки (bean-иерархия NekoBox)
  internal/store        SQLite WAL, права 0700/0600; импортёр каталога NekoBox (store/nekoimport)
  internal/links        парсеры ссылок всех схем (фаззинг-тесты FuzzParseLink, FuzzParseContent)
  internal/subs         подписки, импорт из других клиентов, SSRF-защита
  internal/presets      5 встроенных пресетов + конвертер NekoRay + golden RU
  internal/cfgbuild     конфиг sing-box: golden-тесты, сверка реальным ядром (тег singbox_check в CI)
  internal/inst         менеджер инстанса sing-box (FSM: Idle/Starting/Ready/Stopping/Crashed)
  internal/api          ConnectRPC-сервисы + recover-интерсептор (WebSessionService — только с `--web-bind`)
  internal/traffic      учёт трафика и скорость соединений
  internal/backup       зашифрованная резервная копия (формат LAVBK1)
  internal/textdiff     diff для подтверждения своего JSON
  internal/web          веб-панель: вход (Argon2id), сессии, CSRF/Origin, лимитер, TLS, раздача ui/dist (флаг `--web-bind`)
  internal/logs         мультиплексор логов + маскирование секретов
  internal/updates      клиент обновлений TUF-lite + minisign: проверка, загрузка, staging
  internal/gateway      шлюз OpenWrt: nftables-рендер, per-MAC, watchdog (включается `--platform openwrt`)
  internal/headless     сервисный режим без UI (--headless): автозапуск последнего профиля, авторестарт
  internal/mcp          MCP-сервер для ИИ-агентов (lavray-core mcp, по stdio): docs/MCP.md
  cmd/lavray-core       процесс ядра: спавн-протокол оболочки (§3), однократное автоподключение (`serve --connect-last`)
shell/       Rust/Tauri 2: жизненный цикл ядра, системный прокси, трей, автозапуск, горячие клавиши,
             уведомления, диалоги, установка обновлений и откат
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

Скрипт есть, но пакеты на Linux не собирались и не проверялись: CI только компилирует и
тестирует оболочку (ubuntu-24.04).

### macOS

```bash
./shell/build.sh     # .app + .dmg (универсальный: --target universal-apple-darwin)
```

Не собиралось ни в CI, ни вручную; ядро кросс-компилируется под darwin/arm64.

> Сборки v1 **неподписаны** (решение владельца): Windows покажет SmartScreen,
> macOS — Gatekeeper. Инструкция по установке для Windows — в README
> [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows).
> Целостность артефактов проверяется по `SHA256SUMS.txt` из релиза. Подписанные метаданные
> и minisign-подписи появятся после церемонии ключей: подпись в CI готова, ключей пока нет
> (`docs/UPDATE-SYSTEM.md`, «Статус реализации»).

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

- Обновления (`internal/updates`, `shell/src/update`): метаданные TUF-lite (подписи ed25519,
  монотонный serial, срок timestamp ≤7 дней, защита от downgrade) и minisign-подпись каждого
  файла; перед установкой файл проверяется ещё раз. Доверенный корневой ключ один (порог 1,
  «2-из-3» — следующая фаза, `docs/UPDATE-SYSTEM.md` §3.1). В выпусках 0.9.x корня доверия
  нет, поэтому обновления не настроены.
- Свой outbound/config JSON применяется только после подтверждения по diff; подтверждение
  привязано к хэшу содержимого, и любая правка его снимает.
- Резервная копия зашифрована паролем (Argon2id + XChaCha20-Poly1305); забытый пароль не
  восстановить.
- Секреты маскируются в журнале при приёме строки (`logs.Redact`).
- Подписки: SSRF-защита (приватные адреса, закрепление IP против DNS-rebinding), лимит
  размера ответа, custom-поля из подписок и ссылок отбрасываются.
- Веб-панель (`--web-bind`): пароли Argon2id, cookie `HttpOnly; SameSite=Strict` (+`Secure` по
  HTTPS), CSRF-заголовок и проверка Origin, ограничитель попыток по учётной записи, адресу и общий,
  самоподписанный TLS (`--web-tls`) со стабильным отпечатком. Не-loopback адрес — только с
  `--web-allow-remote`. По HTTP интерфейс показывает «Не защищено». Первичная настройка на
  не-loopback адресе требует одноразовый код из файла `web-setup-code` в каталоге данных
  (права 0600), поэтому администратора не займёт случайный клиент сети.

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
- [`docs/HISTORY-REWRITE.md`](docs/HISTORY-REWRITE.md) — перезапись истории и хэши выпусков
- [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) — чек-лист выпуска
- [`docs/RELEASE-NOTES-windows-v0.9.2.md`](docs/RELEASE-NOTES-windows-v0.9.2.md) — что нового в 0.9.2
- [`docs/stage3/core-port-plan.md`](docs/stage3/core-port-plan.md) — план W1–W8
- [`docs/rust-migration/`](docs/rust-migration/) — план переноса ядра на Rust (черновик)

## Лицензия

[GPL-3.0](LICENSE). Производная nekoray (GPL-3.0) и sing-box; версия ядра
указывается в «О программе → Лицензии и компоненты». Исходные файлы помечены строкой
`SPDX-License-Identifier: GPL-3.0-only` (`python scripts/add-spdx.py --check`).

