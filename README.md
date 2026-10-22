# LAVRay

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
presets/   встроенные маршрутные пресеты (lav-ru.source.json + формат LAVRay)
design/    интерактивный прототип (prototype.html) + 32 эталонных скриншота (shots/)
docs/      требования, аудит, баги, дизайн-система, система обновлений, пресет LAV RU
```

## Статус

**Этап 2 из плана завершён:** дизайн-система v1.1 утверждена владельцем, интерактивный
прототип построен и прошёл визуальное + i18n-ревью, аудит кода NekoBox/sing-box и каталог
багов готовы как входные данные. Реализация (Этап 3) ведётся по Доктрине качества.

## Документация

- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — каталог функциональных требований UI (реверс-инжиниринг NekoBox, MUST/NICE).
- [`docs/AUDIT.md`](docs/AUDIT.md) — аудит Go-ядра NekoBox и связки с UI.
- [`docs/BUGS.md`](docs/BUGS.md) — каталог багов и проблем качества NekoBox (LNB-NN).
- [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — дизайн-система v1.1: токены, компоненты, экраны, i18n, доступность.
- [`docs/UPDATE-SYSTEM.md`](docs/UPDATE-SYSTEM.md) — система обновлений: приложение/ядро/пресеты/geo, каналы, откат.
- [`docs/PRESET-LAV-RU.md`](docs/PRESET-LAV-RU.md) — анализ и план интеграции пресета «LAV Preset RU».

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
