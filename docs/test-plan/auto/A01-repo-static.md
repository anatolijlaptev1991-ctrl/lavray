# A01. Статические проверки репозитория

| Поле | Значение |
|---|---|
| ID | A01 |
| Слой | авто |
| Время | около 10 минут (из них `npm ci` около 2 минут) |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–6 (инструменты, `env.ps1`, клон `src\`). Другие файлы не нужны |
| Опасность | нет: меняются только файлы в собственной рабочей копии `wt\A01` |

## Цель

Повторить на тестовом ПК проверки, которые в CI выполняют задания `proto`, `presets`, `design`, `hygiene` и часть `go` и `node`: контракт API, сгенерированный код, форматирование, размерная «трещотка», SPDX-заголовки, окончания строк LF, тесты самих скриптов, запрещённые фразы в документах. Покрывает эпик Ф1.0 («инфраструктура тестов и ratchet-проверки») плана доработки и требования к репозиторию из `docs/TEST-PLAN.md` (раздел 1, наборы 1 и 7 в части статики).

Что здесь не проверяется: юнит-тесты Go (файл A02), тесты с настоящим sing-box (A03), Rust (A04), vitest (A05).

## Предусловия

- Git, Go (версия из `core/go.mod`), Python 3.12, Node 24, `buf` 1.75.0, `protoc-gen-go` v1.36.12, `protoc-gen-connect-go` 1.21.1 (см. `01-ENVIRONMENT.md`, раздел 5); Git Bash в `PATH` (его ставит Git for Windows).
- Для шагов 13–14: пакет Python `playwright` и браузер Chromium (шаг 13 их устанавливает).
- Сеть: нужна для `go vet` (скачивание модулей), `npm ci`, `pip install`.
- Переменные и функции из `env.ps1`: `LAVRAY_SRC`, `LAVRAY_REF`, `Test-RepoLf`, `Get-RefCommit`.

## Безопасность

Файл не трогает системный прокси, TUN, реестр и порты. Все команды работают внутри каталога `C:\lavray-test\wt\A01`. Шаги 4 и 5 перегенерируют код и могут изменить отслеживаемые файлы рабочей копии; это сознательно, результат сверяется командой `git diff --exit-code`.

## Шаги

Команды `bash` выполняются в Git Bash из корня рабочей копии (`cd /c/lavray-test/wt/A01`). Команды `powershell` — в pwsh 7.

1. Рабочая копия и версия.

```powershell
. C:\lavray-test\env.ps1
# Предусловие: клон src создан с core.autocrlf=false. Иначе buf format и кодогенерация дают ложные расхождения (шаги 3-4).
$crlf = git -C $env:LAVRAY_SRC config core.autocrlf
"core.autocrlf в клоне src: $crlf"
if (-not (Test-RepoLf)) { 'FAIL: в клоне src core.autocrlf не false (01-ENVIRONMENT.md, раздел 6); исправьте и повторите'; return }
git -C $env:LAVRAY_SRC worktree add --detach C:\lavray-test\wt\A01 $env:LAVRAY_REF
$head = git -C C:\lavray-test\wt\A01 rev-parse HEAD
$tagCommit = Get-RefCommit        # git rev-parse "v0.9.1^{commit}": коммит тега, а не HEAD чего-либо
"HEAD рабочей копии: $head"
"коммит $($env:LAVRAY_REF):  $tagCommit"
"совпадают: " + ($head -eq $tagCommit)
git -C C:\lavray-test\wt\A01 status --short
```

   Ожидается: `core.autocrlf в клоне src: false`, `совпадают: True`, 40 шестнадцатеричных символов, `status --short` пуст. Запишите коммит тега в отчёт. Если `core.autocrlf` не `false` (системная настройка Git for Windows `true` перебивается только ключом клонирования `-c core.autocrlf=false`), итог файла `FAIL` на этом шаге с понятным сообщением, остальные шаги не выполняются: иначе шаг 3 дал бы ложный `FAIL` (`buf format -d` видит CRLF). Исправление: `git -C $env:LAVRAY_SRC config core.autocrlf false`, затем пересоздайте рабочую копию (`git worktree remove --force`), либо переклонируйте `src\` по `01-ENVIRONMENT.md`, раздел 6.

2. Копии контракта побайтно одинаковы (`proto/lavray.proto` и `ui/proto/lavray.proto`).

```bash
cmp proto/lavray.proto ui/proto/lavray.proto; echo "cmp exit=$?"
```

   Ожидается: ничего не напечатано кроме `cmp exit=0`.

3. Линтер и формат контракта, сборка (как в задании `proto` CI).

```bash
cd proto
buf lint; echo "lint exit=$?"
buf format -d --exit-code lavray.proto; echo "format exit=$?"
buf build -o /dev/null; echo "build exit=$?"
cd ..
```

   Ожидается: три строки `... exit=0`, других сообщений нет.

4. Сгенерированный Go-код соответствует контракту (из корня рабочей копии; плагины `protoc-gen-go` и `protoc-gen-connect-go` берутся из `PATH`, настройка в `buf.gen.yaml`).

```bash
buf generate proto; echo "generate exit=$?"
git diff --exit-code -- core/internal/gen; echo "gen-diff exit=$?"
```

   Ожидается: обе строки `exit=0`. Если `generate exit` не ноль из-за отсутствия плагина, поставьте плагины (`01-ENVIRONMENT.md`, раздел 5) и повторите; если плагины стоят, а `gen-diff` не ноль, версия плагина не та: сравните `protoc-gen-go --version` с `v1.36.12` и запишите расхождение, не принимайте его за дефект продукта до проверки версий.

5. Сгенерированный TypeScript соответствует контракту.

```bash
cd ui
npm ci; echo "npm ci exit=$?"
npx buf generate proto; echo "ts-generate exit=$?"
git diff --exit-code -- src/gen; echo "ts-gen-diff exit=$?"
cd ..
```

   Ожидается: три строки `exit=0`.

6. Форматирование Go.

```bash
cd core
test -z "$(gofmt -l .)"; echo "gofmt exit=$?"
gofmt -l . | head
cd ..
```

   Ожидается: `gofmt exit=0`, список файлов пуст.

7. `go vet` (сеть разрешена: на свежем ПК модули скачиваются).

```bash
cd core
go vet ./...; echo "vet exit=$?"
cd ..
```

   Ожидается: `vet exit=0`, предупреждений нет.

8. Размерная «трещотка»: новый файл кода не длиннее 200 строк, перечисленные в `scripts/size-ratchet.json` не растут.

```bash
python scripts/size_ratchet.py; echo "size exit=$?"
```

   Ожидается: последняя содержательная строка `size_ratchet: проверено <N> файлов, нарушений: 0` (на `v0.9.0` было `проверено 734 файлов`, на `v0.9.1` не меньше) и `size exit=0`. Строки «можно снизить: …» — подсказки, не ошибки.

9. SPDX-заголовки во всех файлах кода.

```bash
python scripts/add-spdx.py --check; echo "spdx exit=$?"
```

   Ожидается: `без SPDX-строки: 0 файл(ов)` и `spdx exit=0`.

10. В индексе git только LF (проверка задания `hygiene` CI).

```bash
bad="$(git ls-files --eol | awk -F'\t' '$1 ~ /^i\/(crlf|mixed)/ {print $2}')"
printf 'crlf-or-mixed files: [%s]\n' "$bad"
test -z "$bad"; echo "eol exit=$?"
```

    Ожидается: `crlf-or-mixed files: []` и `eol exit=0`.

11. Тесты самих скриптов.

```bash
PYTHONDONTWRITEBYTECODE=1 python -B -m unittest discover -s scripts/tests 2>&1 | tail -4; echo "unittest exit=${PIPESTATUS[0]}"
```

    Ожидается: строка `Ran <N> tests` (на `v0.9.0` было 51, на `v0.9.1` не меньше: добавлены тесты бюджета бандла и nsis-recon), строка `OK`, `unittest exit=0`. Набор не должен уменьшиться относительно эталона 51 без объяснения в отчёте. Ключ `-B` (и переменная `PYTHONDONTWRITEBYTECODE=1`) обязателен: без него Python создаёт каталоги `__pycache__` в `scripts/` и `scripts/tests/`, и шаг 16 увидел бы лишние неотслеживаемые файлы.

12. Запрещённые фразы и упоминания в документах.

```bash
sh scripts/check-readme-claims.sh; echo "claims exit=$?"
sh scripts/check-public-docs.sh; echo "public-docs exit=$?"
```

    Ожидается: `ok: запрещённых фраз нет` и `ok: упоминаний нет`, обе строки `exit=0`.

13. Встроенные пресеты: JSON валиден, обязательные поля, пять языков (скрипт повторяет задание `presets` CI).

```bash
python - <<'EOF'
import json, glob, sys
langs = {"ru", "zh", "en", "es", "de"}
ok = True
files = [f for f in glob.glob("presets/*.json") if not f.endswith(".source.json")]
assert files, "встроенные пресеты не найдены"
for f in sorted(files):
    d = json.load(open(f, encoding="utf-8"))
    miss = {"$schema","id","name","builtin","revision","version","description","dns","routing"} - set(d)
    if miss:
        print(f"FAIL {f}: нет полей {sorted(miss)}"); ok = False; continue
    if d["builtin"] is not True:
        print(f"FAIL {f}: builtin != true"); ok = False
    if not isinstance(d["revision"], int) or d["revision"] < 1:
        print(f"FAIL {f}: revision должен быть int >= 1"); ok = False
    dl = set(d["description"])
    if dl != langs:
        print(f"FAIL {f}: description: языки {sorted(dl)} != {sorted(langs)}"); ok = False
    print(f"ok {f}: rev {d['revision']}")
sys.exit(0 if ok else 1)
EOF
echo "presets exit=$?"
```

    Ожидается: по строке `ok presets/<имя>.json: rev <N>` на каждый пресет (в Windows `glob` даёт обратную косую: `ok presets\<имя>.json: rev <N>`, это норма), строк `FAIL` нет, `presets exit=0`.

14. Проверки дизайна (задание `design` CI): прототип интерфейса.

```bash
pip install playwright; echo "pip exit=$?"
python -m playwright install chromium; echo "chromium exit=$?"
python design/tools/i18n_check.py; echo "i18n exit=$?"
python design/tools/token_contrast.py; echo "contrast exit=$?"
```

    Ожидается: `i18n_check` печатает `languages: ['ru', 'en', 'zh', 'es', 'de']; keys in ru: <N>; errors: 0; warnings: 0` (на `v0.9.0` было 741 ключ, на `v0.9.1` не меньше), `token_contrast` печатает шесть строк `PASS <тема>/<акцент>: 38 pairs`, оба кода выхода `0`.

    Замечание: `i18n_check.py` проверяет словари прототипа `design/prototype.html`. Словари приложения (`ui/src/lib/dictionaries`) проверяет vitest в файле A05.

15. Защита «RPC есть в ядре, а интерфейс про него не знает» (хвосты B).

```bash
python scripts/rpc_usage.py; echo "rpc-usage exit=$?"
python scripts/rpc_usage.py --list | head -40
```

    Ожидается: строка `rpc_usage: RPC в proto: <N>, нарушений: 0` (на `main` `773b4e8` — 95 RPC) и `rpc-usage exit=0`. Скрипт требует, чтобы каждый RPC из `proto/lavray.proto` вызывался в `ui/src` (`core.<клиент>.<метод>(`) либо стоял в `ui/src/rpc-unused.allow.ts` с причиной; запись про RPC, который уже вызывается или исчез из proto, — тоже нарушение (устаревшее исключение скрывало бы регресс). `--list` печатает RPC без вызова в интерфейсе: все они обязаны быть в списке разрешённых. Тот же контракт проверяет vitest-файл `ui/src/rpc-usage.test.ts` (A05, шаг 7).

16. Фиксация результата: отслеживаемые файлы репозитория не должны быть изменены шагами 4–5 (и остальными).

```bash
git diff --exit-code; echo "diff exit=$?"
git status --short --untracked-files=no; echo "status exit=$?"
```

    Ожидается: `diff exit=0`, `git status --short --untracked-files=no` ничего не печатает (генерация шагов 4–5 дала тот же результат, что в репозитории). Неотслеживаемые файлы в проверку не входят: после шага 11 без `-B` (и после любого запуска Python-тестов) `git status --short` не пуст из-за каталогов `__pycache__`, поэтому как критерий используйте только `--untracked-files=no`. Лишние `__pycache__` не ошибка продукта.

## Критерии PASS/FAIL

Итог файла `PASS`, если выполнены все пункты:

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Шаг 2: `cmp` вернул 0 | `cmp exit=0` |
| К2 | Шаг 3: `buf lint`, `buf format -d --exit-code`, `buf build` вернули 0 | три строки `exit=0` |
| К3 | Шаги 4–5: сгенерированный Go и TS без расхождений | `gen-diff exit=0`, `ts-gen-diff exit=0` |
| К4 | Шаг 6: `gofmt -l .` ничего не печатает | `gofmt exit=0` |
| К5 | Шаг 7: `go vet ./...` вернул 0 | `vet exit=0` |
| К6 | Шаг 8: нарушений размерной «трещотки» 0 | строка `нарушений: 0` и `size exit=0` |
| К7 | Шаг 9: файлов без SPDX 0 | строка `без SPDX-строки: 0` |
| К8 | Шаг 10: CRLF в индексе нет | `eol exit=0` |
| К9 | Шаг 11: тесты скриптов `OK`, число тестов не меньше 51 | `Ran N tests` с `N >= 51`, `OK` |
| К10 | Шаг 12: запрещённых фраз и упоминаний нет | обе строки `ok: …`, `exit=0` |
| К11 | Шаг 13: все пресеты прошли | нет строк `FAIL`, `presets exit=0` |
| К12 | Шаг 14: `i18n_check` `errors: 0; warnings: 0`, `token_contrast` шесть `PASS` | коды `0` |
| К13 | Шаг 15: `rpc_usage.py` печатает `нарушений: 0`, код выхода 0 | `rpc-usage exit=0` |
| К14 | Шаг 16: отслеживаемые файлы не изменены | `diff exit=0` и пустой вывод `git status --short --untracked-files=no` |

Пункт, невозможный из-за отсутствия плагина кодогенерации или сети (шаги 4, 5, 7, 14), получает `BLOCKED` с названием отсутствующего; итог файла тогда `PARTIAL`, если остальное прошло.

## Что собрать

В `C:\lavray-test\results\A01\`: вывод каждого шага в `step-NN.txt` (команды выше с `2>&1 | Tee-Object`), строку коммита, вывод `gofmt -l .`, вывод `git diff --exit-code` и `git status --short --untracked-files=no`. Секретов в выводе нет.

## Откат / уборка

Рабочая копия — единственное, что создано. После отчёта:

```powershell
git -C $env:LAVRAY_SRC worktree remove --force C:\lavray-test\wt\A01
git -C $env:LAVRAY_SRC worktree prune
Test-Path C:\lavray-test\wt\A01
```

Ожидается: последняя строка `False`. Системное состояние файлом не менялось, откат системы не нужен. (Пакет `playwright` и браузер Chromium из шага 14 остаются установленными; это допустимо, они не влияют на продукт.)

## Отчёт

Заполните `templates/REPORT.md` и сохраните как `results/A01.md`: ID `A01`, статус каждого из 16 шагов, значения К1–К14, коммит и версии инструментов (`go version`, `buf --version`, `node --version`, `python --version`). Дефекты при провале К4–К10 — `major` (в CI они блокируют слияние), при провале К12 — `minor`.
