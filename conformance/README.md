# conformance/

Нейтральные тестовые данные (не Go-код), которые читают и Go-, и Rust-тесты.
Назначение: при переносе ядра на Rust (`docs/rust-migration/PLAN.md`, R0) обе
реализации проверяются по одним и тем же файлам, а не по копиям.

## Состав

`manifest.json` перечисляет файлы по категориям: путь от корня репозитория,
размер и sha256. Файлы пакетов ядра **не копируются**, manifest ссылается на них:

| Категория | Источник |
|---|---|
| `fuzz-corpus` | `core/internal/**/testdata/fuzz/**` |
| `cfgbuild-golden`, `cfgbuild-deviations` | `core/internal/cfgbuild/testdata/` |
| `store-migrations` | `core/internal/store/testdata/` |
| `testdata-subs`, `testdata-store-nekoimport` | `testdata/` пакетов `subs`, `store` |
| `generated-backup` | `conformance/generated/backup/` (LAVBK1, см. `cases.json`) |
| `generated-updates` | `conformance/generated/updates/` (TUF-lite, см. `cases.json`) |

Образцы в `generated/` создаёт Go-код `core/internal/conformance/`. Он детерминирован:
фиксированные seed, ключи и время; повторная генерация даёт те же байты. Исключение:
gzip внутри тела копии зависит от версии Go, поэтому проверка читает закоммиченный
`payload.bin` и запечатывает его, а Rust сверяет расшифровку и `payload_sha256`.
Каждый кейс TUF-lite в `cases.json` прогоняется через настоящие функции `updates`. Пароли и ключи в образцах тестовые.

## Проверка

Go (обе проверки входят в `go test ./...`, job `go` в CI):

    cd core && go test ./internal/conformance/

Тест `TestManifest` сверяет каждый sha256 и размер с диском, ловит новые, пропавшие и
изменённые файлы, а также несовпадение `generated/` с генератором. Rust:

    cd rust && cargo test -p lavray-conformance

## Как пересобрать

Изменили golden, корпус или формат образцов — перегенерируйте и закоммитьте результат:

    cd core && CGO_ENABLED=0 go test ./internal/conformance/ -run TestManifest -update

Флаг `-update` пересоздаёт `generated/` и `manifest.json`. Правьте их только так.

## Правило

Rust- и Go-тесты читают одни файлы. Новые данные для обоих языков кладите сюда (или
добавляйте ссылку в `specs()` пакета `core/internal/conformance`), а не в копию внутри
одного из пакетов.
