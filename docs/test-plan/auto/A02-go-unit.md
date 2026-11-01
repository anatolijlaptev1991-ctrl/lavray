# A02. Go: юнит-тесты, фаззинг по seed-корпусам, пороги покрытия

| Поле | Значение |
|---|---|
| ID | A02 |
| Слой | авто |
| Время | 5–8 минут (без расширенного фаззинга), +3 минуты с шагом 9 |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–6 |
| Опасность | нет: тесты работают на loopback со случайными портами и во временных каталогах |

## Цель

Прогнать `go test ./...` в ядре без тегов сборки, как это делает задание `go` в CI, и убедиться, что каждый пакет собирается и проходит, что guard-тесты (трещотки) на месте, что фаззеры отрабатывают на seed-корпусах, а пороги покрытия соблюдены. Покрывает: Ф1.0 (`TestMigrationsAreAppendOnly`, `TestUnimplementedRatchet`, `TestEveryProcedureHasAgentDecision`), T-08B (хэш подтверждения custom-полей, `canonjson`, `customhash`), T-79 (`traffic`, `textdiff`, сессии и учёт трафика в `store`), T-82 (в части ядра: настройки), T-77 (ядро не менялось), MCP и агентская таблица (`internal/mcp`, `internal/api/agent*`), а также весь код 0.2.x: сборщик конфигов (`cfgbuild`), парсеры ссылок и подписок, хранилище.

Тесты, которым нужен настоящий sing-box (теги `singbox_run` и др.), здесь не запускаются: это файл A03.

## Предусловия

- Go версии из `core/go.mod`, Python 3.12, Git (см. `01-ENVIRONMENT.md`, раздел 5).
- Сеть разрешена. В отличие от ПК владельца (`GOPROXY=off`), на свежем ПК модули скачиваются через `proxy.golang.org`. Если сети нет, файл получает `BLOCKED`, а не `FAIL`.
- Флаг `-race` не используется: в сборке `CGO_ENABLED=0` он недоступен (CI тоже не запускает его для ядра).

## Безопасность

Тесты открывают только `127.0.0.1` на случайных портах и пишут во временные каталоги ОС. Системный прокси, TUN, реестр и порт 2080 не затрагиваются. Фаззинг (шаг 9) пишет найденные входы в `core/internal/.../testdata/fuzz/` рабочей копии; в `src\` это не попадает.

## Шаги

1. Рабочая копия (повторяет шаг 1 файла A01, но для `wt\A02`).

```powershell
. C:\lavray-test\env.ps1
$wt = 'C:\lavray-test\wt\A02'
if (-not (Test-RepoLf)) { 'FAIL: в клоне src core.autocrlf не false (01-ENVIRONMENT.md, раздел 6); исправьте и повторите'; return }
git -C $env:LAVRAY_SRC worktree add --detach $wt $env:LAVRAY_REF
Set-Location (Join-Path $wt 'core')
go version
go env GOPROXY GOFLAGS
```

   Ожидается: версия Go не ниже строки `go` в `core/go.mod`; `GOFLAGS` пуст (не `-mod=mod`).

2. Компиляция всего ядра без тегов.

```powershell
go build ./...
"build exit=$LASTEXITCODE"
```

   Ожидается: `build exit=0`. Здесь же скачиваются модули; повтор при сетевой ошибке допустим один раз (запишите в отклонения).

3. Полный прогон. Результат сохраняется в файл, потому что вывод длинный.

```powershell
New-Item -ItemType Directory -Force -Path C:\lavray-test\results\A02 | Out-Null
go test ./... -count=1 -timeout 300s 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A02\go-test-all.txt
"test exit=$LASTEXITCODE"
```

   Ожидается: `test exit=0`; каждая строка начинается с `ok` или `?` (пакет без тестов); строк `FAIL` и `panic` нет.

4. Таблица пакетов. Проверьте по файлу `go-test-all.txt`:

```powershell
$log = Get-Content C:\lavray-test\results\A02\go-test-all.txt
"ok: "   + ($log | Where-Object { $_ -match '^ok\s' }).Count
"FAIL: " + ($log | Where-Object { $_ -match '^(FAIL|---\s+FAIL|panic)' }).Count
($log | Where-Object { $_ -match '^\?\s' }) -replace '\s+\[no test files\]',''
```

   Ожидается (на `v0.9.0` было 24, на `v0.9.1` не меньше): `ok: 24`, `FAIL: 0`, и четыре пакета без тестов: `internal/gen/lavrayv1`, `internal/gen/lavrayv1connect`, `internal/testsocks` (сгенерированный код и вспомогательный SOCKS5-сервер для тестов), `internal/updates/updatestest` (вспомогательный код тестов обновлений). Если `ok` больше 24 (появились пакеты), это не ошибка; если меньше или какой-то пакет из таблицы ниже пропал, это `FAIL`.

   Эталонные времена этой машины (для оценки, не критерий): `cmd/lavray-core` 22 с, `internal/api` 44 с, `internal/updates` 15 с, `internal/store` 11 с, `internal/mcp` 10 с, `internal/presets` 8 с, `internal/subs` 7 с, остальные до 4 с.

5. Число тестовых функций по пакетам (защита от тихого удаления тестов). Команда печатает пары «пакет число»:

```powershell
$pk = 'cmd/lavray-core','cmd/updsign','internal/api','internal/backup','internal/buildtags','internal/cfgbuild','internal/gateway','internal/headless',
      'internal/inst','internal/links','internal/logs','internal/mcp','internal/model','internal/presets','internal/store',
      'internal/store/nekoimport','internal/subs','internal/subs/parser','internal/textdiff','internal/traffic','internal/updates','internal/version','internal/web'
foreach ($p in $pk) {
  $n = (go test -list '^(Test|Fuzz)' "./$p/" 2>&1 | Select-String -Pattern '^(Test|Fuzz)').Count
  '{0,-28} {1}' -f $p, $n
}
```

   Эталон на `v0.9.0` (функции верхнего уровня `Test*` и `Fuzz*`, без тегов сборки, Windows). Это нижняя граница: на `<TAG>` чисел больше, проверяется «не меньше»:

   | Пакет | Число | Что в нём главное |
   |---|---|---|
   | `cmd/lavray-core` | 36 | запуск, токен из stdin, агентский токен, выход при EOF, ошибки хранилища |
   | `cmd/updsign` | 31 | утилита подписи метаданных обновлений: `genkey`, `manifest`, `geo-pack`, `verify` (T-75) |
   | `internal/api` | 404 | RPC всех сервисов, трещотка `TestUnimplementedRatchet`, агентская таблица, T-08B, T-79 |
   | `internal/backup` | 25 | зашифрованная копия `.lavbk` (T-83) |
   | `internal/buildtags` | 6 | единый список тегов, запрет `clash_api`, имена ассетов |
   | `internal/cfgbuild` | 59 | сборка конфигов, golden-эталоны |
   | `internal/gateway` | 28 | модель шлюза (не подключена к ядру) |
   | `internal/headless` | 3 | авторестарт в сервисном режиме |
   | `internal/inst` | 20 | менеджер инстанса на подставном раннере (остальные 33 теста требуют тегов, файл A03) |
   | `internal/links` | 20 | парсеры ссылок, `FuzzParseLink` |
   | `internal/logs` | 12 | журнал и маскировка секретов |
   | `internal/mcp` | 31 | MCP-сервер и инструменты |
   | `internal/model` | 37 | модель, канонический JSON, хэш custom-полей |
   | `internal/presets` | 52 | формат пресетов, перенос из NekoRay, `FuzzConvertNekoRayRoute` |
   | `internal/store` | 74 | SQLite, миграции (до v6 с T-76 и T-78), сессии и трафик |
   | `internal/store/nekoimport` | 52 | импортёр каталога NekoBox (T-78, подключён) |
   | `internal/subs` | 39 | подписки и их применение (в подпакете расшифровки ссылок ещё 9 тестов, их считает шаг 7) |
   | `internal/subs/parser` | 23 | разбор содержимого подписок (base64, YAML, список ссылок), `FuzzParseContent` |
   | `internal/textdiff` | 8 | построчный diff, `FuzzUnified` |
   | `internal/traffic` | 15 | счётчик скоростей, `FuzzMeterNeverNegative` |
   | `internal/updates` | 166 | центр обновлений (T-75, включая наборы и гео §7.5) |
   | `internal/version` | 1 | версия ядра |
   | `internal/web` | 59 | веб-панель (T-76, подключена флагом `--web-bind`) |

   Критерий: число не меньше эталона. Меньше — запишите разницу в отчёт и пометьте `minor`, если тесты удалены; пометьте `doc`, если их перенесли в другой пакет (в этом случае общая сумма не уменьшилась). Сумма таблицы 1201; вместе с 9 тестами подпакета расшифровки ссылок в `internal/subs/` получается 1210 функций верхнего уровня.

6. Защитные тесты-трещотки присутствуют и проходят. Это защита от ситуации «тест удалили, прогон зелёный».

```powershell
go test -count=1 -v -run '^(TestMigrationsAreAppendOnly)$' ./internal/store/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
go test -count=1 -v -run '^(TestUnimplementedRatchet|TestEveryProcedureHasAgentDecision|TestAgentTableKeepsPreviousAllowlists)$' ./internal/api/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
go test -count=1 -v -run '^(TestClashAPITagIsForbiddenUntilForkIsPatched|TestTagsFileHasRequiredTags|TestBuildersTakeTagsFromFile|TestReleaseAssetNamesAreTheSameInWorkflowAndNotes)$' ./internal/buildtags/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
```

   Ожидается: для каждого имени строка `--- PASS: <имя>` (всего 8) и строки `ok`. Строка `--- SKIP` или отсутствие имени — `FAIL`.

7. Фаззеры на seed-корпусах. `go test` запускает каждый `Fuzz*` как обычный тест на заложенных входах (`f.Add` и файлы `testdata/fuzz/…`).

```powershell
go test -count=1 -v -run '^Fuzz' ./internal/links/ ./internal/model/ ./internal/presets/ ./internal/subs/... ./internal/textdiff/ ./internal/traffic/ 2>&1 |
  Select-String -Pattern '^(--- |ok|FAIL)'
```

   Ожидается ровно десять строк `--- PASS:` с именами: `FuzzParseLink`, `FuzzCanonicalJSON`, `FuzzConvertNekoRayRoute`, `FuzzNormalizeCustomRules`, `FuzzDetectAndParse`, `FuzzSlugify` (ещё три фаззера пакета `internal/presets`), `FuzzDecrypt`, `FuzzParseContent`, `FuzzUnified`, `FuzzMeterNeverNegative`, и ни одной `FAIL` (значение для тега v0.9.0, коммит `8093656`; на более поздних тегах фаззеров может быть больше, меньше быть не должно). Корпус `internal/links/testdata/fuzz/FuzzParseLink` содержит файлы ранее найденных входов (на `97624d6` — два); проверьте `(Get-ChildItem internal/links/testdata/fuzz/FuzzParseLink).Count -ge 2`.

8. Порог покрытия (`scripts/covergate.py`, пороги в `scripts/coverage.yaml`).

```powershell
go test ./... -count=1 -timeout 300s -coverprofile=C:\lavray-test\results\A02\cover.out 2>&1 | Select-String -Pattern '^(FAIL|panic)'
Set-Location ..
python scripts/covergate.py --go C:\lavray-test\results\A02\cover.out --only core/
"covergate exit=$LASTEXITCODE"
```

   Ожидается: нет строк `FAIL`; последняя строка `covergate: записей <N>, нарушений: 0`, `covergate exit=0`. На `97624d6` одна запись: `ok core/internal/traffic/: 97.28% при пороге 90%`. Новые записи в `coverage.yaml` проверяются так же; нарушение — `major`.

9. Расширенный фаззинг (по желанию оркестратора, помечается `SKIPPED`, если не нужен). По 15 секунд на цель. Фаззер запускает по одной цели за раз.

```powershell
Set-Location (Join-Path $wt 'core')
$targets = @(
  @('FuzzParseLink','./internal/links/'),
  @('FuzzCanonicalJSON','./internal/model/'),
  @('FuzzConvertNekoRayRoute','./internal/presets/'),
  @('FuzzParseContent','./internal/subs/parser/'),
  @('FuzzUnified','./internal/textdiff/'),
  @('FuzzMeterNeverNegative','./internal/traffic/')
)
foreach ($t in $targets) {
  go test -run '^$' -fuzz ('^' + $t[0] + '$') -fuzztime 15s $t[1] 2>&1 | Select-Object -Last 3
  "{0} exit={1}" -f $t[0], $LASTEXITCODE
}
git -C $wt status --short -- core
```

   Ожидается: у каждой цели `exit=0` и строки вида `ok ... <время>`; `git status --short -- core` не показывает новых файлов в `testdata/fuzz` (новый файл означает найденный сбой: `critical`, если паника на входе пользователя; приложите файл к отчёту). Цель `FuzzDecrypt` из подпакета расшифровки ссылок запустите так же, если нужен полный охват: `go test -run '^$' -fuzz '^FuzzDecrypt$' -fuzztime 15s ./internal/subs/...` (имя пакета берётся из `go list ./internal/subs/...`).

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Шаг 2: `go build ./...` вернул 0 | `build exit=0` |
| К2 | Шаг 3: `go test ./...` вернул 0 | `test exit=0` |
| К3 | Шаг 4: `ok: 24` (или больше), `FAIL: 0`, пакеты без тестов только перечисленные | значения вывода |
| К4 | Шаг 5: число тестов в каждом пакете не меньше эталона | таблица шага 5 |
| К5 | Шаг 6: все 8 защитных тестов `--- PASS` | вывод |
| К6 | Шаг 7: 10 фаззеров `--- PASS`, корпус `FuzzParseLink` не пуст | вывод и счётчик |
| К7 | Шаг 8: `covergate exit=0`, нарушений 0 | вывод |
| К8 | Шаг 9 (если выполнялся): все цели `exit=0`, новых файлов в `testdata/fuzz` нет | вывод и `git status` |

## Что собрать

`results\A02\go-test-all.txt`, `cover.out` не копировать в отчёт (большой), но сохранить в `results\A02\`. Таблицу шага 5 (фактические числа). Выводы шагов 6–9.

## Откат / уборка

```powershell
Set-Location C:\lavray-test
git -C $env:LAVRAY_SRC worktree remove --force C:\lavray-test\wt\A02
git -C $env:LAVRAY_SRC worktree prune
Test-Path C:\lavray-test\wt\A02
```

Ожидается `False`. Кэш сборки Go (`go env GOCACHE`) и кэш модулей остаются: это ускоряет следующие файлы и не влияет на систему. Системного отката нет.

## Отчёт

`results/A02.md` по `templates/REPORT.md`: статусы 9 шагов, К1–К8, таблица фактических чисел шага 5, время `go test ./...`. Провал К2 — `major` (в CI это красное задание `go`); провал К5 — `critical` для процесса (трещотка выключена); К4 — `minor`.
