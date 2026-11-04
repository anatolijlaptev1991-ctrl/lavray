# core/ — Go-ядро LAVRay

Go-ядро LAVRay: порт логики из `nekoray/go` (nekobox_core) + конвейер генерации конфигов
ConfigBuilder (оригинал — `db/ConfigBuilder.cpp` в nekoray, порт на Go с golden-тестами).

## Базовая линия

| Компонент | Источник | Пин |
|---|---|---|
| sing-box (форк с neko-слоем) | `https://github.com/anatolijlaptev1991-ctrl/sing-box` | **`35f3fd0`** (= sing-box 1.14.1-neko.1 `628a9ed` + патч P1 из `NEKO_PATCHES.md`) |

Форк подключается в `go.mod` через `replace` на зафиксированный коммит. Изменение пина —
только через гейт обновления из `docs/UPDATE-SYSTEM.md` (аудит changelog, лицензия upstream,
перенос neko-патчей, полный прогон L1/L2, smoke-тесты коннективности, тег `core-<version>`).

## Структура

- `cmd/lavray-core/` — точка входа (бинарь ядра, слушает ConnectRPC; флаги `serve`, `--listen-socket`, `--data`, `--headless`).
- `internal/cfgbuild/` — ConfigBuilder: профили → конфиг sing-box (golden-тесты).
- `internal/model/` — модель профилей, групп и настроек.
- `internal/store/` — хранилище профилей/групп/настроек (SQLite); `store/nekoimport` — импортёр каталога NekoBox (экран переноса, `MigrationService`).
- `internal/links/` — парсеры ссылок.
- `internal/subs/` — подписки, импорт/экспорт, декриптор ссылок других клиентов.
- `internal/presets/` — формат пресетов LAVRay и конвертер из NekoRay 4.x (см. `../presets/README.md`).
- `internal/inst/` — менеджер инстанса sing-box.
- `internal/api/` — реализация сервисов из `../proto/`; без заглушек, кроме `WebSessionService`, который отвечает только с `--web-bind` (список — `rpc_ratchet_test.go`).
- `internal/traffic/`, `internal/backup/`, `internal/textdiff/` — учёт трафика и скорость соединений, зашифрованная резервная копия (LAVBK1), diff для подтверждения своего JSON.
- `internal/logs/`, `internal/updates/`, `internal/web/`, `internal/gateway/`, `internal/headless/` — журнал, клиент обновлений (подключён; без корня доверия отвечает «обновления не настроены»), веб-панель, шлюз OpenWrt, сервисный режим; `web` включается флагом `--web-bind`, `gateway` — `--platform openwrt`.

## Neko-патчи над sing-box

Слой интеграции с sing-box документируется пофайлово: [`NEKO_PATCHES.md`](NEKO_PATCHES.md).
Список ведётся всегда актуальным — он используется гейтом обновления ядра.

## Справочные документы

- `../docs/AUDIT.md` — аудит Go-ядра NekoBox (входные данные порта).
- `../docs/BUGS.md` — каталог багов (LNB-NN), которые порт не должен воспроизвести.
- `../docs/REQUIREMENTS.md` — карта «фича → файл-источник» (раздел 19), Приложения А/Б.
