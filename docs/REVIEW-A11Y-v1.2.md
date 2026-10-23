# Ревью доступности прототипа LAVRay v1.2 — REVIEW-A11Y-v1.2.md

- **Дата:** 2026-10-22 (записано исполнителем задач B/C; прогоны выполнены на текущем состоянии `design/prototype.html`).
- **Важно:** задачи A1–A22 по прототипу в момент записи выполняются параллельно другим исполнителем (`docs/fix-plan/01-prototype.md`). Выводы ниже — контрольная точка «в процессе»; **финальный прогон обязателен после сдачи A-задач**, тогда же заполняется список принятых исключений (раздел 3) и сверка DS ↔ прототип (`docs/fix-plan/04-design-system.md`, раздел «Сверка»).
- **Критерии приёмки:** `docs/fix-plan/00-README.md` §6.

## 1. Вывод прогонов (контрольная точка)

### `python design/tools/token_contrast.py` — PASS (все строки)

```
PASS dark/amber: 38 pairs
PASS dark/sage: 38 pairs
PASS dark/graphite: 38 pairs
PASS light/amber: 38 pairs
PASS light/sage: 38 pairs
PASS light/graphite: 38 pairs
```

Токены v1.2 (включая `--t3`, `--b-control`, `--warn-text`, `--info-text` и акценты) проходят контраст во всех шести комбинациях тема × акцент.

### `python design/tools/i18n_check.py` — 0 ошибок, 1 предупреждение

```
WARN  possibly unused keys (3): ['log.redactedTip', 'sub.errCtx', 'ub.kb']
languages: ['ru', 'en', 'zh', 'es', 'de']; keys in ru: 375; errors: 0; warnings: 1
```

Предупреждение о неиспользуемых ключах закрывается задачей A21 (`log.redactedTip` подключается в A12.3; `sub.errCtx` помечен к удалению; `ub.kb` — к использованию).

### `python design/tools/kbd_probe.py` — 3 PASS / 16 FAIL (исходная точка A-задач)

Проходят: `menu-escape-returns-focus`, `reduced-motion-no-infinite-animations`, `no-page-errors`.

Не проходят (ожидаемо до сдачи A-задач; сопоставление с задачами `01-prototype.md`): `dialogs-named`, `window-buttons-not-tabbable` (A3), `closed-drawer-unfocusable` (A15 inert), `focus-ring-accent-2px` (A1), `import-initial-focus-in-field`/`editor-initial-focus-not-primary` (A15/A16), `modal-focus-trap`/`escape-closes-and-returns-focus` (A15), `import-tabs-aria` (A17), `menu-focus-first-item`/`menu-arrow-moves`/`row-context-menu-key` (A15), `single-connection-live-region` (A7), `forced-colors-rules` (A1/A15), `browser-skip-link-first` (A19), `phone-nav-reachable` (A6).

### `python design/tools/a11y_sweep.py` (полный) — код возврата 0, но секции не в нуле (исходная точка A-задач)

```
contrast        unique=   3 FAIL
names           unique=  13 FAIL
ellipsis        unique=   5
clip            unique=   2 FAIL
wrap            unique=  20
foreign         unique=  20 FAIL
cjk-style       unique=   0 PASS
phone-overflow  states=   8 FAIL
```

Детали: `design/tools/out/a11y_sweep.json`. `foreign` — кириллица в en/es/de-словарях журнала (закрывается F12/A12: строки ядра английские во всех языках) и единицы «КБ/с»/«МБ» (F5/F6/A21 — единицы из словаря). `contrast`/`names`/`clip`/`phone-overflow` — правятся задачами A1–A6, A15.

## 2. Соответствие критериям приёмки (на момент записи)

| Критерий (`00-README.md` §6) | Статус |
|---|---|
| token_contrast — все PASS | **выполнено** |
| i18n_check — 0 ошибок и 0 предупреждений | 0 ошибок; 1 предупреждение — после A21 |
| kbd_probe — все PASS | 3/19 — после A-задач |
| a11y_sweep — код 0 и все секции в нуле | код 0; секции не в нуле — после A-задач |
| Ручной чек-лист на скриншотах | после A-задач |

## 3. Принятые исключения `data-a11y-ignore`

Механизм: элемент с атрибутом `data-a11y-ignore="<id-проверки>"` исключается из соответствующей секции `a11y_sweep.py`; каждое исключение обязано иметь причину.

**На момент записи исключения не принимались.** Список заполняется после сдачи A-задач — предполагаемые кандидаты (решение за исполнителем A и владельцем):

| Селектор | Проверка | Причина (предварительно) |
|---|---|---|
| — | — | — |

## 4. Ручной чек-лист (на релиз)

NVDA (Windows) и VoiceOver (macOS): порядок чтения главного экрана, объявление состояния подключения единственным live-регионом, работа меню/диалогов/вкладок стрелками, масштаб текста 200 %, `forced-colors`. Чек-лист — `docs/DESIGN-SYSTEM.md` v1.2 §12.
