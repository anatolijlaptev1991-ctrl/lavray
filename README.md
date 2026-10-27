# LAVRay

[![CI](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml/badge.svg)](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go&logoColor=white)](core/)
[![Rust](https://img.shields.io/badge/Rust-Tauri%202-DEA584?logo=rust&logoColor=white)](shell/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](ui/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

**LAVRay** — кроссплатформенный наследник NekoBox/NekoRay: спокойный, профессиональный
контроль соединения. Windows · Linux · macOS · OpenWrt.

Архитектура: **Go-ядро** (форк neko-слоя над sing-box 1.14) + **Rust/Tauri 2 оболочка** +
**единый React UI в двух режимах** — окно приложения на десктопах и веб-панель на роутере.

> **Статус: работает end-to-end.** Установленное приложение (NSIS) запускает окно,
> оболочка поднимает Go-ядро, UI общается с ним по ConnectRPC. Все пять разделов
> подключены к живому ядру.

---

## Возможности

| Область | Что есть |
|---|---|
| **Подключение** | системный прокси / TUN, статус в реальном времени, активный сервер |
| **Серверы** | импорт ссылок (vmess/vless/ss/trojan/hysteria2/tuic/**happ**/nekoray), двухфазное подтверждение, экспорт, поиск, удаление |
| **Подписки** | обновление с diff-флоу, снапшот, откат, защита от деструктивных обновлений |
| **Маршрутизация** | 5 встроенных пресетов (**LAV Preset RU** с Riot-пином, CN, Глобальный, всё-через-прокси, всё-напрямую), активация на лету |
| **DNS** | 3 режима (simple / advanced JSON / dns-routing), DoH/DoT, FakeIP |
| **Диагностика** | самопроверки, проверка маршрута адреса, публичный IP, журнал с redact секретов |
| **Обновления** | TUF-lite: root → timestamp → manifest, подписи ed25519, порог 2-из-3, ротация и отзыв ключей, защита от downgrade |
| **Платформы** | Windows (NSIS/MSI), Linux (.deb/AppImage), macOS (.dmg), OpenWrt (ipk + LuCI + веб-панель) |

---

## Карта репозиториев

| Репозиторий | Назначение |
|---|---|
| **lavray** (этот) | общая кодовая база: ядро, оболочка, UI, контракты, дизайн-система, пресеты, документация |
| [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows) | Windows: NSIS+ZIP, трей, системный прокси, TUN/UAC, CI, релизы |
| [lavray-linux](https://github.com/anatolijlaptev1991-ctrl/lavray-linux) | Linux: .deb + AppImage, GNOME/KDE, CI-контейнеры, релизы |
| [lavray-macos](https://github.com/anatolijlaptev1991-ctrl/lavray-macos) | macOS: универсальный бинарь, .dmg, codesign + notarization |
| [lavray-openwrt](https://github.com/anatolijlaptev1991-ctrl/lavray-openwrt) | OpenWrt: procd-сервис, .ipk, веб-панель, luci-app, opkg-feed |

---

## Структура

```
proto/       контракт UI ↔ ядро (ConnectRPC): 13 сервисов, 85 RPC, 182 сообщения
core/        Go-ядро (CGO-free):
  internal/model        профили/группы/настройки (bean-иерархия NekoBox)
  internal/store        SQLite WAL, права 0700/0600, импортёр каталога NekoBox
  internal/links        парсеры ссылок всех схем (фаззинг 2М+ исполнений)
  internal/subs         подписки, happ-расшифровка (LNB-13 фикс), SSRF-защита
  internal/presets      5 builtin-пресетов + конвертер NekoRay + golden RU
  internal/cfgbuild     конфиг sing-box: 37 golden, верифицированы реальным ядром
  internal/inst         менеджер инстанса (FSM, авторестарт)
  internal/api          ConnectRPC-сервисы + recover-интерсептор
  internal/web          веб-панель: вход, cookie-сессии, CSRF, bind-политика
  internal/logs         мультиплексор логов + redact секретов
  internal/updates      TUF-lite клиент (подписи, ротация, анти-downgrade)
  internal/gateway      шлюз OpenWrt: nftables-рендер, per-MAC, watchdog
  internal/headless     сервисный режим без UI
  cmd/lavray-core       процесс ядра: спавн-протокол оболочки (§3)
shell/       Rust/Tauri 2: FSM жизненного цикла, драйвер процесса ядра, IPC
ui/          React+TS: 5 боевых экранов, i18n 765 ключей ×5, токены DS v1.2
presets/     встроенные пресеты (lav-ru/lav-cn/global/all-proxy/all-direct)
design/      прототип v1.2 + приёмочные скрипты + 23 скриншота
docs/        требования (281 FR), аудит, баги, DS, обновления, безопасность
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

Требования: Go 1.27+, Node 22+, Rust 1.80+, WebView2 (в Windows 10/11 из коробки).

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
> Целостность артефактов обеспечивается minisign + sha256 из подписанного манифеста.

### Разработка

```bash
cd ui && npm run dev            # UI отдельно (веб-режим)
cd core && go test ./...        # 17 пакетов тестов
cd shell && cargo test          # 56 тестов
```

---

## Безопасность

- Автообновления — только с проверкой подписи ed25519 (TUF-lite: root 2-из-3,
  timestamp ≤7 дней, монотонный serial, защита от downgrade).
- Секреты не попадают в логи (`redact()` на уровне мультиплексора).
- Подписки: SSRF-защита (приватные адреса, DNS-rebinding пиннинг), лимиты размера,
  custom-поля не применяются без явного подтверждения.
- Веб-панель: PBKDF2-вход, HttpOnly/SameSite=Strict, CSRF + Origin, backoff,
  bind только loopback без `web.allow_remote`.

Политика и контакты: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Документация

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — 281 FR
- [`docs/BUGS.md`](docs/BUGS.md) — каталог LNB-багов и их закрытие
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — дизайн-система v1.2
- [`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) — TUF-lite v2.0
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) · [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md)
- [`docs/FIX-REPORT.md`](docs/FIX-REPORT.md) — приёмка аудита
- [`docs/stage3/core-port-plan.md`](docs/stage3/core-port-plan.md) — план W1–W8

## Лицензия

[GPL-3.0](LICENSE). Производная nekoray (GPL-3.0) и sing-box; версия ядра
указывается в «О программе → Лицензии».
