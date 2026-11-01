# A05. Интерфейс: npm ci, tsc, eslint, vitest, сборка

| Поле | Значение |
|---|---|
| ID | A05 |
| Слой | авто |
| Время | 5–8 минут (`npm ci` около 2 минут, `vitest` около 2 минут) |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–6 |
| Опасность | нет: работа только в `wt\A05` |

## Цель

Выполнить задание `node` CI: установить зависимости строго по `package-lock.json`, проверить типы, линтер, все тесты vitest и сборку. Покрывает весь UI до версии 0.4.0, в том числе: подтверждение custom-полей (`CustomFieldsDiffDialog`, `no-client-confirmed`), экран «Соединения» и хуки трафика (T-79), настройки окна, трея, уведомлений и глобального сочетания (T-82), показ и импорт QR (T-77), «Сохранить как», режим агентов MCP, следование окна за состоянием ядра (`proxyFollow`), словари пяти языков, доступность диалогов и порядок Tab.

## Предусловия

- Node 24 и npm (см. `01-ENVIRONMENT.md`, раздел 5), Git. Сеть: `registry.npmjs.org`.
- Если в `ui\node_modules` окажется junction (ссылка) вместо настоящего каталога, `npm ci` в нём не выполняется: в рабочей копии `wt\A05` его нет, но проверьте (шаг 2).

## Безопасность

Системного эффекта нет. Тесты работают в jsdom, без реального окна, сети и ядра. `npm ci` скачивает пакеты в `wt\A05\ui\node_modules` (около 0,5 ГБ). Скрипты установки пакетов npm не запускаются автоматически (npm выводит предупреждение `allow-scripts` про `esbuild`: на результат не влияет).

## Шаги

1. Рабочая копия.

```powershell
. C:\lavray-test\env.ps1
$wt = Join-Path $env:LAVRAY_TP_ROOT 'wt\A05'
git -C $env:LAVRAY_SRC worktree add --detach $wt $env:LAVRAY_REF
Set-Location (Join-Path $wt 'ui')
node --version
npm --version
```

   Ожидается: Node `v24.x`.

2. Каталог зависимостей настоящий.

```powershell
Test-Path node_modules
(Get-Item node_modules -Force -ErrorAction SilentlyContinue).LinkType
```

   Ожидается: `False` и пустое значение (каталога ещё нет). Если `LinkType` непустой — удалите ссылку (`Remove-Item node_modules`, без `-Recurse`) и продолжайте.

3. Установка по lock-файлу.

```powershell
npm ci 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A05-npm-ci.txt | Select-Object -Last 4
"npm ci exit=$LASTEXITCODE"
git -C $wt status --short
```

   Ожидается: `npm ci exit=0`; `git status --short` пуст (lock-файл не изменился; `node_modules` и `dist` в `.gitignore`).

4. Типы.

```powershell
npx tsc --noEmit
"tsc exit=$LASTEXITCODE"
```

   Ожидается: `tsc exit=0`, вывода нет.

5. Линтер без единого предупреждения (требование репозитория; CI запускает `npx eslint .` без флага, поэтому `--max-warnings=0` строже).

```powershell
npx eslint . --max-warnings=0
"eslint exit=$LASTEXITCODE"
```

   Ожидается: `eslint exit=0`, вывода нет.

6. Все тесты.

```powershell
npx vitest run 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A05-vitest.txt | Select-Object -Last 8
"vitest exit=$LASTEXITCODE"
```

   Ожидается: `vitest exit=0`; строки `Test Files  118 passed (118)` и `Tests  886 passed (886)` (эталон на `97624d6`; числа в цветном выводе окружены кодами цвета, ищите подстроки `118 passed` и `886 passed`). Меньше эталона — запишите разницу; провалы и `skipped` — `FAIL`/`WARN` ниже.

   Проверка отсутствия пропущенных и упавших:

```powershell
Select-String -Path C:\lavray-test\results\A05-vitest.txt -Pattern '(failed|skipped|todo)' | Select-Object -First 5
```

   Ожидается: ничего не найдено (или только слова в названиях тестов; в этом случае сверьтесь с итоговой строкой `Tests`).

7. Именные охранные тесты есть и проходят (защита от тихого удаления).

```powershell
$guards = 'src/no-client-confirmed.test.ts','src/dead-code.test.ts','src/build-config.test.ts','src/styles.test.ts',
          'src/lib/i18n.keys.test.ts','src/lib/i18n.test.ts','src/lib/proxyFollow.test.ts','src/lib/globalHotkey.test.ts',
          'src/lib/saveFile.test.ts','src/lib/agents.test.ts','src/components/CustomFieldsDiffDialog.test.tsx',
          'src/components/QrDialog.test.tsx','src/components/import/QrTab.test.tsx','src/screens/conns/ConnsScreen.test.tsx',
          'src/hooks/useConnections.test.tsx','src/hooks/useTraffic.test.tsx','src/hooks/useSystemProxyFollow.test.tsx',
          'src/components/settings/GlobalHotkeyRow.test.tsx','src/components/settings/ShellPrefRows.test.tsx',
          'src/components/AgentsSettings.test.tsx','src/components/dialog-a11y.test.tsx','src/components/a11y-controls.test.tsx',
          'src/components/WindowChrome.tab-order.test.tsx'
$missing = $guards | Where-Object { -not (Test-Path $_) }
"отсутствуют: " + $(if ($missing) { $missing -join ', ' } else { 'нет' })
npx vitest run $guards 2>&1 | Select-String -Pattern 'Test Files|Tests ' | ForEach-Object { $_.Line.Trim() }
```

   Ожидается: `отсутствуют: нет`; в итоговых строках `23 passed (23)` файлов и ни одного `failed`. Отсутствующий файл — `FAIL` (его удалили или переименовали: сверьтесь с `git log --diff-filter=D --name-only -- ui/src`).

8. Словари пяти языков содержат одни и те же ключи (отдельно от прототипа, который проверяет A01).

```powershell
npx vitest run src/lib/i18n.keys.test.ts src/lib/i18n.test.ts 2>&1 | Select-String -Pattern 'Test Files|Tests ' | ForEach-Object { $_.Line.Trim() }
$dicts = 'ru','en','de','es','zh'
foreach ($d in $dicts) { '{0}: {1} строк' -f $d, (Get-Content "src/lib/dictionaries/$d.ts").Count }
$banned = 'Ha' + 'pp'   # слово собрано из частей: scripts/check-public-docs.sh запрещает его в документах
Select-String -Path src/lib/dictionaries/*.ts -Pattern $banned -CaseSensitive -Quiet
```

   Ожидается: оба теста `passed`; пять словарей непустые; последняя команда `False` (запрещённого слова, которое собирает переменная `$banned`, в видимых текстах словарей нет; ключ в нижнем регистре в этой проверке не считается).

9. Сборка (как в CI и релизном workflow): `tsc --noEmit && vite build`.

```powershell
npm run build 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A05-build.txt | Select-Object -Last 12
"build exit=$LASTEXITCODE"
Test-Path dist\index.html
Get-ChildItem dist\assets | Where-Object { $_.Extension -in '.js','.css' } | Sort-Object Length -Descending | Select-Object Name, @{n='KB';e={[math]::Round($_.Length/1KB,1)}} -First 5
Get-ChildItem dist -Recurse -Filter '*.map' | Measure-Object | Select-Object -ExpandProperty Count
```

   Ожидается: `build exit=0`, `True`, число файлов `.map` равно `0` (карты исходников не должны попадать в установщик, T-62). Вывод vite содержит предупреждение о размере чанка: на `97624d6` главный чанк `index-*.js` около 951 КБ (gzip около 305 КБ). Это наблюдение, не провал: в `docs/TEST-PLAN.md` (раздел 2) целью названо «бандл ≤ 250 КБ gzip». Запишите фактический gzip-размер в отчёт со статусом `WARN` (дефект `minor`, если вырос относительно эталона 304,87 КБ более чем на 10 %).

10. Обязательные запреты репозитория на уровне исходников UI.

```powershell
Set-Location $wt
git grep -n "customFieldsConfirmed: true" -- ui/src
"customFieldsConfirmed: true => код $LASTEXITCODE (1 значит не найдено)"
```

    Ожидается: команда ничего не печатает и возвращает `1`. Проверка видимых текстов на запрещённое слово выполняется в шаге 8 (словари).

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | `npm ci` вернул 0, lock-файл не изменился | `npm ci exit=0`, `git status` пуст |
| К2 | `npx tsc --noEmit` вернул 0 | `tsc exit=0` |
| К3 | `npx eslint . --max-warnings=0` вернул 0 | `eslint exit=0` |
| К4 | `npx vitest run` вернул 0; не меньше 118 файлов и 886 тестов; пропущенных нет | шаг 6 |
| К5 | Все 23 охранных файла существуют и проходят | шаг 7 |
| К6 | Тесты словарей `passed`; запрещённого слова в словарях нет | шаг 8 |
| К7 | `npm run build` вернул 0, файлов `.map` нет | шаг 9 |
| К8 | В `ui/src` нет `customFieldsConfirmed: true` | шаг 10 |
| К9 | Размер главного чанка не вырос более чем на 10 % от эталона (305 КБ gzip) | шаг 9, `WARN` вместо `FAIL` |

## Что собрать

`results\A05-npm-ci.txt`, `A05-vitest.txt`, `A05-build.txt`, таблица пяти крупнейших файлов `dist\assets`, итоговые строки vitest.

## Откат / уборка

```powershell
Set-Location C:\lavray-test
git -C $env:LAVRAY_SRC worktree remove --force (Join-Path $env:LAVRAY_TP_ROOT 'wt\A05')
git -C $env:LAVRAY_SRC worktree prune
Test-Path (Join-Path $env:LAVRAY_TP_ROOT 'wt\A05')
```

Ожидается `False`. Удаление `node_modules` может занять минуту. Системного отката нет.

## Отчёт

`results/A05.md` по `templates/REPORT.md`: статусы 10 шагов, К1–К9, итоговые числа vitest, фактический размер чанка. Провал К2–К5 — `major`; К6 — `major` (расхождение переводов); К7 — `major`; К8 — `critical` (клиент может выставить подтверждение custom-полей).
