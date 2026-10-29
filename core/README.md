# core/ — Go-ядро LAVRay

Go-ядро LAVRay: порт логики из `nekoray/go` (nekobox_core) + конвейер генерации конфигов
ConfigBuilder (оригинал — `db/ConfigBuilder.cpp` в nekoray, порт на Go с golden-тестами).

## Базовая линия

| Компонент | Источник | Пин |
|---|---|---|
| sing-box (форк с neko-слоем) | `https://github.com/anatolijlaptev1991-ctrl/sing-box` | **`628a9ed`** (= sing-box 1.14.1-neko.1) |

Форк подключается в `go.mod` через `replace` на зафиксированный коммит. Изменение пина —
только через гейт обновления из `docs/UPDATE-SYSTEM.md` (аудит changelog, лицензия upstream,
перенос neko-патчей, полный прогон L1/L2, smoke-тесты коннективности, тег `core-<version>`).

## Структура (целевая)

- `cmd/lavray-core/` — точка входа (бинарь ядра, слушает ConnectRPC).
- `internal/config/` — ConfigBuilder: профили → конфиг sing-box (golden-тесты).
- `internal/store/` — хранилище профилей/групп/настроек (порт модели DataStore nekoray).
- `internal/subs/` — подписки, импорт/экспорт, декриптор ссылок других клиентов.
- `internal/presets/` — формат пресетов LAVRay и конвертер из NekoRay 4.x (см. `../presets/README.md`).
- `internal/api/` — реализация сервисов из `../proto/`.

## Neko-патчи над sing-box

Слой интеграции с sing-box документируется пофайлово: [`NEKO_PATCHES.md`](NEKO_PATCHES.md).
Список ведётся всегда актуальным — он используется гейтом обновления ядра.

## Справочные документы

- `../docs/AUDIT.md` — аудит Go-ядра NekoBox (входные данные порта).
- `../docs/BUGS.md` — каталог багов (LNB-NN), которые порт не должен воспроизвести.
- `../docs/REQUIREMENTS.md` — карта «фича → файл-источник» (раздел 19), Приложения А/Б.
