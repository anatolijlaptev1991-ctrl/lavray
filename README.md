# LAVRay

[![CI](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml/badge.svg)](https://github.com/anatolijlaptev1991-ctrl/lavray/actions/workflows/ci.yml)

**LAVRay** — кроссплатформенный наследник NekoBox/NekoRay: спокойный, профессиональный
контроль соединения. Windows / Linux / macOS / OpenWrt.

Архитектура: **Go-ядро** (форк neko-слоя над sing-box) + **Rust/Tauri 2 оболочка** +
**единый React UI в двух режимах** (окно приложения на десктопах, веб-панель на OpenWrt).

## Карта репозиториев

| Репозиторий | Назначение |
|---|---|
| **lavray** (этот) | общая кодовая база: ядро, оболочка, UI, контракты, дизайн-система, пресеты, документация |
| [lavray-windows](https://github.com/anatolijlaptev1991-ctrl/lavray-windows) | Windows: NSIS+ZIP, трей, системный прокси, TUN/UAC, CI, релизы |
| [lavray-linux](https://github.com/anatolijlaptev1991-ctrl/lavray-linux) | Linux: .deb + AppImage, GNOME/KDE, CI-контейнеры, релизы |
| [lavray-macos](https://github.com/anatolijlaptev1991-ctrl/lavray-macos) | macOS: универсальный бинарь, .dmg, codesign + notarization |
| [lavray-openwrt](https://github.com/anatolijlaptev1991-ctrl/lavray-openwrt) | OpenWrt: procd-сервис, .ipk, веб-панель, luci-app, opkg-feed |

## Структура каталогов

```
proto/     .proto контракты API UI ↔ ядро (ConnectRPC)
core/      Go-ядро: порт nekoray/go + ConfigBuilder; NEKO_PATCHES.md — реестр neko-патчей
           (sing-box: форк anatolijlaptev1991-ctrl/sing-box, пин 628a9ed = 1.14.1-neko.1)
shell/     Rust/Tauri 2 оболочка: окно, трей, жизненный цикл ядра
ui/        React+TS: единый UI двух режимов; токены из DESIGN-SYSTEM
presets/   встроенные маршрутные пресеты: lav-ru/lav-cn/global/all-proxy/all-direct (.json, формат LAVRay) + SCHEMA.md + исходник lav-ru.source.json
design/    интерактивный прототип v1.2 (prototype.html) + приёмочные скрипты (tools/) + 23 эталонных скриншота приёмки (shots/)
docs/      требования (281 FR), аудит, баги, дизайн-система v1.2, обновления TUF-lite v2.0, threat-model, security, test-plan, fix-plan аудита Claude, отчёты
docs/stage3/ контракты и планы Этапа 3: proto-контракт (13 сервисов/85 RPC), core-port-plan W1–W8, shell-lifecycle, CI-черновики
```

## Статус

**Этап 2 из плана завершён:** дизайн-система v1.1 утверждена владельцем, интерактивный
прототип построен и прошёл визуальное + i18n-ревью, аудит кода NekoBox/sing-box и каталог
багов готовы как входные данные. Реализация (Этап 3) ведётся по Доктрине качества.

## Документация

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — каталог функциональных требований UI (реверс-инжиниринг NekoBox, MUST/NICE).
- [`docs/AUDIT.md`](docs/AUDIT.md) — аудит Go-ядра NekoBox и связки с UI.
- [`docs/BUGS.md`](docs/BUGS.md) — каталог багов и проблем качества NekoBox (LNB-NN).
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — дизайн-система v1.2: знак «Отражение», палитры, компоненты, экраны, i18n, доступность.
- [`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) — система обновлений TUF-lite v2.0: root 2-из-3 (фаза 1 — 1 ключ), timestamp/manifest/sources, откат.
- [`docs/PRESET-LAV-RU.md`](docs/PRESET-LAV-RU.md) — анализ и план интеграции пресета «LAV Preset RU».
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — 281 FR + DROP-каталог; решения владельца 2026-10-23 (XHTTP, внешние ядра, Happ, неподписанные сборки) — в тексте.
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md), [`docs/SECURITY.md`](docs/SECURITY.md), [`docs/OPENWRT-GATEWAY.md`](docs/OPENWRT-GATEWAY.md), [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md), [`docs/LICENSES.md`](docs/LICENSES.md), [`docs/PLATFORM-MATRIX.md`](docs/PLATFORM-MATRIX.md), [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md).
- [`docs/FIX-REPORT.md`](docs/FIX-REPORT.md) — исполнение и приёмка fix-plan аудита Claude (A1–A22/B/C1–C10, выводы скриптов).
- [`docs/stage3/`](docs/stage3/) — планы Этапа 3: core-port-plan (W1–W8), shell-lifecycle, CI-черновики; ревью — `docs/REVIEW-STAGE3-DRAFTS.md`.

## Принципы Доктрины качества

1. **Ноль критичных/мажорных замечаний.** Всё вне ядра sing-box проходит рекурсивные циклы
   «аудит → исправление → повторный аудит» до полного нуля critical/major.
2. **Три уровня проверки.** Машинный (тесты, линтеры, фаззинг, бенчмарки с бюджетами) →
   adversarial-ревью → визуальный (visual-judge по эталонным скриншотам).
3. **Контракты и golden-тесты.** UI ↔ ядро — только через `.proto` (ConnectRPC);
   генерация конфигов sing-box фиксируется golden-тестами.
4. **Качество видно в CI.** Контрасты WCAG AA, тесты 5 локалей, тайминги запуска —
   проверяются автоматически, не «на глаз».
5. **Обновления не ломают туннель.** Строгий гейт обновления ядра: аудит changelog, лицензия
   upstream, перенос neko-патчей по `core/NEKO_PATCHES.md`, smoke-тесты коннективности,
   откат всегда возможен (`docs/UPDATE-SYSTEM.md`).

## Лицензия

[GPL-3.0](LICENSE). Учитывает лицензии upstream: nekoray (GPL-3.0) и sing-box.
