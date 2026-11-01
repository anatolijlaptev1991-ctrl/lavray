# A13. Центр обновлений (T-75): цепочка доверия, загрузка, отказы, `verify-artifact`, наборы маршрутов и гео-данные (§7.5) на тестовом корне

| Поле | Значение |
|---|---|
| ID | A13 |
| Слой | авто |
| Время | 5–8 минут при первом запуске (четыре сборки Go: два ядра, ядро с тегами сборки, `updsign`, плюс копия дерева для враждебных архивов), потом около 70 секунд + тесты репозитория 1–2 минуты |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–7; Go и Python 3.12 (модуль `sqlite3`); клон репозитория `LAVRAY_SRC` на коммите выпуска `<TAG>` (по умолчанию `v0.9.1`; на момент написания — ветка с T-75 §7.5, PR #19, `dce8ba0`; без §7.5 разделы 12.* дают `FAIL`). Группа P (нагружает процессор при сборке) |
| Опасность | нет: ядра и «зеркала» работают на loopback в `C:\lavray-test\tmp\A13`; ключи тестовые и лежат вне git-дерева; системный прокси, TUN, реестр, установка и хранилище сертификатов Windows не затрагиваются |

`<TAG>` — тег выпуска под тестом; по умолчанию `v0.9.1` (единый итоговый тег плана доработки). В `env.ps1` это переменная `LAVRAY_REF`.

## Цель

Проверить подсистему обновлений ядра так, как её видит клиент, но **без настоящего корня доверия**. Корень доверия в репозитории — заглушка (`core/cmd/lavray-core/root.json`, поле `placeholder`): владелец ещё не провёл церемонию ключей, и релизные сборки отвечают на `CheckUpdates` причиной `not_configured`. Поэтому тестировщик сам создаёт **тестовые** ключи и тестовый корень, собирает ядро с этим корнем и поднимает локальные зеркала метаданных. Проверяются `CheckUpdates`, `DownloadUpdates`, `ApplyUpdates`, `Rollback`, `GetUpdateState`, `VerifyLocalUpdate` по Connect JSON, подкоманда `lavray-core verify-artifact` и защита цепочки доверия:

- состояние «не настроено» и то, что при нём сеть не трогается;
- успешный путь: проверка, загрузка в `<данные>\updates\staging`, повторная проверка при применении (анти-TOCTOU), подмена файла в staging;
- отказы с причиной (`bad_signature`, `expired`, `clock_skew`, `serial_rollback`, `wrong_product`, `wrong_channel`, `root_rotation`, `artifact_role_missing`, `mirror_unreachable`) и то, что ни один из них не обновляет «последнюю успешную проверку»;
- монотонные счётчики и служебные ключи `update.*`, которые клиент не может ни прочитать, ни записать;
- ротация корня `1 → 2` с отзывом ключей timestamp и manifest, подделка корня, корень без роли `artifact`, подложенный в каталог данных корень;
- транспорт: молчащее зеркало, ответ больше лимита 8 МиБ, редиректы, обрыв и докачка (`Range`), одна загрузка за раз;
- подмена и неверная подпись установщика, «Установить из файла» (`VerifyLocalUpdate`), коды выхода `verify-artifact`;
- доступ агентского токена и каналы stable и beta;
- **§7.5, наборы маршрутов и гео-данные через апдейтер** (разделы 12.*, подробно в разделе «§7.5 наборы и geo» ниже): `updsign geo-pack`, манифест данных с секциями `presets` и `geo`, `updsign verify`, `CheckUpdates` → `DownloadUpdates` → `ApplyUpdates` для `PRESETS` и `GEO`, откат обоих компонентов и второй откат (`no_previous`), отказы (подмена архива, ревизия не новее, враждебный архив, подмена манифеста, манифест без `geo.rev`, неверная настройка канала) и применение при работающем соединении (`ready_for_restart`, `dir_busy`).

Что здесь **не** проверяется: запуск установщика с UAC, остановка ядра и снятие системного прокси оболочкой, watchdog и откат прошлым установщиком, замок `installer_locked` — всё это оболочка, файл `M12-update-center.md` (нужна виртуальная машина). Настоящий выпуск с настоящим корнем — тоже `M12`, после церемонии ключей владельца.

## Предусловия

- Python 3.12, Go, Git; `LAVRAY_SRC` из `env.ps1`.
- Каталог `C:\lavray-test\tmp\A13` **не** лежит внутри git-дерева (`updsign` отказывается читать и писать ключи внутри репозитория). Шаг 1 это проверяет.
- Свободны произвольные порты loopback; порт 2080 не используется.

## Безопасность

Ключи, корень и «релизы» тестовые: они созданы командой `updsign genkey` на этом ПК и годятся только для проверки. Настоящие ключи выпуска, настоящий `root.json` и секреты CI сюда не передаются. Файл `core/cmd/lavray-core/root.json` в рабочей копии `wt\A13` (и тем более в клоне `src\`) не меняется: ядро с тестовым корнем собирается флагом компоновщика `-X main.rootJSONB64=…` (он сильнее файла), а ядро-заглушка — из копии дерева с заглушкой, поэтому проверка не зависит от того, лежит ли в клоне уже настоящий корень. Ничего не публикуется; зеркала слушают только `127.0.0.1`.

Зеркала работают по обычному HTTP: адреса bootstrap-источников, вшитые в ядро флагом `-X main.bootstrapURLs=…`, схемой не проверяются, а подписанный `sources.json` обязан содержать только `https` и в тесте указывает на закрытый порт 1 (быстрый отказ). Поэтому тест не нуждается в сертификатах и не трогает хранилище сертификатов. Правила «только `https`» для подписанных источников и редиректа `https → http` проверяют Go-тесты (шаг 4: `TestHttpsToHttpRedirectRejected`); скрипт проверяет, что любой редирект зеркала отвергается и цель редиректа не запрашивается.

## Шаги

1. Каталоги и проверка, что они вне git.

   ```powershell
   . C:\lavray-test\env.ps1
   $t = 'C:\lavray-test\tmp\A13'
   $wt = 'C:\lavray-test\wt\A13'
   New-Item -ItemType Directory -Force -Path $t, C:\lavray-test\results\A13 | Out-Null
   git -C $t rev-parse --is-inside-work-tree 2>&1 | Select-Object -First 1
   if (-not (Test-RepoLf)) { 'FAIL: в клоне src core.autocrlf не false (01-ENVIRONMENT.md, раздел 6); исправьте и повторите'; return }
   git -C $env:LAVRAY_SRC worktree add --detach $wt $env:LAVRAY_REF
   Test-Path (Join-Path $wt 'core\cmd\lavray-core\root.json')
   ```

   `src\` только для чтения (`01-ENVIRONMENT.md`, раздел 2, правило 1), поэтому весь файл (сборка `updsign` и ядер, Go-тесты, unittest) работает в собственной рабочей копии `wt\A13`; `src\` не используется.

   Ожидается: первая строка — `fatal: not a git repository…` (если напечатано `true`, перенесите `tmp\A13` из git-дерева), рабочая копия создана без ошибок, последняя строка — `True`.

2. Сохраните скрипт из раздела «Скрипт `a13_updater.py`» как `C:\lavray-test\tmp\A13\a13_updater.py` и запустите:

   ```powershell
   python -I "$t\a13_updater.py" (Join-Path $wt 'core') "$t\run" 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A13\run.txt | Select-Object -Last 12   # третий аргумент: base (разделы 0-11) или data (только §7.5)
   "a13 exit=$LASTEXITCODE"
   $res = Get-Content "$t\run\a13-result.json" -Raw | ConvertFrom-Json
   "проверок: $($res.total), провалов: $($res.failed), наблюдений: $($res.warnings)"
   $res.checks | Where-Object { -not $_.pass } | Select-Object id, warn, detail | Format-Table -AutoSize -Wrap
   ```

   Ожидается: `a13 exit=0`, `провалов: 0`. Эталон на теге v0.9.0 (коммит `8093656`): **298 проверок** (разделы 0–11: 144, разделы 12.*: 154) и 1 `WARN` в разделах 12.*:

   | `WARN` | Что наблюдается | Серьёзность |
   |---|---|---|
   | `12.pack.refuses.symlink` | Проверка «`geo-pack` отказывает на ссылке в каталоге» пропущена: создание символической ссылки требует прав. Нужны Режим разработчика Windows или запуск PowerShell от имени администратора; без них это ограничение ПК, не дефект. С правами проверка проходит (`PASS`, `WARN` исчезает). Ссылка внутри архива без прав проверяется в `12.hostile.symlink_entry` | не дефект |

   Ещё два `WARN` (`12.tamper.tampered_preset_file.no_stray_staged_files`: первый проверенный файл пачки наборов оставался в `staging\components` после отказа; `12.norev.has_reason_header`: отказ по манифесту без `geo.rev` шёл без причины) исправлены в 0.9.1 (D-7b, D-7c): теперь это строгие проверки, а отказ несёт причину `metadata_invalid` в сообщении и заголовке `Lavray-Update-Reason` (интерфейс показывает для неё общий текст). На `v0.9.0` эти две проверки дают `FAIL`: записывайте их как известные D-7b и D-7c со ссылкой «исправлено в 0.9.1».

   Два прежних `WARN` (подмена манифеста без причины; `update.channel` принимал любую строку) в теге v0.9.0 уже исправлены: теперь это строгие проверки `3.manifest_swapped_after_timestamp.reason_manifest_mismatch` (`manifest_mismatch` в сообщении и заголовке) и `4.settings.update_channel_is_validated` (`400 invalid_argument`); на сборках до §7.5 они дают `FAIL` серьёзности `minor`. Строка `2.rollback.presets.no_previous` вместо прежней `…unimplemented`: `Rollback(PRESETS)` без прошлой ревизии теперь `failed_precondition` с причиной `no_previous`.

   Версии в скрипте условные: тестовые ядра собираются флагом `-X …/version.Version=0.9.0` (текущая версия «установленного» приложения), а «выпуск» из `release()` по умолчанию `0.9.1`; они не зависят от версии под тестом (`v0.9.1`) и менять их не нужно.

   Если нужен только повтор без пересборки, достаточно запустить тот же скрипт ещё раз: кэш сборки Go сократит подготовку до секунд. Если скрипт остановили на середине, завершите оставшиеся ядра: `Get-Process lavray-core-test, lavray-core-placeholder, lavray-core-data -ErrorAction SilentlyContinue | Stop-Process -Force`.

3. Статические тесты workflow подписи (12 тестов; запрет `${{ inputs.* }}` внутри `run:`, права, Environment для ключей, порядок шагов `meta-refresh` и `meta-resign`):

   ```powershell
   $wt = 'C:\lavray-test\wt\A13'
   Set-Location $wt
   python -B -m unittest scripts/tests/test_signing_workflows.py -v 2>&1 | Select-Object -Last 6
   Set-Location C:\lavray-test
   ```

   Ожидается: `Ran 12 tests` и `OK`. Ключ `-B` не даёт Python писать `__pycache__` в рабочую копию.

4. Тесты репозитория, которые скрипт не повторяет (три последние команды go test — защита §7.5: параллельное применение → `aborted`, содержимое наборов отвергается при применении, `dir_busy` без путей, отказ `updsign` на архиве, который клиент не примет):

   ```powershell
   $wt = 'C:\lavray-test\wt\A13'
   Set-Location (Join-Path $wt 'core')
   go test -count=1 ./internal/updates/... ./cmd/updsign/ 2>&1 | Select-String -Pattern '^(ok|FAIL|---)'
   go test -count=1 -run 'Update|Verify|Rollback|Staging|Root' ./internal/api/ ./cmd/lavray-core/ 2>&1 | Select-String -Pattern '^(ok|FAIL|---)'
   go test -count=1 -v -run '^(TestHttpsToHttpRedirectRejected|TestRedirectCap|TestRotationSkipRejected|TestRotationRequiresNewKeys|TestRevokedKeyRejectedAfterTwoRotations|TestRotationFailsClosedWhenASourceIsSilent|TestShortStreamKeepsPartAndResumes|TestDownloadRejectsOversizedAsset|TestTimestampClockSkewTolerance|TestGeoZipSlipRejected|TestGeoSymlinkEntryRejected)$' ./internal/updates/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   go test -count=1 -v -run '^(TestEmbeddedRootValid|TestPlaceholderRootIsNotConfigured|TestNoPrivateKeysInTree)$' ./cmd/lavray-core/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   go test -count=1 -v -run '^(TestGeoZipBombCaps|TestGeoApplyRejectsInflationBomb|TestGeoDowngradeRefused|TestGeoSwapFailureRollsBack|TestGeoRollbackWithoutPreviousIsNoPrevious|TestStaleSourceJSONAfterEnsureGeoRewrite|TestPresetUpdateBatchIsAtomic|TestPresetUpdateRejectsOlderRev|TestPresetRollbackWithoutPreviousIsNoPrevious)$' ./internal/updates/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   go test -count=1 -v -run '^(TestGeoApplyFlagsProfileRestartInSession|TestPresetApplyFlagsProfileRestart|TestConcurrentApplyAborted|TestApplyRefusesSupersededOrExpiredStagedData|TestAgentDeniedDataUpdates|TestCopySourceUpdatedFlag|TestDirBusyErrorHasNoPaths|TestGeoUnsafeArchiveRejectedOnApply)$' ./internal/api/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   go test -count=1 -v -run '^(TestPublishThenClientAppliesAndRollsBack|TestClientRejectsTamperedZipFromSite|TestManifestRefusesGeoZipTheClientWouldReject)$' ./cmd/updsign/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   Set-Location C:\lavray-test
   ```

   Ожидается: строки `ok` для пакетов `internal/updates`, `cmd/updsign`, `internal/api`, `cmd/lavray-core`, для каждого перечисленного имени `--- PASS`, кроме `TestEmbeddedRootValid`. Пока `core/cmd/lavray-core/root.json` является заглушкой (церемония ключей не проведена, как в v0.9.0), `TestEmbeddedRootValid` печатает `--- SKIP` («в этой сборке нет корня доверия»): это ожидаемый результат, не `FAIL` и не пропуск по ошибке. После церемонии ключей (в `root.json` вшит настоящий корень) тест обязан дать `--- PASS` и потребует срок корня больше 180 дней; `--- SKIP` после церемонии — `FAIL`. `TestPlaceholderRootIsNotConfigured` и `TestNoPrivateKeysInTree` дают `--- PASS` всегда. Тест, которого нет в выбранном коммите (`testing: warning: no tests to run`), запишите в отклонения и сверьтесь с `go test -list 'Update|Root|Rotat' ./internal/...`.

5. Что проверяет скрипт (для отчёта и поиска причины; идентификаторы начинаются с номера раздела):

   | Раздел | Проверки | Коды и значения |
   |---|---|---|
   | 0. Стенд | `updsign` собран; тестовые ключи `k1`, `k2` (root), `t1`, `t2` (timestamp), `r1`, `r2` (manifest и sources), `a1` (artifact) и чужие `wr`, `wa`, `x1`; корни 1, 2 (ротация, отзыв `t1` и `r1`), 3 (без роли `artifact`), подделка 2; ядра: с тестовым корнем, с заглушкой, а для §7.5 ещё и с тегами сборки (`core/BUILD_TAGS`, настоящий sing-box) и тестовым корнем | — |
   | 1. Не настроено | ядро-заглушка: `CheckUpdates` → `not_configured` («updates not configured (no trust root in this build)»), `DownloadUpdates` — то же с заголовком, `GetUpdateState` без времени проверки и версии корня, `VerifyLocalUpdate` → `not_configured`; зеркала при этом **не получили ни одного запроса** | `400 failed_precondition`, причина `not_configured` |
   | 2. Успешный путь | до проверки времени проверки нет, фаза `IDLE`; `CheckUpdates` находит `0.9.1` (текущая `0.9.0`), актив совпадает с опубликованным файлом (`sha256`, длина), время проверки и рабочий источник заполнены, заметки возвращаются как данные (HTML-теги не вырезаются и не исполняются: интерфейс обязан показать их текстом, см. M12); `GetUpdateState`: корень 1, `serial` 100, `timestampFresh`; загрузка: `progress … verified`, файл `<sha256>-<имя>` внутри staging с точным содержимым и `.minisig` рядом, `.part` нет, фаза `DOWNLOADED`; `ApplyUpdates` → `verified`, `readyForRestart = "app"`; подмена байта в staging → `verifyFailed: sha256_mismatch`, фаза `FAILED`; `ApplyUpdates(CORE)` → `failed_precondition`; `Rollback(APP)` → `failed_precondition` («откат выполняет оболочка»), без компонента → `invalid_argument`, `PRESETS` без прошлой ревизии → `failed_precondition` с причиной `no_previous`; `Apply` без загрузки → `not_staged` | коды рядом с проверкой |
   | 3. Метаданные | подпись манифеста или timestamp чужим ключом → `bad_signature`; просроченные timestamp и manifest → `expired`; timestamp с `expires` на 200 часов вперёд (так выглядят часы ПК, отставшие больше чем на сутки) → `clock_skew`; чужой `product` → `wrong_product`; манифест beta в слоте stable → `wrong_channel`; подписанная более старая или та же версия → ответ `200` без обновления (время проверки обновляется); правка байта timestamp или manifest → `bad_signature`; подмена манифеста другим подписанным → `failed_precondition`, причина `manifest_mismatch` (sha256 из timestamp); мусор вместо timestamp → `failed_precondition`; `sources.json` с чужой подписью игнорируется | `400 failed_precondition`, причина в начале сообщения и в заголовке `Lavray-Update-Reason` |
   | 4. Счётчики и настройки | первый `serial` 200 сохраняется; `serial` 100 → `serial_rollback`, максимум остаётся 200; `timestamp.version` ниже сохранённой → `serial_rollback`; новее — принимается; `SetSettings` всех служебных ключей `update.*` (значения `1` и `99999999999`) → `200` с пустым `acceptedKeys`, счётчики не изменились, следующий релиз принимается; `GetSettings` их не отдаёт (только `update.channel` и `update.auto_check`); `update.channel = nightly` → `400 invalid_argument`; `update.auto_check` принимается; свежесть: при сдвиге `update.last_checked_at` на 3 суток `timestampFresh = true`, на 8 и 31 — `false` | — |
   | 5. Ротация | корень 2 (подписан `k1` и `k2`, отозваны `t1` и `r1`) принят, версия корня 2, **счётчики сброшены** для отозванных ключей (`serial` 5 принят после 301), принятый корень лежит в `updates\roots\2.root.json` и переживает перезапуск; метаданные отозванными ключами → `bad_signature`; «корень 2», подписанный только чужим `x1` → `root_rotation` и не сохраняется; корень 3 без роли `artifact` → `artifact_role_missing`; подложенный в каталог данных чужой корень не принимается | `400 failed_precondition` |
   | 6. Транспорт | зеркало 2 выключено → `503 unavailable`, причина `mirror_unreachable: 127.0.0.1:<порт>` (называется только молчащее зеркало), время проверки не меняется, после возвращения зеркала проверка проходит; оба зеркала выключены — названы оба, `DownloadUpdates` → `unavailable` с заголовком причины; `timestamp.json` больше 8 МиБ → `unavailable`, оба зеркала опрошены, без «нет обновлений»; редирект `timestamp.json` и установщика отвергается, цель редиректа не запрашивается; обрыв на 40 % → докачка запросом `Range: bytes=…` и успешная проверка; файл короче заявленного → `verifyFailed: truncated`, готового файла нет (`.part` остаётся для докачки: наблюдение); вторая загрузка во время первой → `aborted` | см. таблицу |
   | 7. Установщик | подмена одного байта при верных метаданных → `verifyFailed: sha256_mismatch`, staging пуст, фаза `FAILED`; манифест верен, а minisign установщика подписан чужим ключом → проверка проходит, загрузка → `verifyFailed: bad_signature`, staging пуст | — |
   | 8. Из файла | подпись рядом, верная → `valid`; без `.minisig` подпись берётся из манифеста (онлайн) и сохраняется рядом; чужой ключ, правка байта, та же версия, более старая, чужая платформа, чужой продукт, подпись больше 4 КиБ → `valid = false` с текстом ошибки; путь вне staging, `..\..`, пустой путь, подпись вне staging → `400 invalid_argument` | — |
   | 9. `verify-artifact` | верно: код 0 и JSON `{"sha256","version"}`; правка байта, чужой ключ, та же версия, более старая без `--allow-older`, чужая платформа, нет файла, корень-заглушка → код 1; с `--allow-older` старая версия → 0; без аргументов → 2; принятая ротация в `<данные>\updates\roots` используется; подложенный чужой корень (с ключом установщика злоумышленника) подпись злоумышленника **не** принимает | коды выхода 0, 1, 2 |
   | 10. Агент | в режимах `read` и `control` `GetUpdateState` доступен, `CheckUpdates`, `DownloadUpdates`, `ApplyUpdates`, `Rollback`, `VerifyLocalUpdate` → `403 permission_denied`, сеть не затронута | — |
   | 11. Каналы | при опубликованной только beta stable ничего не находит; beta находит `0.9.2-beta.1`; `serial` ведутся раздельно; `update.channel = beta` принимается, и `DownloadUpdates` скачивает beta | — |
   | 12.* Наборы и гео (§7.5) | семь функций, подробно в разделе «§7.5 наборы и geo» ниже | см. там |

## §7.5 наборы и geo

Секции `presets` и `geo` подписанного манифеста (`docs/UPDATE-SYSTEM.md`, §12.10) доставляют встроенные наборы маршрутов и гео-файлы (`.srs`) без установщика и без перезапуска приложения. Файлы не подписываются отдельно: их пин — sha256 в манифесте, подписанном ключом `manifest`. Этот раздел проверяет цепочку «публикация → клиент» целиком, на тех же тестовых ключах и локальном зеркале, что и разделы 0–11. Запуск только этого раздела: `python -I "$t\a13_updater.py" (Join-Path $env:LAVRAY_SRC 'core') "$t\run-data" data` (около 40 секунд; `base` запускает разделы 0–11).

**Почему целый встроенный набор.** Клиент требует, чтобы гео-архив содержал **все** файлы встроенного набора (сейчас 19: `geoip/cn.srs`, `geoip/ru.srs` и 17 файлов `geosite/…`), иначе пресет, ссылающийся на отсутствующий файл, не запустится. Поэтому скрипт копирует каталог `core/internal/presets/geo` целиком и подменяет в копии один файл пробным (`geosite/riot.srs`, корректный по форме `.srs` с другим содержимым). Подключаться с таким набором нельзя: sing-box его не разберёт, это только метка для проверки.

**Публикация вручную** (то же делает скрипт; ключи и корень — тестовые из `run\keys`, пути условные):

```powershell
# 1. Гео-набор: детерминированный zip (Store, записи по порядку, mtime 1980-01-01). Отказывает на неполном наборе,
#    ссылках, чужих файлах и повреждённых .srs; файл при отказе не создаётся.
updsign.exe geo-pack -in C:\lavray-test\tmp\A13\run\data75\geo-src -out C:\lavray-test\tmp\A13\run\data75\geo.zip
# 2. Файлы встроенных наборов с ревизией выше встроенной (lav-ru и lav-cn были 2, стали 3): каталог presets-new\lav-ru.json, lav-cn.json
# 3. Манифест данных (без -asset секции app нет, приложение клиентам не предлагается), затем timestamp и проверка
updsign.exe manifest -key file:r1.sec -keyid r1 -product lavray-windows -channel stable -serial 500 `
  -presets-dir presets-new -geo-zip geo.zip -geo-rev 7000 -geo-generated-at 2026-11-01 `
  -data-prefix v0.9.1/ -data-out site\meta\v0.9.1 -out site\meta\manifest-stable.json
updsign.exe timestamp -key file:t1.sec -keyid t1 -dir site\meta -out site\meta\timestamp.json -version 2001
updsign.exe verify -root root1.json -dir site\meta -channel stable -assets site\meta\v0.9.1 -product lavray-windows
```

Файлы данных оказываются в `site\meta\v0.9.1\` под именами `presets-<id>-<ревизия>.json` и `geo-<дата>.zip`. `verify` печатает `ok  набор lav-ru (rev 3): sha256 и содержимое сошлись` и `ok  гео-набор: sha256, длина и распаковка сошлись`.

**Что проверяют функции раздела 12** (в скобках префиксы идентификаторов; ядро с тегами сборки, чистый каталог данных на каждый сценарий):

| Функция | Что проверяется | Коды и значения |
|---|---|---|
| `sec12_tools` (`12.pack`, `12.manifest`, `12.verify`) | `geo-pack`: все файлы встроенного набора на месте и в порядке, только Store, mtime 1980-01-01, два вызова дают одинаковые байты; отказ без создания файла на неполном наборе, не-`.srs`, чужом файле, чужом каталоге, символической ссылке (`WARN` без прав на ссылки); манифест данных: подписанный конверт, секции `presets` (`lav-ru`, `lav-cn`, ревизия 3) и `geo` (`rev 7000`, `generatedAt`, `sha256`, длина, путь) **без** `app`, файлы данных рядом; `updsign manifest` отказывает на наборе с `builtin: false`, с `id`, не совпавшим с именем файла, и на не встроенном id; `verify` принимает релиз и отвергает подмену байта в архиве | код выхода 0 / не 0 |
| `sec12_success_path` (`12.state`, `12.preset`, `12.check`, `12.download`, `12.apply`, `12.geo`, `12.persist`, `12.rollback`) | до публикации: фазы `IDLE`, откатов нет, `lav-ru` ревизии 2, копия `custom:…` помнит `builtinSourceRevision = 2`; `ApplyUpdates` без загрузки → `not_staged`; `DownloadUpdates` с пустым списком качает только приложение (`no_update`), с `CORE` отказывает; `CheckUpdates` предлагает `PRESETS` (`lav-cn:2, lav-ru:2` → `lav-cn:3, lav-ru:3`) и `GEO` (дата среза), приложение не предлагается, фильтр по компоненту работает; загрузка: три события `verified`, прогресс гео с итогом, в `staging\components` три файла `<sha256>-…`, фазы `DOWNLOADED`; применение: `applied "presets"`, `applied "geo"`, без `ready_for_restart` (соединения нет); `GetPreset` показывает ревизию 3 и новый direct-домен у `lav-ru` и `lav-cn`, остальные не тронуты; копия отмечена `sourceUpdated = true` и сохраняет свои правила; `ResetBuiltinPreset(копия)` берёт новые правила и снимает отметку; `<данные>\geo` содержит новый файл, `source.json` (`rev 7000`, `sha256`, дата), `revision.txt` выше встроенной; `presets\override\lav-ru.json` записан; повторная проверка предложений не даёт, повторное применение → `not_staged`; после перезапуска ядра наборы и гео на месте; откат `PRESETS` возвращает ревизию 2 и убирает домен, откат `GEO` возвращает встроенный файл; **второй откат каждого** → `400 failed_precondition`, причина `no_previous`; после отката данные снова предлагаются | `failed_precondition`: `not_staged`, `no_update`, `no_previous` |
| `sec12_active_session` (`12.session`) | настоящее соединение с профилем-пустышкой (SOCKS на закрытый порт, слушатель на loopback, системный прокси не ставится) и активным набором `lav-ru`: применение наборов → `applied "presets"` и `ready_for_restart "profile"`; применение гео на **Windows** при работающем sing-box → `failed_precondition` / `dir_busy` (файлы набора открыты), прежние файлы целы, скачанное остаётся в staging, фаза `DOWNLOADED` (на других ОС допустимо `applied` + `ready_for_restart`); `Rollback(PRESETS)` при соединении → `needsProfileRestart = true`; после отключения то же гео применяется | `dir_busy`, `ready_for_restart "profile"` |
| `sec12_tamper_and_freshness` (`12.tamper`, `12.not_newer`, `12.fresh`) | подмена байта в архиве или файле набора на зеркале → `verifyFailed: sha256_mismatch`, в `<данные>` ничего не применено; архив, обрезанный вдвое → `truncated`; **ревизия не новее**: после применения гео с `rev 7000` набор с `rev 7000` или `6000` и другим содержимым не предлагается, `DownloadUpdates(GEO)` → `no_update`, установленный набор цел; тот же архив с более высокой ревизией не предлагается; `rev 7001` предлагается; загрузка устаревшей: серийный номер манифеста вытеснен более новым → `serial_rollback`, манифест успел истечь → `expired`, staging очищен | `verifyFailed`: `sha256_mismatch`, `truncated`, `serial_rollback`, `expired`; `no_update` |
| `sec12_race_not_newer` (`12.race`) | `not_newer` при применении: два ядра на одном каталоге данных (второе поставило более новый набор, пока первое держало скачанный старый) → у первого `verifyFailed: not_newer`; если второе ядро на том же каталоге не запускается — `WARN`, а защиту закрывают Go-тесты шага 4 | `verifyFailed: not_newer` |
| `sec12_hostile_archives` (`12.hostile`) | манифест подписан верно (тестовым ключом), а архив враждебен — так выглядит выпуск с украденным ключом manifest; для этого `updsign` собирается из **копии** дерева с отключёнными самопроверками (продукт не меняется). Четырнадцать архивов: `..` в имени (`geosite/../../evil.srs`), абсолютный путь, обратная косая, буква диска, ссылка, каталог, чужой файл, дубль без учёта регистра, не Store и не Deflate (bzip2) → `archive_unsafe`; вложенная zlib-бомба в `.srs` (70 МиБ нулей в 70 КиБ), 520 записей, запись больше 8 МиБ → `archive_limits`; не `.srs` → `geo_invalid`; нет файла встроенного набора → `geo_incomplete`. Каждый архив скачивается как любой подписанный файл, а `ApplyUpdates` даёт `verifyFailed` с причиной; каталог `geo` не изменён (`source.json` нет, файл прежний), лишних каталогов `geo.*` рядом нет, файла `evil.srs` нигде нет, staging пуст, фаза `FAILED`. В конце чистый набор применяется (ядро не «залипло») | `verifyFailed`: `archive_unsafe`, `archive_limits`, `geo_invalid`, `geo_incomplete` |
| `sec12_manifest_negatives` (`12.norev`, `12.swap`, `12.settings`) | манифест без `geo.rev` (тот же поддельный `updsign`) отвергается, гео не предлагается, время проверки не обновляется (причина `metadata_invalid` в сообщении и заголовке); подмена манифеста другим, тоже верно подписанным → `manifest_mismatch` в сообщении и заголовке, ничего не предлагается; `SetSettings update.channel = bogus` → `400 invalid_argument`, значение не меняется | `manifest_mismatch`, `invalid_argument` |

**Наблюдение 12.session (Windows).** Применение гео при работающем соединении на Windows даёт `dir_busy`: sing-box держит файлы набора открытыми, переименование каталога невозможно, прежний набор остаётся. Для пользователя это сообщение «Папка данных занята работающим соединением. Отключитесь от VPN и повторите.» (M12, часть 13). До §7.5 это место помечалось «не проверено вживую» (`docs/UPDATE-SYSTEM.md`, раздел «Не сделано и не проверено»): теперь проверено на настоящем sing-box. Если на вашем ПК гео применилось при работающем соединении, запишите это в наблюдения (не дефект): тест принимает оба исхода.

**Что не повторяет скрипт.** Содержимое набора, не прошедшее `presets.Validate` (`preset_rejected`), чужой `id`, `builtin=false` и несовпадение ревизии файла с манифестом — отказы `updsign` до подписи и Go-тесты шага 4 (`TestPresetUpdate…`); подписанный манифест на такие наборы без самопроверок скрипт не собирает. Параллельное применение (`aborted`) — `TestConcurrentApplyAborted`. Экран «Обновления» (карточка данных, значок «Исходный набор обновился») — M12, часть 13.

## Критерии PASS/FAIL

| № | Критерий | Шаг |
|---|---|---|
| К1 | `a13 exit=0`, провалов 0, проверок не меньше 298 (значение для тега v0.9.0, коммит `8093656`); допустим один `WARN` из таблицы шага 2 (`12.pack.refuses.symlink`, если у PowerShell нет права на символические ссылки). На `v0.9.0` проверки `12.tamper.tampered_preset_file.no_stray_staged_files` и `12.norev.has_reason_header` дают `FAIL` — это известные D-7b и D-7c, исправленные в 0.9.1 | 2 |
| К2 | При заглушке корня везде `not_configured`, зеркала не получают запросов | 2 (`1.*`) |
| К3 | Успешный путь: проверка, загрузка, повторная проверка, подмена в staging ловится | 2 (`2.*`) |
| К4 | Каждый неверный документ даёт свою причину и не обновляет время проверки; подмена принята ни в одном случае | 2 (`3.*`, `7.*`) |
| К5 | Счётчики монотонны, служебные ключи `update.*` не принимаются и не читаются | 2 (`4.*`) |
| К6 | Ротация принимается только от прежнего порога ключей, отзыв сбрасывает счётчики, подделка и корень без `artifact` отвергаются | 2 (`5.*`) |
| К7 | Молчащее зеркало названо, лимит размера, редиректы, докачка, одна загрузка | 2 (`6.*`) |
| К8 | «Из файла» и `verify-artifact` отвергают любое отклонение, коды выхода 0, 1, 2 | 2 (`8.*`, `9.*`) |
| К9 | Агент не может проверять, скачивать, применять, откатывать | 2 (`10.*`) |
| К10 | 12 тестов workflow подписи проходят | 3 |
| К11 | Go-тесты шага 4 проходят | 4 |
| К12 | §7.5, публикация: `geo-pack` собирает детерминированный архив и отказывает на неполном, чужом и повреждённом; манифест данных без `app`; `verify` принимает релиз и отвергает подмену | 2 (`12.pack.*`, `12.manifest.*`, `12.verify.*`) |
| К13 | §7.5, успешный путь: проверка, загрузка, применение `PRESETS` и `GEO`, новая ревизия в `GetPreset`, `sourceUpdated` у копии, откат обоих и второй откат `no_previous` | 2 (`12.check.*` … `12.rollback.*`) |
| К14 | §7.5, при соединении: `ready_for_restart "profile"` для наборов, `dir_busy` или перезапуск для гео, прежние файлы целы | 2 (`12.session.*`) |
| К15 | §7.5, отказы: подмена и обрыв (`sha256_mismatch`, `truncated`), ревизия не новее не предлагается и не ставится, устаревшая загрузка (`serial_rollback`, `expired`) | 2 (`12.tamper.*`, `12.not_newer.*`, `12.fresh.*`, `12.race.*`) |
| К16 | §7.5, враждебные архивы с верной подписью отвергаются при применении с точной причиной, данные и каталог целы; манифест без `geo.rev` и подмена манифеста отвергаются; `update.channel = bogus` → `invalid_argument` | 2 (`12.hostile.*`, `12.norev.*`, `12.swap.*`, `12.settings.*`) |

## Что собрать

`results\A13\run.txt`, копия `a13-result.json`, выводы шагов 3 и 4. Каталоги `run\keys` (тестовые ключи), `run\site`, `run\data75` (враждебные архивы) и `run\*\data` **не** копировать: ключи тестовые, но привычка не выносить ключи из каталога важна.

## Откат / уборка

```powershell
Get-Process lavray-core-test, lavray-core-placeholder, lavray-core-data -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\lavray-test\*' } | Stop-Process -Force
Set-Location C:\lavray-test
git -C $env:LAVRAY_SRC worktree remove --force C:\lavray-test\wt\A13
git -C $env:LAVRAY_SRC worktree prune
Remove-Item -Recurse -Force C:\lavray-test\tmp\A13
Test-Path C:\lavray-test\tmp\A13
Test-Path C:\lavray-test\wt\A13
git -C $env:LAVRAY_SRC status --short
```

Ожидается два `False` и пустой вывод `git status --short` (клон `LAVRAY_SRC` не менялся).

## Отчёт

`results/A13.md` по `templates/REPORT.md`: шаги 1–4, К1–К16. Серьёзность: принятое обновление с неверной подписью, подменой, откатом serial или чужим корнем (К4, К6, К8), доступ агента (К9), служебный ключ `update.*`, принятый от клиента (К5), применённый враждебный архив, запись вне каталога `geo` или применённая подмена (К15, К16) — `critical`; «нет обновлений» вместо `not_configured` или `mirror_unreachable` (К2, К7), файл в staging после отказа (К7, К4), счётчики не сброшены после отзыва ключей (К6), набор или гео не применились, не откатились или не пережили перезапуск, ревизия «не новее» принята (К13, К15), половинчатое состояние каталога после `dir_busy` (К14) — `major`; `WARN` из таблицы шага 2 — `minor`.

## Скрипт `a13_updater.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A13: центр обновлений (T-75) на настоящем ядре, loopback и ТЕСТОВОМ корне доверия, который создаётся здесь же.

Что делает: собирает updsign, создаёт ключи вне git-дерева, подписывает тестовый root, собирает два ядра
(с тестовым корнем и с заглушкой корня из репозитория), поднимает два «зеркала» метаданных на loopback
(обычный HTTP: адреса bootstrap-источников не проверяются на https, а подписанный sources.json содержит только
недостижимые https-адреса) и проходит UpdateService по Connect JSON и подкоманду `verify-artifact`.
Настоящего корня доверия и настоящих ключей выпуска здесь нет и быть не должно.

Запуск: python -I a13_updater.py <каталог core репозитория> <каталог результатов> [base|data]
(без третьего аргумента - всё; base - разделы 0-11; data - разделы 12.* про наборы и гео, §7.5)
Код выхода: 0 - все проверки PASS, 1 - есть FAIL. Итог: <каталог>/a13-result.json.
"""
import base64
import hashlib
import http.server
import json
import os
import platform
import secrets
import shutil
import socket
import stat
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
import zlib

sys.stdout.reconfigure(encoding="utf-8")
CORE_SRC, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(OUT, exist_ok=True)
RESULTS = []
VERSION_PKG = "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/version.Version"
APP_VERSION = "0.9.0"
ASSET = "windows-arm64" if "arm" in platform.machine().lower() else "windows-x64"
PRODUCT = "lavray-windows"
NL = chr(10)


def check(cid, ok, detail="", warn=False):
    """warn=True: наблюдение, при провале печатается WARN и итог файла не меняется."""
    RESULTS.append({"id": cid, "pass": bool(ok), "warn": bool(warn and not ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else ("WARN " if warn else "FAIL ")) + cid + ("" if ok else " :: " + str(detail)[:220]), flush=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def run(cmd, cwd=None, env=None, timeout=900):
    p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, timeout=timeout)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def sha_hex(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    with open(path, "rb") as f:
        return f.read()


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode("utf-8"))


# ------------------------------------------------------------------ стенд: ключи, корни, сборка ----

KEYS = os.path.join(OUT, "keys")  # вне git-дерева: updsign отказывается читать и писать ключи внутри репозитория
SITE = os.path.join(OUT, "site")
META = os.path.join(SITE, "meta")
UPDSIGN = os.path.join(OUT, "updsign.exe")
P1, P2 = free_port(), free_port()
BOOT = [f"http://127.0.0.1:{P1}/meta", f"http://127.0.0.1:{P2}/meta"]
PUB = {}


def ups(*args, expect=0, tool=None):
    rc, out, err = run([tool or UPDSIGN, *args])
    if rc != expect:
        raise RuntimeError(f"updsign {' '.join(args[:2])}: код {rc}: {err.strip()[:200]}")
    return out


def kf(name):
    return os.path.join(KEYS, name + ".sec")


def genkey(role, name):
    ups("genkey", "-role", role, "-out", kf(name), "-pub", kf(name) + ".pub.json")
    PUB[name] = json.loads(read(kf(name) + ".pub.json"))["root_key"]


def root_json(path, version, keyids, roles, signers, prev=None, expect=0, ttl_days=730):
    """keyids - id ключей, roles - {роль: [id]}; signers - id ключей, которыми подписывается корень."""
    draft = {"type": "root", "version": version,
             "expires": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + ttl_days * 86400)),
             "keys": {k: PUB[k] for k in keyids}, "roles": {r: {"keyids": ids, "threshold": 1} for r, ids in roles.items()}}
    dpath = path + ".draft.json"
    write(dpath, json.dumps(draft))
    cmd = ["root"]
    for s in signers:
        cmd += ["-key", f"{s}=file:{kf(s)}"]
    cmd += ["-in", dpath, "-out", path]
    if prev:
        cmd += ["-prev", prev]
    return ups(*cmd, expect=expect)


ROLES_V1 = {"root": ["k1"], "timestamp": ["t1"], "manifest": ["r1"], "sources": ["r1"], "artifact": ["a1"]}
ROLES_V2 = {"root": ["k2"], "timestamp": ["t2"], "manifest": ["r2"], "sources": ["r2"], "artifact": ["a1"]}


def setup_keys_and_roots():
    shutil.rmtree(KEYS, ignore_errors=True)
    for role, name in (("root", "k1"), ("root", "k2"), ("timestamp", "t1"), ("timestamp", "t2"), ("manifest", "r1"), ("manifest", "r2"),
                       ("artifact", "a1"), ("manifest", "wr"), ("artifact", "wa"), ("root", "x1")):
        genkey(role, name)
    root_json(os.path.join(KEYS, "root1.json"), 1, ["k1", "t1", "r1", "a1"], ROLES_V1, ["k1"])
    # ротация 1 -> 2: подписана прежним (k1) и новым (k2) ключами; отзываются t1 и r1
    root_json(os.path.join(KEYS, "root2.json"), 2, ["k2", "t2", "r2", "a1"], ROLES_V2, ["k1", "k2"], prev=os.path.join(KEYS, "root1.json"))
    # корень 3 без роли artifact: клиент обязан отказать (fail-closed)
    roles3 = {r: ids for r, ids in ROLES_V2.items() if r != "artifact"}
    root_json(os.path.join(KEYS, "root3.json"), 3, ["k2", "t2", "r2"], roles3, ["k2"], prev=os.path.join(KEYS, "root2.json"))
    # подделка: «корень 2», подписанный только чужим ключом x1, без участия прежнего корня
    forged_roles = {"root": ["x1"], "timestamp": ["t1"], "manifest": ["r1"], "sources": ["r1"], "artifact": ["a1"]}
    root_json(os.path.join(KEYS, "root2-forged.json"), 2, ["x1", "t1", "r1", "a1"], forged_roles, ["x1"])
    # та же подделка, но с ключом установщика злоумышленника (wa) в роли artifact
    forged_art = dict(forged_roles, artifact=["wa"])
    root_json(os.path.join(KEYS, "root2-forged-artifact.json"), 2, ["x1", "t1", "r1", "wa"], forged_art, ["x1"])


def build(name, root_path, tags=""):
    exe = os.path.join(OUT, name)
    flags = [f"-X main.bootstrapURLs={','.join(BOOT)}", f"-X {VERSION_PKG}={APP_VERSION}"]
    if root_path:
        flags.append("-X main.rootJSONB64=" + base64.b64encode(read(root_path)).decode())
    env = dict(os.environ, CGO_ENABLED="0")
    src = CORE_SRC
    if not root_path:
        # ядро-заглушка собирается из копии дерева с заглушкой root.json: так проверка не зависит от того, лежит ли в
        # репозитории уже настоящий корень (после церемонии ключей)
        src = os.path.join(OUT, "core-placeholder-src")
        shutil.rmtree(src, ignore_errors=True)
        shutil.copytree(CORE_SRC, src, ignore=shutil.ignore_patterns(".git", "*.exe"))
        write(os.path.join(src, "cmd", "lavray-core", "root.json"), '{"placeholder": true}')
    cmd = ["go", "build"] + (["-tags", tags] if tags else []) + ["-ldflags", " ".join(flags), "-o", exe, "./cmd/lavray-core"]
    rc, out, err = run(cmd, cwd=src, env=env)
    if rc != 0:
        raise RuntimeError(f"go build {name}: {err.strip()[:300]}")
    return exe


# ------------------------------------------------------------------ зеркало метаданных ----

class Site:
    """Два HTTP-«зеркала» одного каталога site/. Поведение управляется полем behave; запросы пишутся в log."""

    def __init__(self):
        self.behave = {}
        self.log = []
        self.servers = {}

    def start(self, port):
        site = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def do_GET(self):
                site.handle(self, port)

        srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
        srv.daemon_threads = True
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.servers[port] = srv

    def stop(self, port):
        srv = self.servers.pop(port, None)
        if srv:
            srv.shutdown()
            srv.server_close()

    def hits(self, suffix):
        return [h for h in self.log if h[1].split("?")[0].endswith(suffix)]

    def handle(self, h, port):
        path = h.path
        rng = h.headers.get("Range", "")
        self.log.append((port, path, rng))
        base = path.split("?")[0]
        for suffix, loc in self.behave.get("redirect", {}).items():
            if base.endswith(suffix):
                h.send_response(302)
                h.send_header("Location", loc.format(port=port))
                h.send_header("Content-Length", "0")
                h.end_headers()
                return
        local = os.path.join(SITE, *[p for p in base.split("/") if p])
        if not os.path.isfile(local):
            h.send_response(404)
            h.send_header("Content-Length", "0")
            h.end_headers()
            return
        data = read(local)
        for suffix, size in self.behave.get("oversize", {}).items():
            if base.endswith(suffix):
                data = data + b" " * size
        for suffix, fn in self.behave.get("transform", {}).items():
            if base.endswith(suffix):
                data = fn(data)
        start = 0
        status = 200
        if rng.startswith("bytes=") and rng.endswith("-"):
            start = int(rng[6:-1])
            status = 206
        body = data[start:]
        h.send_response(status)
        h.send_header("Content-Length", str(len(body)))
        if status == 206:
            h.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
        h.end_headers()
        cut = self.behave.get("cut_first")
        if cut and base.endswith(cut["suffix"]) and not rng and not cut.get("done"):
            cut["done"] = True
            h.wfile.write(body[: int(len(body) * cut["fraction"])])
            h.wfile.flush()
            h.close_connection = True
            h.connection.close()
            return
        slow = self.behave.get("slow")
        try:
            if slow and base.endswith(slow["suffix"]):
                step = slow["chunk"]
                for i in range(0, len(body), step):
                    h.wfile.write(body[i:i + step])
                    h.wfile.flush()
                    time.sleep(slow["delay"])
            else:
                h.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass


SITE_SRV = Site()


# ------------------------------------------------------------------ публикация ----

INSTALLER = secrets.token_bytes(300_000)
NOTES = {"ru": "Тест: что нового " + chr(60) + "img src=x onerror=alert(1)" + chr(62) + NL + "вторая строка", "en": "Test notes"}


def release(root=None, ver="0.9.1", serial=100, tsv=1000, channel="stable", file_channel=None, product=PRODUCT, mkey="r1", mkid="r1",
            akey="a1", tkey="t1", tkid="t1", ts_ttl="168h", m_ttl="720h", installer=None, extra_roots=(), skey=None, keep=False):
    """Пересобирает site/meta: корень, sources.json, manifest-<канал>.json, timestamp.json и установщик."""
    if not keep:
        shutil.rmtree(META, ignore_errors=True)
    os.makedirs(META, exist_ok=True)
    shutil.copyfile(root or os.path.join(KEYS, "root1.json"), os.path.join(META, "root.json"))
    for name, src in extra_roots:
        shutil.copyfile(src, os.path.join(META, name))
    inst = installer if installer is not None else INSTALLER
    fname = f"v{ver}/LAVRay-{ver}-x64-setup.exe"
    ipath = os.path.join(META, *fname.split("/"))
    write(ipath, inst)
    sdraft = os.path.join(KEYS, "sources.draft.json")
    write(sdraft, json.dumps({"type": "sources", "version": 1, "artifacts": ["https://127.0.0.1:1/dl"], "metadata": ["https://127.0.0.1:1/meta"]}))
    ups("sources", "-key", f"file:{kf(skey or mkey)}", "-keyid", mkid, "-in", sdraft, "-out", os.path.join(META, "sources.json"))
    npath = os.path.join(KEYS, "notes.json")
    write(npath, json.dumps(NOTES, ensure_ascii=False))
    out = os.path.join(META, f"manifest-{file_channel or channel}.json")
    ups("manifest", "-key", f"file:{kf(mkey)}", "-keyid", mkid, "-artifact-key", f"file:{kf(akey)}", "-product", product, "-channel", channel,
        "-version", ver, "-serial", str(serial), "-asset", f"{ASSET}={fname}={ipath}", "-notes", npath, f"-expires={m_ttl}", "-out", out)
    ups("timestamp", "-key", f"file:{kf(tkey)}", "-keyid", tkid, "-dir", META, "-out", os.path.join(META, "timestamp.json"),
        "-version", str(tsv), f"-expires={ts_ttl}")
    return {"installer": ipath, "sha256": sha_hex(inst), "length": len(inst), "name": fname}


def sign_artifact(path, key, version, serial=100, channel="stable", product=PRODUCT, platform_key=None, out=None):
    out = out or path + ".minisig"
    ups("artifact", "-key", f"file:{kf(key)}", "-file", path, "-product", product, "-platform", platform_key or ASSET,
        "-channel", channel, "-version", version, "-serial", str(serial), "-out", out)
    return out


# ------------------------------------------------------------------ ядро ----

class Core:
    def __init__(self, exe, name, data=None, fresh=True):
        self.exe, self.name = exe, name
        self.root = os.path.join(OUT, name)
        if fresh and data is None:
            shutil.rmtree(self.root, ignore_errors=True)
        self.data = data or os.path.join(self.root, "data")
        os.makedirs(self.data, exist_ok=True)
        self.tok, self.agent = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        self.p = None

    def start(self):
        self.p = subprocess.Popen([self.exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", self.data], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, self.name + "-stderr.log"), "ab"))
        self.p.stdin.write((self.tok + NL + self.agent + NL).encode())
        self.p.stdin.flush()
        self.base = "http://" + self.p.stdout.readline().decode().split()[1].replace("tcp://", "")
        self.rpc("SettingsService", "SetSettings", {"values": {"update.auto_check": {"boolValue": False}}})
        return self

    def rpc(self, svc, method, body=None, token=None):
        """Возвращает (HTTP-статус, тело, заголовки)."""
        req = urllib.request.Request(f"{self.base}/lavray.v1.{svc}/{method}", data=json.dumps(body or {}).encode(),
                                     headers={"Authorization": "Bearer " + (token or self.tok), "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {}), r.headers
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(raw), e.headers
            except ValueError:
                return e.code, raw, e.headers

    def stream(self, svc, method, body=None, timeout=120, token=None):
        """Server-stream connect+json: все кадры до конца потока; возвращает (кадры, конечный кадр)."""
        raw = json.dumps(body or {}).encode()
        env = b"\x00" + struct.pack(">I", len(raw)) + raw
        req = urllib.request.Request(f"{self.base}/lavray.v1.{svc}/{method}", data=env, headers={
            "Authorization": "Bearer " + (token or self.tok), "Content-Type": "application/connect+json", "Connect-Protocol-Version": "1"})
        frames, end = [], {}
        try:
            r = urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            return [], {"http": e.code}
        while True:
            head = r.read(5)
            if len(head) < 5:
                break
            flags, n = head[0], struct.unpack(">I", head[1:])[0]
            payload = r.read(n)
            msg = json.loads(payload) if payload else {}
            if flags & 2:
                end = msg
                break
            frames.append(msg)
        r.close()
        return frames, end

    def stop(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=30)
        except Exception:  # noqa: BLE001
            self.p.kill()
            self.p.wait()

    # --- обёртки ---
    def check(self, channel="UPDATE_CHANNEL_STABLE"):
        return self.rpc("UpdateService", "CheckUpdates", {"channel": channel})

    def state(self):
        st, r, _ = self.rpc("UpdateService", "GetUpdateState", {})
        return r if st == 200 else {}

    def download(self):
        return self.stream("UpdateService", "DownloadUpdates", {})

    def staging(self):
        return os.path.join(self.data, "updates", "staging")


def reason(r):
    """(код Connect, причина из начала сообщения, заголовок причины)."""
    st, body, hdr = r
    msg = body.get("message", "") if isinstance(body, dict) else ""
    return body.get("code") if isinstance(body, dict) else None, msg.split(":", 1)[0] if ":" in msg else "", hdr.get("Lavray-Update-Reason") if hdr else None


def kinds(frames):
    return [next((k for k in f if k != "tsMs"), "?") for f in frames]


def staged_files(c):
    d = c.staging()
    return sorted(os.listdir(d)) if os.path.isdir(d) else []


# ================================================================== сценарии ====

X = {}  # exe, exe_ph, story_data


def R(name):
    return os.path.join(KEYS, name)


def ms_now():
    return int(time.time() * 1000)


def chain(c):
    return c.state().get("chainState", {})


def last_checked(c):
    return int(c.state().get("lastCheckedAtMs", 0) or 0)


def inside(path, root):
    return os.path.normcase(os.path.abspath(path)).startswith(os.path.normcase(os.path.abspath(root)) + os.sep)


def set_state(data, key, value):
    import sqlite3
    con = sqlite3.connect(os.path.join(data, "lavray.db"))
    try:
        con.execute("UPDATE settings SET value = ? WHERE key = ?", (str(value), key))
        con.commit()
    finally:
        con.close()


def sec1_not_configured():
    """1. Заглушка корня из репозитория: причина not_configured везде, сеть не трогается."""
    release()
    SITE_SRV.log.clear()
    c = Core(X["exe_ph"], "s1").start()
    r = c.check()
    check("1.check.not_configured", r[0] == 400 and reason(r) == ("failed_precondition", "not_configured", "not_configured"), (r[0], reason(r)))
    check("1.check.message_says_no_trust_root", "no trust root" in r[1].get("message", ""), r[1])
    frames, end = c.download()
    check("1.download.not_configured", not frames and end.get("error", {}).get("code") == "failed_precondition" and
          end.get("metadata", {}).get("Lavray-Update-Reason") == ["not_configured"], end)
    st = c.rpc("UpdateService", "GetUpdateState", {})
    check("1.state.never_checked", st[0] == 200 and "lastCheckedAtMs" not in st[1] and not st[1].get("chainState", {}).get("rootVersion"), st[1])
    os.makedirs(c.staging(), exist_ok=True)
    fake = os.path.join(c.staging(), "0" * 64 + "-x.exe")
    write(fake, b"x")
    r = c.rpc("UpdateService", "VerifyLocalUpdate", {"installerPath": fake})
    check("1.verify_local.not_configured", r[0] == 400 and reason(r)[1] == "not_configured", reason(r))
    check("1.network_untouched", not SITE_SRV.log, SITE_SRV.log[:2])
    c.stop()


def sec2_success_path():
    """2. Тестовый корень: проверка, загрузка, повторная проверка при применении."""
    info = release()
    c = Core(X["exe"], "s2").start()
    st = c.rpc("UpdateService", "GetUpdateState", {})
    check("2.state.before", st[0] == 200 and "lastCheckedAtMs" not in st[1] and st[1]["components"][0]["phase"] == "PHASE_IDLE", st[1])
    r = c.check()
    av = r[1].get("available", [{}])[0] if r[0] == 200 else {}
    asset = av.get("manifest", {}).get("assets", {}).get(ASSET, {})
    check("2.check.update_found", r[0] == 200 and av.get("availableVersion") == "0.9.1" and av.get("currentVersion") == "0.9.0" and
          av.get("component") == "UPDATE_COMPONENT_APP" and r[1].get("currentAppVersion") == "0.9.0", (r[0], str(r[1])[:150]))
    check("2.check.asset_matches_published_file", asset.get("sha256") == info["sha256"] and asset.get("length") == str(info["length"]), asset)
    check("2.check.last_checked_and_source", abs(last_checked(c) - ms_now()) < 120_000 and r[1].get("workingSources", [""])[0].startswith("http://127.0.0.1:"),
          (r[1].get("lastCheckedAtMs"), r[1].get("workingSources")))
    check("2.check.notes_are_plain_data", "<img src=x onerror=alert(1)>" in av.get("notes", {}).get("ru", ""), av.get("notes"))
    ch = chain(c)
    check("2.state.chain", ch.get("rootVersion") == 1 and ch.get("maxSerial", {}).get("stable") == "100" and ch.get("timestampFresh") is True, ch)
    frames, end = c.download()
    k = kinds(frames)
    ver = next((f["verified"] for f in frames if "verified" in f), {})
    check("2.download.event_order", k and k[0] == "progress" and k[-1] == "verified" and set(k[:-1]) == {"progress"} and end == {}, (k, end))
    check("2.download.progress_total", frames and frames[0]["progress"].get("totalBytes") == str(info["length"]), frames[:1])
    sp = ver.get("stagedPath", "")
    check("2.download.staged_inside_staging", sp and inside(sp, c.staging()) and os.path.basename(sp).startswith(info["sha256"] + "-"), sp)
    check("2.download.staged_bytes_equal_published", sp and os.path.isfile(sp) and read(sp) == INSTALLER and ver.get("sha256") == info["sha256"], ver.get("sha256"))
    names = staged_files(c)
    check("2.download.staging_has_installer_and_signature_only", len(names) == 2 and any(n.endswith(".exe.minisig") for n in names) and not any(n.endswith(".part") for n in names), names)
    comp = c.state().get("components", [{}])[0]
    check("2.state.downloaded", comp.get("phase") == "PHASE_DOWNLOADED" and comp.get("stagedVersion") == "0.9.1", comp)
    frames, end = c.stream("UpdateService", "ApplyUpdates", {})
    check("2.apply.ready_for_restart", kinds(frames) == ["verified", "readyForRestart"] and frames[-1]["readyForRestart"] == "app" and end == {}, (kinds(frames), end))
    check("2.apply.phase_ready_for_restart", c.state()["components"][0]["phase"] == "PHASE_READY_FOR_RESTART", c.state()["components"][0])
    # подмена файла в staging после проверки: повторная проверка при применении ловит её
    with open(sp, "r+b") as f:
        f.seek(10)
        b = f.read(1)
        f.seek(10)
        f.write(bytes([b[0] ^ 1]))
    frames, end = c.stream("UpdateService", "ApplyUpdates", {})
    check("2.apply.tampered_staging_rejected", kinds(frames) == ["verifyFailed"] and frames[0]["verifyFailed"]["reason"] == "sha256_mismatch", (kinds(frames), end))
    comp = c.state()["components"][0]
    check("2.apply.phase_failed_after_tamper", comp.get("phase") == "PHASE_FAILED" and "staging" in comp.get("error", ""), comp)
    # прочие ветки Apply и Rollback
    frames, end = c.stream("UpdateService", "ApplyUpdates", {"components": ["UPDATE_COMPONENT_CORE"]})
    check("2.apply.core_component_precondition", end.get("error", {}).get("code") == "failed_precondition", end)
    r = c.rpc("UpdateService", "Rollback", {"component": "UPDATE_COMPONENT_APP"})
    check("2.rollback.app_is_for_the_shell", r[0] == 400 and r[1]["code"] == "failed_precondition" and "update_rollback" in r[1]["message"], r[1])
    r = c.rpc("UpdateService", "Rollback", {"component": "UPDATE_COMPONENT_UNSPECIFIED"})
    check("2.rollback.unspecified.invalid_argument", r[0] == 400 and r[1]["code"] == "invalid_argument", r[1])
    r = c.rpc("UpdateService", "Rollback", {"component": "UPDATE_COMPONENT_PRESETS"})
    check("2.rollback.presets.no_previous", r[0] == 400 and r[1]["code"] == "failed_precondition" and r[1]["message"].startswith("no_previous") and
          r[2].get("Lavray-Update-Reason") == "no_previous", r[:2])
    c.stop()
    c = Core(X["exe"], "s2b").start()
    frames, end = c.stream("UpdateService", "ApplyUpdates", {})
    check("2.apply.without_download.not_staged", not frames and end.get("error", {}).get("code") == "failed_precondition" and
          end.get("metadata", {}).get("Lavray-Update-Reason") == ["not_staged"], end)
    c.stop()


def sec3_metadata_negatives():
    """3. Неверные метаданные: у каждого случая своя причина; ни один не обновляет last_checked_at."""
    cases = [
        ("manifest_signed_by_wrong_key", dict(mkey="wr", mkid="r1"), "bad_signature"),
        ("timestamp_signed_by_wrong_key", dict(tkey="t2", tkid="t1"), "bad_signature"),
        ("timestamp_expired", dict(ts_ttl="-1h"), "expired"),
        ("manifest_expired", dict(m_ttl="-1h"), "expired"),
        ("timestamp_from_the_future_is_clock_skew", dict(ts_ttl="200h"), "clock_skew"),
        ("foreign_product", dict(product="lavray-linux"), "wrong_product"),
        ("beta_manifest_in_stable_slot", dict(channel="beta", file_channel="stable"), "wrong_channel"),
    ]
    for name, kw, want in cases:
        release(**kw)
        c = Core(X["exe"], "s3").start()
        r = c.check()
        check(f"3.{name}.{want}", r[0] == 400 and reason(r) == ("failed_precondition", want, want), (r[0], reason(r)))
        check(f"3.{name}.last_checked_untouched", last_checked(c) == 0, c.state())
        c.stop()
    for name, ver in (("older_signed_version", "0.8.0"), ("same_version", "0.9.0")):
        release(ver=ver)
        c = Core(X["exe"], "s3").start()
        r = c.check()
        check(f"3.{name}.no_update_but_checked", r[0] == 200 and not r[1].get("available") and last_checked(c) > 0, (r[0], str(r[1])[:120]))
        c.stop()
    # правка подписанных документов
    release()
    ts = bytearray(read(os.path.join(META, "timestamp.json")))
    ts[ts.index(b"version") + 12] ^= 1
    write(os.path.join(META, "timestamp.json"), bytes(ts))
    c = Core(X["exe"], "s3").start()
    r = c.check()
    check("3.timestamp_byte_flipped.bad_signature", reason(r)[1] == "bad_signature", reason(r))
    c.stop()
    release()
    mf = bytearray(read(os.path.join(META, "manifest-stable.json")))
    mf[mf.index(b"serial") + 9] ^= 1
    write(os.path.join(META, "manifest-stable.json"), bytes(mf))
    c = Core(X["exe"], "s3").start()
    r = c.check()
    check("3.manifest_byte_flipped.bad_signature", reason(r)[1] == "bad_signature", reason(r))
    c.stop()
    # подмена манифеста другим, тоже верно подписанным (mix-and-match): его sha256 закреплён в timestamp
    release(serial=90, tsv=1000)
    other = read(os.path.join(META, "manifest-stable.json"))
    release(serial=100, tsv=1000)
    write(os.path.join(META, "manifest-stable.json"), other)
    c = Core(X["exe"], "s3").start()
    r = c.check()
    check("3.manifest_swapped_after_timestamp.rejected", r[0] == 400 and r[1].get("code") == "failed_precondition" and "sha256" in r[1].get("message", ""), r[1])
    check("3.manifest_swapped_after_timestamp.reason_manifest_mismatch", reason(r) == ("failed_precondition", "manifest_mismatch", "manifest_mismatch"), reason(r))
    c.stop()
    release()
    write(os.path.join(META, "timestamp.json"), b"not json")
    c = Core(X["exe"], "s3").start()
    r = c.check()
    check("3.garbage_timestamp.rejected", r[0] == 400 and r[1].get("code") == "failed_precondition" and last_checked(c) == 0, r[1])
    c.stop()
    # sources.json с чужой подписью игнорируется: проверка идёт по bootstrap-списку сборки
    release(skey="wr")
    c = Core(X["exe"], "s3").start()
    r = c.check()
    check("3.sources_signed_by_wrong_key_ignored", r[0] == 200 and r[1].get("available"), (r[0], str(r[1])[:100]))
    c.stop()


def sec4_state():
    """4. Монотонные счётчики, служебные ключи update.*, свежесть проверки."""
    release(serial=200, tsv=2000)
    c = Core(X["exe"], "s4").start()
    r = c.check()
    check("4.serial.first_check_saves_maximum", r[0] == 200 and chain(c).get("maxSerial", {}).get("stable") == "200", chain(c))
    release(serial=100, tsv=2001)
    r = c.check()
    check("4.serial.rollback_rejected", r[0] == 400 and reason(r) == ("failed_precondition", "serial_rollback", "serial_rollback"), reason(r))
    check("4.serial.maximum_kept_after_rejection", chain(c).get("maxSerial", {}).get("stable") == "200", chain(c))
    release(serial=300, tsv=1500)
    r = c.check()
    check("4.timestamp.version_rollback_rejected", reason(r)[1] == "serial_rollback" and "timestamp.version" in r[1].get("message", ""), r[1])
    release(serial=300, tsv=2002)
    r = c.check()
    check("4.serial.newer_accepted", r[0] == 200 and chain(c).get("maxSerial", {}).get("stable") == "300", chain(c))
    # клиент не может ни понизить, ни повысить счётчики через SetSettings
    keys = ["update.root_json", "update.root_version", "update.timestamp_version", "update.serial_stable", "update.serial_beta", "update.last_checked_at", "update.last_url"]
    for value in ("1", "99999999999"):
        r = c.rpc("SettingsService", "SetSettings", {"values": {k: {"stringValue": value} for k in keys}})
        check(f"4.settings.internal_keys_not_accepted.{value}", r[0] == 200 and not r[1].get("acceptedKeys"), r[1])
    check("4.settings.counters_unchanged", chain(c).get("maxSerial", {}).get("stable") == "300" and chain(c).get("rootVersion") == 1, chain(c))
    release(serial=301, tsv=2003)
    r = c.check()
    check("4.settings.next_release_still_accepted", r[0] == 200 and chain(c).get("maxSerial", {}).get("stable") == "301", (r[0], chain(c)))
    r = c.rpc("SettingsService", "GetSettings", {"keys": keys + ["update.channel", "update.auto_check"]})
    got = set(r[1].get("values", {})) if r[0] == 200 else set()
    check("4.settings.internal_keys_not_readable", got == {"update.channel", "update.auto_check"}, sorted(got))
    r = c.rpc("SettingsService", "SetSettings", {"values": {"update.channel": {"stringValue": "nightly"}}})
    check("4.settings.update_channel_is_validated", r[0] == 400 and r[1].get("code") == "invalid_argument", (r[0], str(r[1])[:80]))
    c.rpc("SettingsService", "SetSettings", {"values": {"update.channel": {"stringValue": "stable"}}})
    r = c.rpc("SettingsService", "SetSettings", {"values": {"update.auto_check": {"boolValue": True}}})
    check("4.settings.auto_check_accepted", r[0] == 200 and r[1].get("acceptedKeys") == ["update.auto_check"], r[1])
    c.rpc("SettingsService", "SetSettings", {"values": {"update.auto_check": {"boolValue": False}}})
    # свежесть: GetUpdateState сообщает время последней проверки; старше 7 суток - timestampFresh = false
    c.stop()
    for days, fresh in ((3, True), (8, False), (31, False)):
        set_state(c.data, "update.last_checked_at", ms_now() - days * 86_400_000)
        c = Core(X["exe"], "s4", data=c.data, fresh=False).start()
        s = c.state()
        age = (ms_now() - int(s.get("lastCheckedAtMs", 0))) / 86_400_000
        check(f"4.freshness.{days}_days", abs(age - days) < 0.1 and bool(s.get("chainState", {}).get("timestampFresh")) is fresh, (round(age, 2), s.get("chainState")))
        c.stop()
    X["story_data"] = c.data


def sec5_rotation():
    """5. Ротация корня 1 -> 2 с отзывом ключей t1 и r1, подделка, корень без роли artifact."""
    data = X["story_data"]
    release(root=R("root2.json"), serial=5, tsv=10, mkey="r2", mkid="r2", tkey="t2", tkid="t2", extra_roots=[("2.root.json", R("root2.json"))])
    c = Core(X["exe"], "s5", data=data, fresh=False).start()
    r = c.check()
    ch = chain(c)
    check("5.rotation.accepted", r[0] == 200 and ch.get("rootVersion") == 2, (r[0], ch))
    check("5.rotation.counters_reset_for_revoked_keys", ch.get("maxSerial", {}).get("stable") == "5", ch)
    rd = os.path.join(data, "updates", "roots")
    roots = sorted(os.listdir(rd)) if os.path.isdir(rd) else []
    check("5.rotation.accepted_root_stored_as_chain", roots == ["2.root.json"], roots)
    c.stop()
    c = Core(X["exe"], "s5", data=data, fresh=False).start()
    check("5.rotation.survives_restart", chain(c).get("rootVersion") == 2, chain(c))
    release(root=R("root2.json"), serial=6, tsv=11, extra_roots=[("2.root.json", R("root2.json"))])  # метаданные старыми ключами t1/r1
    r = c.check()
    check("5.rotation.revoked_keys_rejected", reason(r) == ("failed_precondition", "bad_signature", "bad_signature"), reason(r))
    c.stop()
    release(root=R("root1.json"), extra_roots=[("2.root.json", R("root2-forged.json"))])
    c = Core(X["exe"], "s5f").start()
    r = c.check()
    check("5.forged_root.root_rotation", reason(r) == ("failed_precondition", "root_rotation", "root_rotation"), reason(r))
    rd = os.path.join(c.data, "updates", "roots")
    check("5.forged_root.not_stored", not os.path.isdir(rd) or not os.listdir(rd), "подделка сохранена на диск")
    c.stop()
    release(root=R("root3.json"), serial=7, tsv=12, mkey="r2", mkid="r2", tkey="t2", tkid="t2",
            extra_roots=[("2.root.json", R("root2.json")), ("3.root.json", R("root3.json"))])
    c = Core(X["exe"], "s5g").start()
    r = c.check()
    check("5.root_without_artifact_role.fail_closed", reason(r) == ("failed_precondition", "artifact_role_missing", "artifact_role_missing"), reason(r))
    c.stop()
    # подложенный в каталог данных «корень 2», подписанный чужим ключом, в цепочку не встаёт
    release()
    c = Core(X["exe"], "s5h").start()
    c.stop()
    os.makedirs(os.path.join(c.data, "updates", "roots"), exist_ok=True)
    shutil.copyfile(R("root2-forged.json"), os.path.join(c.data, "updates", "roots", "2.root.json"))
    c = Core(X["exe"], "s5h", data=c.data, fresh=False).start()
    r = c.check()
    check("5.planted_root_on_disk.not_trusted", r[0] == 200 and chain(c).get("rootVersion") in (None, 0, 1), (r[0], chain(c)))
    c.stop()


def sec6_transport():
    """6. Транспорт: молчащее зеркало, лимит размера, редиректы, докачка, одна загрузка за раз."""
    info = release()
    fname = "LAVRay-0.9.1-x64-setup.exe"
    c = Core(X["exe"], "s6").start()
    SITE_SRV.stop(P2)
    r = c.check()
    msg = r[1].get("message", "") if isinstance(r[1], dict) else ""
    check("6.mirror_down.unavailable_names_the_host", r[0] == 503 and reason(r) == ("unavailable", "mirror_unreachable", "mirror_unreachable") and
          f"127.0.0.1:{P2}" in msg and f"127.0.0.1:{P1}" not in msg, (r[0], msg))
    check("6.mirror_down.last_checked_untouched", last_checked(c) == 0, c.state())
    SITE_SRV.start(P2)
    r = c.check()
    check("6.mirror_down.recovers_when_mirror_returns", r[0] == 200 and r[1].get("available"), (r[0], str(r[1])[:100]))
    SITE_SRV.stop(P1)
    SITE_SRV.stop(P2)
    r = c.check()
    msg = r[1].get("message", "") if isinstance(r[1], dict) else ""
    check("6.mirror_down.both_hosts_named", r[0] == 503 and f"127.0.0.1:{P1}" in msg and f"127.0.0.1:{P2}" in msg, msg)
    frames, end = c.download()
    check("6.mirror_down.download_unavailable_with_reason", not frames and end.get("error", {}).get("code") == "unavailable" and
          end.get("metadata", {}).get("Lavray-Update-Reason") == ["mirror_unreachable"], end)
    SITE_SRV.start(P1)
    SITE_SRV.start(P2)
    c.stop()
    # ответ больше лимита (8 МиБ) не обрезается молча
    SITE_SRV.behave["oversize"] = {"timestamp.json": 9 * 1024 * 1024}
    SITE_SRV.log.clear()
    c = Core(X["exe"], "s6b").start()
    r = c.check()
    check("6.oversize_metadata.rejected", r[0] == 503 and r[1].get("code") == "unavailable" and last_checked(c) == 0, (r[0], str(r[1])[:100]))
    check("6.oversize_metadata.both_mirrors_were_asked", {h[0] for h in SITE_SRV.hits("timestamp.json")} >= {P1, P2}, SITE_SRV.hits("timestamp.json"))
    SITE_SRV.behave["oversize"] = {}
    r = c.check()
    check("6.oversize_metadata.control_without_oversize_passes", r[0] == 200, (r[0], str(r[1])[:100]))
    # редирект (допустим только https; на loopback зеркала http, поэтому любой редирект отвергается)
    SITE_SRV.behave["redirect"] = {"timestamp.json": "http://127.0.0.1:{port}/meta/timestamp.json?r=1"}
    SITE_SRV.log.clear()
    c2 = Core(X["exe"], "s6c").start()
    r = c2.check()
    check("6.redirect_metadata.rejected", r[0] == 503 and r[1].get("code") == "unavailable" and last_checked(c2) == 0, (r[0], str(r[1])[:100]))
    check("6.redirect_metadata.target_never_requested", not [h for h in SITE_SRV.log if "r=1" in h[1]], [h for h in SITE_SRV.log if "r=1" in h[1]])
    SITE_SRV.behave["redirect"] = {fname: "http://127.0.0.1:{port}/meta/v0.9.1/" + fname + "?r=1"}
    SITE_SRV.log.clear()
    c3 = Core(X["exe"], "s6d").start()
    frames, end = c3.download()
    check("6.redirect_artifact.not_followed", "verified" not in kinds(frames) and not [h for h in SITE_SRV.log if "r=1" in h[1]] and not [n for n in staged_files(c3) if n.endswith(".exe")],
          (kinds(frames), end, staged_files(c3)))
    SITE_SRV.behave["redirect"] = {}
    c2.stop()
    c3.stop()
    c.stop()
    # обрыв посреди загрузки: докачка с места обрыва (Range) и успешная проверка
    SITE_SRV.behave["cut_first"] = {"suffix": fname, "fraction": 0.4}
    SITE_SRV.log.clear()
    c = Core(X["exe"], "s6e").start()
    frames, end = c.download()
    ranges = [h[2] for h in SITE_SRV.hits(fname) if h[2]]
    check("6.resume.verified_after_cut", kinds(frames)[-1:] == ["verified"] and end == {}, (kinds(frames), end))
    check("6.resume.second_request_has_range", ranges and ranges[0].startswith("bytes=") and int(ranges[0][6:-1]) > 0, ranges)
    check("6.resume.result_equals_published", frames and read(frames[-1]["verified"]["stagedPath"]) == INSTALLER, "")
    c.stop()
    SITE_SRV.behave["cut_first"] = None
    # короткое тело: файл меньше заявленного в манифесте
    SITE_SRV.behave["transform"] = {fname: lambda b: b[:-100]}
    c = Core(X["exe"], "s6f").start()
    frames, end = c.download()
    check("6.short_body.truncated", kinds(frames)[-1:] == ["verifyFailed"] and frames[-1]["verifyFailed"]["reason"] == "truncated", (kinds(frames), frames[-1:]))
    check("6.short_body.no_finished_installer", not [n for n in staged_files(c) if n.endswith(".exe") or n.endswith(".minisig")], staged_files(c))
    check("6.short_body.part_kept_for_resume", [n for n in staged_files(c) if n.endswith(".part")], staged_files(c), warn=True)
    c.stop()
    SITE_SRV.behave["transform"] = {}
    # одна загрузка за раз
    SITE_SRV.behave["slow"] = {"suffix": fname, "chunk": 30000, "delay": 0.4}
    c = Core(X["exe"], "s6g").start()
    first = {}
    t = threading.Thread(target=lambda: first.update(r=c.download()))
    t.start()
    time.sleep(1.2)
    frames, end = c.download()
    t.join()
    check("6.concurrent_download.second_is_aborted", not frames and end.get("error", {}).get("code") == "aborted", end)
    check("6.concurrent_download.first_completes", kinds(first["r"][0])[-1:] == ["verified"], kinds(first["r"][0]))
    SITE_SRV.behave["slow"] = None
    c.stop()


def sec7_artifact_negatives():
    """7. Подмена и неверная подпись установщика: отказ с причиной, в staging ничего не остаётся."""
    fname = "LAVRay-0.9.1-x64-setup.exe"
    release()
    SITE_SRV.behave["transform"] = {fname: lambda b: b[:1000] + bytes([b[1000] ^ 1]) + b[1001:]}
    c = Core(X["exe"], "s7").start()
    r = c.check()
    check("7.tampered_byte.check_still_passes", r[0] == 200, "метаданные верны, подмена только в файле")
    frames, end = c.download()
    check("7.tampered_byte.sha256_mismatch", kinds(frames)[-1:] == ["verifyFailed"] and frames[-1]["verifyFailed"]["reason"] == "sha256_mismatch", (kinds(frames), frames[-1:]))
    check("7.tampered_byte.staging_is_empty", staged_files(c) == [], staged_files(c))
    comp = c.state()["components"][0]
    check("7.tampered_byte.phase_failed", comp.get("phase") == "PHASE_FAILED", comp)
    c.stop()
    SITE_SRV.behave["transform"] = {}
    release(akey="wa")  # манифест подписан верно, а minisign установщика - чужим ключом
    c = Core(X["exe"], "s7b").start()
    r = c.check()
    check("7.wrong_artifact_key.check_passes", r[0] == 200, "подпись установщика проверяется при загрузке")
    frames, end = c.download()
    check("7.wrong_artifact_key.bad_signature", kinds(frames)[-1:] == ["verifyFailed"] and frames[-1]["verifyFailed"]["reason"] == "bad_signature", (kinds(frames), frames[-1:]))
    check("7.wrong_artifact_key.staging_is_empty", staged_files(c) == [], staged_files(c))
    c.stop()


def sec8_local_verify():
    """8. VerifyLocalUpdate («Установить из файла»): только staging, подпись roли artifact, продукт, платформа, версия."""
    release()
    c = Core(X["exe"], "s8").start()
    os.makedirs(c.staging(), exist_ok=True)
    work = os.path.join(OUT, "s8work")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    inst = os.path.join(work, "LAVRay-0.9.1-x64-setup.exe")
    write(inst, INSTALLER)
    sig = sign_artifact(inst, "a1", "0.9.1")
    X["local_sig"], X["local_inst"] = sig, inst

    def stage(name, data, sigfile=None):
        p = os.path.join(c.staging(), sha_hex(data) + "-" + name)
        write(p, data)
        if sigfile:
            shutil.copyfile(sigfile, p + ".minisig")
        return p

    def verify(p, **extra):
        return c.rpc("UpdateService", "VerifyLocalUpdate", dict({"installerPath": p}, **extra))

    r = verify(stage("good.exe", INSTALLER, sig))
    check("8.good_signature_next_to_installer", r[0] == 200 and r[1].get("valid") is True and r[1]["manifest"]["version"] == "0.9.1" and r[1]["manifest"]["product"] == PRODUCT, r[1])
    p = stage("nosig.exe", INSTALLER)
    r = verify(p)
    check("8.no_signature_file_uses_online_manifest", r[0] == 200 and r[1].get("valid") is True and os.path.isfile(p + ".minisig"), r[1])
    cases = [
        ("wrong_artifact_key", INSTALLER, sign_artifact(inst, "wa", "0.9.1", out=os.path.join(work, "wa.minisig")), "keyid"),
        ("tampered_installer", INSTALLER[:50] + bytes([INSTALLER[50] ^ 1]) + INSTALLER[51:], sig, "подпись"),
        ("same_version_as_installed", INSTALLER, sign_artifact(inst, "a1", "0.9.0", out=os.path.join(work, "same.minisig")), "не новее"),
        ("older_version", INSTALLER, sign_artifact(inst, "a1", "0.8.0", out=os.path.join(work, "older.minisig")), "не новее"),
        ("other_platform", INSTALLER, sign_artifact(inst, "a1", "0.9.1", platform_key="linux-x64", out=os.path.join(work, "plat.minisig")), "платформ"),
        ("other_product", INSTALLER, sign_artifact(inst, "a1", "0.9.1", product="lavray-linux", out=os.path.join(work, "prod.minisig")), "product"),
    ]
    for name, data, sg, word in cases:
        r = verify(stage(name + ".exe", data, sg))
        errs = " ".join(r[1].get("errors", [])) if r[0] == 200 else ""
        check(f"8.{name}.invalid", r[0] == 200 and not r[1].get("valid") and word in errs, (r[0], errs[:120]))
    big = os.path.join(work, "big.minisig")
    write(big, read(sig) + NL.encode() + b"A" * 5000)
    r = verify(stage("big.exe", INSTALLER, big))
    check("8.oversized_signature_file.invalid", r[0] == 200 and not r[1].get("valid") and "4096" in " ".join(r[1].get("errors", [])), r[1])
    r = verify(inst)
    check("8.path_outside_staging.invalid_argument", r[0] == 400 and r[1]["code"] == "invalid_argument", r[1])
    r = verify(os.path.join(c.staging(), "..", "..", "x.exe"))
    check("8.path_traversal.invalid_argument", r[0] == 400 and r[1]["code"] == "invalid_argument", r[1])
    r = verify("")
    check("8.empty_path.invalid_argument", r[0] == 400 and r[1]["code"] == "invalid_argument", r[1])
    r = verify(stage("viasig.exe", INSTALLER), minisigPath=os.path.join(work, "wa.minisig"))
    check("8.signature_outside_staging.invalid_argument", r[0] == 400 and r[1]["code"] == "invalid_argument", r[1])
    c.stop()


def cli(exe, *args):
    rc, out, err = run([exe, "verify-artifact", *args])
    return rc, out.strip(), err.strip()


def sec9_cli():
    """9. lavray-core verify-artifact: коды выхода 0, 1, 2 (так оболочка проверяет установщик перед UAC)."""
    inst, sig = X["local_inst"], X["local_sig"]
    work = os.path.dirname(inst)
    d = os.path.join(OUT, "s9data")
    shutil.rmtree(d, ignore_errors=True)
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", sig, "--data", d)
    j = json.loads(out) if rc == 0 and out else {}
    check("9.good.exit_0_with_version_and_sha256", rc == 0 and j.get("version") == "0.9.1" and j.get("sha256") == sha_hex(INSTALLER), (rc, out, err))
    bad = os.path.join(work, "tampered.exe")
    write(bad, INSTALLER[:5] + bytes([INSTALLER[5] ^ 1]) + INSTALLER[6:])
    rc, out, err = cli(X["exe"], "--file", bad, "--sig", sig, "--data", d)
    check("9.tampered.exit_1", rc == 1 and not out and "неверная подпись" in err, (rc, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "wa.minisig"), "--data", d)
    check("9.wrong_key.exit_1", rc == 1 and "keyid" in err, (rc, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "same.minisig"), "--data", d)
    check("9.not_newer.exit_1", rc == 1 and "не новее" in err, (rc, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "older.minisig"), "--data", d)
    check("9.older_without_allow_older.exit_1", rc == 1, (rc, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "older.minisig"), "--data", d, "--allow-older")
    check("9.older_with_allow_older.exit_0", rc == 0 and json.loads(out).get("version") == "0.8.0", (rc, out, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "plat.minisig"), "--data", d)
    check("9.other_platform.exit_1", rc == 1 and "платформ" in err, (rc, err))
    rc, out, err = cli(X["exe"])
    check("9.no_arguments.exit_2", rc == 2, (rc, err))
    rc, out, err = cli(X["exe"], "--file", os.path.join(work, "no-such.exe"), "--sig", sig, "--data", d)
    check("9.missing_file.exit_1", rc == 1, (rc, err))
    rc, out, err = cli(X["exe_ph"], "--file", inst, "--sig", sig, "--data", d)
    check("9.placeholder_root.exit_1_not_configured", rc == 1 and "not configured" in err, (rc, err))
    # корень, принятый ротацией, действует и для проверки установщика: подпись ключом a1 корня 2 проверяется по цепочке
    rd = os.path.join(d, "updates", "roots")
    os.makedirs(rd, exist_ok=True)
    shutil.copyfile(R("root2.json"), os.path.join(rd, "2.root.json"))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", sig, "--data", d)
    check("9.accepted_rotation_chain_is_used", rc == 0, (rc, err))
    # подложенный в каталог данных «корень 2» с ключом установщика злоумышленника: подпись его ключом не проходит
    shutil.copyfile(R("root2-forged-artifact.json"), os.path.join(rd, "2.root.json"))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", os.path.join(work, "wa.minisig"), "--data", d)
    check("9.planted_forged_root.attacker_signature_rejected", rc == 1 and "keyid" in err, (rc, out, err))
    rc, out, err = cli(X["exe"], "--file", inst, "--sig", sig, "--data", d)
    check("9.planted_forged_root.genuine_signature_still_checked_by_embedded_root", rc == 0, (rc, err))


def sec10_agent():
    """10. Агентский токен: GetUpdateState читает, всё остальное закрыто в обоих режимах."""
    release()
    c = Core(X["exe"], "s10").start()
    for mode in ("read", "control"):
        c.rpc("SettingsService", "SetSettings", {"values": {"agent.mode": {"stringValue": mode}}})
        r = c.rpc("UpdateService", "GetUpdateState", {}, token=c.agent)
        check(f"10.agent.{mode}.GetUpdateState.allowed", r[0] == 200, (r[0], str(r[1])[:80]))
        for m_, body in (("CheckUpdates", {}), ("Rollback", {"component": "UPDATE_COMPONENT_APP"}), ("VerifyLocalUpdate", {"installerPath": "x"})):
            r = c.rpc("UpdateService", m_, body, token=c.agent)
            check(f"10.agent.{mode}.{m_}.denied", r[0] == 403 and r[1].get("code") == "permission_denied", (r[0], str(r[1])[:80]))
        for m_ in ("DownloadUpdates", "ApplyUpdates"):
            frames, end = c.stream("UpdateService", m_, {}, token=c.agent)
            check(f"10.agent.{mode}.{m_}.denied", not frames and (end.get("error", {}).get("code") == "permission_denied" or end.get("http") == 403), end)
    check("10.agent.checks_did_not_touch_the_network", last_checked(c) == 0, c.state())
    c.stop()


def sec11_channels():
    """11. Каналы: stable и beta ведут отдельные serial; загрузка идёт по настройке update.channel."""
    release(ver="0.9.2-beta.1", serial=50, tsv=3000, channel="beta")
    c = Core(X["exe"], "s11").start()
    r = c.check("UPDATE_CHANNEL_STABLE")
    check("11.stable_check_without_stable_manifest_finds_nothing", r[0] == 200 and not r[1].get("available"), (r[0], str(r[1])[:100]))
    r = c.check("UPDATE_CHANNEL_BETA")
    av = r[1].get("available", [{}])[0] if r[0] == 200 else {}
    check("11.beta_check_finds_beta", av.get("availableVersion") == "0.9.2-beta.1" and av.get("manifest", {}).get("channel") == "UPDATE_CHANNEL_BETA", (r[0], str(r[1])[:150]))
    check("11.beta_serial_is_separate", chain(c).get("maxSerial", {}).get("beta") == "50" and chain(c).get("maxSerial", {}).get("stable") == "0", chain(c))
    r = c.rpc("SettingsService", "SetSettings", {"values": {"update.channel": {"stringValue": "beta"}}})
    check("11.channel_setting_accepted", r[0] == 200 and r[1].get("acceptedKeys") == ["update.channel"], r[1])
    frames, end = c.download()
    check("11.download_follows_channel_setting", kinds(frames)[-1:] == ["verified"] and frames[-1]["verified"]["version"] == "0.9.2-beta.1", (kinds(frames), end))
    c.stop()


# ================================================================== §7.5: наборы маршрутов и гео через апдейтер ====
# Разделы 12.*: updsign (geo-pack, manifest с секциями presets и geo, verify), CheckUpdates / DownloadUpdates /
# ApplyUpdates / Rollback для PRESETS и GEO по Connect JSON на ядре с настоящим sing-box и тестовым корнем.

D = {}  # exe - ядро с тегами сборки и тестовым корнем; raw - updsign с отключёнными самопроверками (для враждебных архивов)
DW = os.path.join(OUT, "data75")
PFX = "v0.9.1/"
COMP_P, COMP_G = "UPDATE_COMPONENT_PRESETS", "UPDATE_COMPONENT_GEO"
GEO_DATE = "2026-11-01"
PUBN = [2000]  # версия timestamp: растёт с каждой публикацией
MARKER_DOMAIN = "a13-marker.example"


def srs(tag):
    """Корректный по форме .srs (магия SRS, версия, zlib-поток): клиент проверяет только это."""
    return b"SRS\x01" + zlib.compress(("a13-" + tag).encode())


def geo_files():
    """Встроенный набор целиком: {geoip/ru.srs: байты, ...}. Клиент требует ВСЕ файлы встроенного набора."""
    base = os.path.join(CORE_SRC, "internal", "presets", "geo")
    out = {}
    for kind in ("geoip", "geosite"):
        for n in sorted(os.listdir(os.path.join(base, kind))):
            out[f"{kind}/{n}"] = read(os.path.join(base, kind, n))
    return out


def put_tree(name, files):
    d = os.path.join(DW, name)
    shutil.rmtree(d, ignore_errors=True)
    for rel, data in files.items():
        write(os.path.join(d, *rel.split("/")), data)
    return d


def mkzip(path, entries, method=zipfile.ZIP_STORED):
    """entries: (имя, байты) или (имя, байты, external_attr). Имена пишутся как есть (в том числе враждебные)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with zipfile.ZipFile(path, "w", method) as z:
        for item in entries:
            zi = zipfile.ZipInfo("x", date_time=(1980, 1, 1, 0, 0, 0))
            zi.filename = item[0]
            zi.create_system = 3  # Unix: Go читает тип записи (ссылка) из старших битов external_attr только для такого архива
            zi.compress_type = method
            if len(item) > 2:
                zi.external_attr = item[2]
            z.writestr(zi, item[1])
    return path


def make_presets(name, bump=1, ids=("lav-ru", "lav-cn")):
    """Файлы встроенных наборов с ревизией выше встроенной и добавленным direct-доменом (по нему видно, что набор новый)."""
    d = os.path.join(DW, name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    for pid in ids:
        doc = json.loads(read(os.path.join(CORE_SRC, "internal", "presets", "builtin", pid + ".json")))
        doc["revision"] += bump
        doc["routing"]["direct_domain"] = list(doc["routing"].get("direct_domain", [])) + [MARKER_DOMAIN]
        write(os.path.join(d, pid + ".json"), json.dumps(doc, ensure_ascii=False))
    return d


def publish_data(presets=None, zip_path=None, serial=500, geo_rev=7000, tool=None, m_ttl="720h", ts_ttl="168h"):
    """Пересобирает site/meta: корень, sources.json, манифест данных (без секции app), timestamp и файлы данных."""
    shutil.rmtree(META, ignore_errors=True)
    os.makedirs(META, exist_ok=True)
    shutil.copyfile(os.path.join(KEYS, "root1.json"), os.path.join(META, "root.json"))
    sdraft = os.path.join(KEYS, "sources.draft.json")
    write(sdraft, json.dumps({"type": "sources", "version": 1, "artifacts": ["https://127.0.0.1:1/dl"], "metadata": ["https://127.0.0.1:1/meta"]}))
    ups("sources", "-key", f"file:{kf('r1')}", "-keyid", "r1", "-in", sdraft, "-out", os.path.join(META, "sources.json"))
    out = os.path.join(META, "manifest-stable.json")
    args = ["manifest", "-key", f"file:{kf('r1')}", "-keyid", "r1", "-product", PRODUCT, "-channel", "stable", "-serial", str(serial),
            f"-expires={m_ttl}", "-data-prefix", PFX, "-data-out", os.path.join(META, PFX.strip("/")), "-out", out]
    if presets:
        args += ["-presets-dir", presets]
    if zip_path:
        args += ["-geo-zip", zip_path, "-geo-rev", str(geo_rev), "-geo-generated-at", GEO_DATE]
    ups(*args, tool=tool)
    PUBN[0] += 1
    ups("timestamp", "-key", f"file:{kf('t1')}", "-keyid", "t1", "-dir", META, "-out", os.path.join(META, "timestamp.json"),
        "-version", str(PUBN[0]), f"-expires={ts_ttl}", tool=tool)
    return {"manifest": out, "zip_sha": sha_hex(read(zip_path)) if zip_path else ""}


def build_raw_updsign():
    """updsign из КОПИИ дерева с тремя отключёнными самопроверками, чтобы подписать манифест над враждебным архивом
    (так выглядит выпуск с украденным ключом manifest: подпись верна, а содержимое нет). Продукт не меняется."""
    src = os.path.join(OUT, "core-raw-src")
    shutil.rmtree(src, ignore_errors=True)
    shutil.copytree(CORE_SRC, src, ignore=shutil.ignore_patterns(".git", "*.exe"))
    patches = [
        ("cmd/updsign/geopack.go", "func checkGeoZip(raw []byte) error {", "func checkGeoZip(raw []byte) error {\n\treturn nil"),
        ("cmd/updsign/manifest.go", "updates.ParseManifest(e.Signed)", "e.Signed, error(nil)"),
        ("cmd/updsign/meta.go", "updates.ParseManifest(env.Signed)", "lenientManifest(env.Signed)"),
        ("cmd/updsign/manifest_data.go", "if rev < 1 || rev > updates.MaxGeoRev {", "if rev != -1 && (rev < 1 || rev > updates.MaxGeoRev) {"),
        ("cmd/updsign/manifest_data.go", 'sec := map[string]any{"path": rel, "sha256": sha256Hex(raw), "length": len(raw), "generatedAt": date, "rev": rev}',
         'sec := map[string]any{"path": rel, "sha256": sha256Hex(raw), "length": len(raw), "generatedAt": date, "rev": rev}\n\tif rev == -1 {\n\t\tdelete(sec, "rev")\n\t}'),
    ]
    for rel, old, new in patches:
        p = os.path.join(src, *rel.split("/"))
        text = read(p).decode("utf-8")
        if text.count(old) != 1:
            return None, f"{rel}: фрагмент не найден (исходники updsign изменились)"
        write(p, text.replace(old, new))
    extra_go = NL.join(["package main", "", 'import "encoding/json"', "", "type rawMF struct {", '\tSerial int64 `json:"serial"`', "}", "",
                        "func lenientManifest(b []byte) (*rawMF, error) {", "\tvar m rawMF", "\treturn &m, json.Unmarshal(b, &m)", "}", ""])
    write(os.path.join(src, "cmd", "updsign", "raw_extra.go"), extra_go)
    exe = os.path.join(OUT, "updsign-raw.exe")
    rc, out, err = run(["go", "build", "-o", exe, "./cmd/updsign"], cwd=src, env=dict(os.environ, CGO_ENABLED="0"))
    if rc != 0:
        return None, "не собралась: " + err.strip()[:200]
    return exe, ""


def evs(frames):
    return [(k, v) for f in frames for k, v in f.items() if k != "tsMs"]


def vfail(frames):
    return [v["reason"] for k, v in evs(frames) if k == "verifyFailed"]


def endreason(end):
    return end.get("metadata", {}).get("Lavray-Update-Reason", [None])[0] if isinstance(end, dict) else None


def comp_state(c, which):
    return next((s for s in c.state().get("components", []) if s.get("component") == which), {})


def preset(c, pid):
    st, p, _ = c.rpc("RoutingService", "GetPreset", {"id": pid})
    return p if st == 200 else {}


def offered(r):
    return {a.get("component"): a for a in (r[1].get("available", []) if r[0] == 200 else [])}


def comp_staging(c):
    d = os.path.join(c.staging(), "components")
    return sorted(os.listdir(d)) if os.path.isdir(d) else []


def geo_dir(c):
    return os.path.join(c.data, "geo")


def read_riot(c):
    return read(os.path.join(geo_dir(c), "geosite", "riot.srs"))


def geo_source(c):
    p = os.path.join(geo_dir(c), "source.json")
    return json.loads(read(p)) if os.path.isfile(p) else {}


def data_core(name, **kw):
    return Core(D["exe"], name, **kw).start()


def apply_all(c, comps=(COMP_P, COMP_G)):
    return c.stream("UpdateService", "ApplyUpdates", {"components": list(comps)})


def download(c, comps):
    return c.stream("UpdateService", "DownloadUpdates", {"components": list(comps)})


def sec12_tools():
    """12.1-12.2 Публикация: geo-pack, manifest с секциями presets и geo, verify. Всё на тестовых ключах."""
    files = geo_files()
    check("12.pack.embedded_set_has_all_files", len(files) >= 19 and "geosite/riot.srs" in files, sorted(files)[:3])
    marked = dict(files, **{"geosite/riot.srs": srs("marker-1")})
    src = put_tree("geo-src", marked)
    zpath = os.path.join(DW, "geo.zip")
    out = ups("geo-pack", "-in", src, "-out", zpath)
    check("12.pack.writes_zip", os.path.isfile(zpath) and "записан" in out, out)
    with zipfile.ZipFile(zpath) as z:
        infos = z.infolist()
        names = [i.filename for i in infos]
        check("12.pack.entries_are_the_whole_set_in_order", names == sorted(files), names[:3])
        check("12.pack.store_only_fixed_mtime", all(i.compress_type == zipfile.ZIP_STORED and i.date_time == (1980, 1, 1, 0, 0, 0) for i in infos), "")
        check("12.pack.marker_inside", z.read("geosite/riot.srs") == marked["geosite/riot.srs"], "")
    ups("geo-pack", "-in", src, "-out", os.path.join(DW, "geo2.zip"))
    check("12.pack.deterministic", read(zpath) == read(os.path.join(DW, "geo2.zip")), "два вызова дали разные байты")
    # отказы geo-pack: файл не создаётся
    cases = {
        "incomplete_set": put_tree("geo-bad1", {k: v for k, v in marked.items() if k != "geosite/youtube.srs"}),
        "not_an_srs": put_tree("geo-bad2", dict(marked, **{"geosite/riot.srs": b"not an srs"})),
        "foreign_file": put_tree("geo-bad3", dict(marked, **{"geosite/readme.txt": b"x"})),
        "foreign_dir": put_tree("geo-bad4", dict(marked, **{"other/x.srs": srs("x")})),
    }
    for name, d in cases.items():
        o = os.path.join(DW, f"bad-{name}.zip")
        rc, so, se = run([UPDSIGN, "geo-pack", "-in", d, "-out", o])
        check(f"12.pack.refuses.{name}", rc != 0 and not os.path.exists(o), (rc, se.strip()[:120]))
    link_dir = put_tree("geo-bad5", marked)
    try:
        os.remove(os.path.join(link_dir, "geosite", "google.srs"))
        os.symlink(os.path.join(link_dir, "geosite", "riot.srs"), os.path.join(link_dir, "geosite", "google.srs"))
        o = os.path.join(DW, "bad-symlink.zip")
        rc, so, se = run([UPDSIGN, "geo-pack", "-in", link_dir, "-out", o])
        check("12.pack.refuses.symlink", rc != 0 and not os.path.exists(o), (rc, se.strip()[:120]))
    except OSError as e:
        check("12.pack.refuses.symlink", False, "нет права создавать символические ссылки (" + str(e)[:60] + "): проверка пропущена", warn=True)
    # манифест данных
    pdir = make_presets("presets-new")
    pub = publish_data(presets=pdir, zip_path=zpath)
    mf = json.loads(read(pub["manifest"]))
    check("12.manifest.is_signed_envelope", "signed" in mf and mf.get("signatures"), list(mf)[:4])
    signed = json.loads(mf["signed"]) if isinstance(mf.get("signed"), str) else mf.get("signed", {})
    check("12.manifest.has_presets_geo_no_app", set(signed.get("presets", {})) == {"lav-ru", "lav-cn"} and "geo" in signed and "app" not in signed,
          sorted(signed))
    g = signed.get("geo", {})
    check("12.manifest.geo_fields", g.get("rev") == 7000 and g.get("generatedAt") == GEO_DATE and g.get("sha256") == pub["zip_sha"] and
          g.get("path") == PFX + f"geo-{GEO_DATE}.zip" and g.get("length") == os.path.getsize(zpath), g)
    check("12.manifest.preset_rev_is_above_builtin", signed.get("presets", {}).get("lav-ru", {}).get("rev") == 3, signed.get("presets"))
    check("12.manifest.data_files_published", sorted(os.listdir(os.path.join(META, PFX.strip("/")))) ==
          sorted([f"geo-{GEO_DATE}.zip", "presets-lav-cn-3.json", "presets-lav-ru-3.json"]), os.listdir(os.path.join(META, PFX.strip("/"))))
    vo = ups("verify", "-root", os.path.join(KEYS, "root1.json"), "-dir", META, "-channel", "stable", "-assets", os.path.join(META, PFX.strip("/")), "-product", PRODUCT)
    check("12.verify.accepts_the_release", "набор lav-ru (rev 3)" in vo and "гео-набор: sha256, длина и распаковка сошлись" in vo, vo[-200:])
    bad_assets = os.path.join(DW, "assets-bad")
    shutil.rmtree(bad_assets, ignore_errors=True)
    shutil.copytree(os.path.join(META, PFX.strip("/")), bad_assets)
    gz = os.path.join(bad_assets, f"geo-{GEO_DATE}.zip")
    b = bytearray(read(gz))
    b[200] ^= 1
    write(gz, bytes(b))
    rc, so, se = run([UPDSIGN, "verify", "-root", os.path.join(KEYS, "root1.json"), "-dir", META, "-channel", "stable", "-assets", bad_assets, "-product", PRODUCT])
    check("12.verify.rejects_tampered_geo_zip", rc != 0 and "sha256" in (se + so).lower(), (rc, (se + so)[-160:]))
    # манифест: отказы updsign до подписи
    for name, kw in (("preset_builtin_false", {"builtin": False}), ("preset_id_mismatch", {"id": "lav-cn"})):
        d = os.path.join(DW, "presets-" + name)
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
        doc = json.loads(read(os.path.join(pdir, "lav-ru.json")))
        doc.update(kw)
        write(os.path.join(d, "lav-ru.json"), json.dumps(doc, ensure_ascii=False))
        rc, so, se = run([UPDSIGN, "manifest", "-key", f"file:{kf('r1')}", "-keyid", "r1", "-product", PRODUCT, "-channel", "stable", "-serial", "1",
                          "-presets-dir", d, "-out", os.path.join(DW, "never.json")])
        check(f"12.manifest.refuses.{name}", rc != 0 and not os.path.exists(os.path.join(DW, "never.json")), (rc, se.strip()[:120]))
    d = os.path.join(DW, "presets-stranger")
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    write(os.path.join(d, "my-own.json"), read(os.path.join(pdir, "lav-ru.json")))
    rc, so, se = run([UPDSIGN, "manifest", "-key", f"file:{kf('r1')}", "-keyid", "r1", "-product", PRODUCT, "-channel", "stable", "-serial", "1",
                      "-presets-dir", d, "-out", os.path.join(DW, "never.json")])
    check("12.manifest.refuses.preset_not_builtin_id", rc != 0, (rc, se.strip()[:120]))


def sec12_success_path():
    """12.3 Путь «проверка → загрузка → применение → откат» для PRESETS и GEO без активного соединения."""
    files = geo_files()
    marker = srs("marker-1")
    src = put_tree("geo-src", dict(files, **{"geosite/riot.srs": marker}))
    zpath = os.path.join(DW, "geo.zip")
    ups("geo-pack", "-in", src, "-out", zpath)
    pdir = make_presets("presets-new")
    pub = publish_data(presets=pdir, zip_path=zpath)
    c = data_core("s12")
    st0 = c.state()
    p_state, g_state = comp_state(c, COMP_P), comp_state(c, COMP_G)
    check("12.state.before", p_state.get("phase") == "PHASE_IDLE" and g_state.get("phase") == "PHASE_IDLE" and not p_state.get("rollbackAvailable") and
          not g_state.get("rollbackAvailable"), st0)
    base_ru = preset(c, "lav-ru")
    check("12.preset.builtin_revision_before", base_ru.get("revision") == 2 and MARKER_DOMAIN not in base_ru.get("directDomain", []), base_ru.get("revision"))
    st, copy, _ = c.rpc("RoutingService", "CreatePreset", {"builtinSourceId": "lav-ru"})
    cid = copy.get("id", "")
    check("12.preset.copy_records_source_revision", st == 200 and copy.get("builtinSourceId") == "lav-ru" and copy.get("builtinSourceRevision") == 2 and
          not copy.get("sourceUpdated"), copy)
    riot_before = read_riot(c)
    check("12.geo.riot_is_builtin_before", riot_before == files["geosite/riot.srs"], "")
    frames, end = apply_all(c, (COMP_P,))
    check("12.apply.without_download.not_staged", not frames and end.get("error", {}).get("code") == "failed_precondition" and endreason(end) == "not_staged", end)
    frames, end = download(c, [])
    check("12.download.empty_list_means_app_only", not frames and end.get("error", {}).get("code") == "failed_precondition" and endreason(end) == "no_update", end)
    frames, end = download(c, ["UPDATE_COMPONENT_CORE"])
    check("12.download.core_component_refused", not frames and bool(end.get("error")), end)
    r = c.check()
    av = offered(r)
    check("12.check.offers_presets_and_geo_not_app", r[0] == 200 and set(av) == {COMP_P, COMP_G}, (r[0], sorted(av)))
    check("12.check.presets_versions", av.get(COMP_P, {}).get("currentVersion") == "lav-cn:2, lav-ru:2" and av.get(COMP_P, {}).get("availableVersion") == "lav-cn:3, lav-ru:3", av.get(COMP_P))
    check("12.check.geo_version_is_the_date", av.get(COMP_G, {}).get("availableVersion") == GEO_DATE and not av.get(COMP_G, {}).get("currentVersion"), av.get(COMP_G))
    r = c.rpc("UpdateService", "CheckUpdates", {"channel": "UPDATE_CHANNEL_STABLE", "components": [COMP_G]})
    check("12.check.component_filter", r[0] == 200 and set(offered(r)) == {COMP_G}, sorted(offered(r)))
    frames, end = download(c, [COMP_P, COMP_G])
    k = evs(frames)
    ver = [v for kk, v in k if kk == "verified"]
    check("12.download.three_verified_events", end == {} and len(ver) == 3 and {v["component"] for v in ver} == {COMP_P, COMP_G}, ([kk for kk, _ in k], end))
    check("12.download.geo_progress_has_total", any(kk == "progress" and v.get("component") == COMP_G and v.get("totalBytes") == str(os.path.getsize(zpath)) for kk, v in k), "")
    names = comp_staging(c)
    check("12.download.staged_names", len(names) == 3 and any(n.endswith("-geo.zip") for n in names) and any(n.endswith("-lav-ru.json") for n in names) and
          any(n.endswith("-lav-cn.json") for n in names) and not any(n.endswith(".part") for n in names) and
          any(n.startswith(pub["zip_sha"] + "-") for n in names), names)
    ps, gs = comp_state(c, COMP_P), comp_state(c, COMP_G)
    check("12.state.downloaded", ps.get("phase") == "PHASE_DOWNLOADED" and ps.get("stagedVersion") == "lav-cn:3, lav-ru:3" and gs.get("phase") == "PHASE_DOWNLOADED" and
          gs.get("stagedVersion") == GEO_DATE, (ps, gs))
    frames, end = apply_all(c)
    check("12.apply.applied_presets_and_geo", [kv for kv in evs(frames)] == [("applied", "presets"), ("applied", "geo")] and end == {}, (evs(frames), end))
    ps, gs = comp_state(c, COMP_P), comp_state(c, COMP_G)
    check("12.state.applied_rollback_available", ps.get("phase") == "PHASE_IDLE" and ps.get("rollbackAvailable") is True and gs.get("phase") == "PHASE_IDLE" and
          gs.get("rollbackAvailable") is True and not ps.get("previousVersion"), (ps, gs))
    check("12.apply.staging_cleaned", comp_staging(c) == [], comp_staging(c))
    ru, cn, gl = preset(c, "lav-ru"), preset(c, "lav-cn"), preset(c, "global")
    check("12.preset.new_revision_visible", ru.get("revision") == 3 and cn.get("revision") == 3 and MARKER_DOMAIN in ru.get("directDomain", []) and
          gl.get("revision") == 1 and ru.get("builtin") is True, (ru.get("revision"), cn.get("revision"), gl.get("revision")))
    cp = preset(c, cid)
    check("12.preset.custom_copy_reports_source_updated", cp.get("sourceUpdated") is True and cp.get("builtinSourceRevision") == 2 and cp.get("revision") == 1, cp)
    check("12.preset.custom_copy_keeps_own_rules", MARKER_DOMAIN not in cp.get("directDomain", []), cp.get("directDomain", [])[-2:])
    st, reset, _ = c.rpc("RoutingService", "ResetBuiltinPreset", {"id": cid})
    check("12.preset.reset_takes_new_rules", st == 200 and reset.get("builtinSourceRevision") == 3 and not reset.get("sourceUpdated") and
          MARKER_DOMAIN in reset.get("directDomain", []), (st, str(reset)[:160]))
    src_json = geo_source(c)
    check("12.geo.files_replaced", read_riot(c) == marker and src_json.get("sha256") == pub["zip_sha"] and src_json.get("rev") == 7000 and
          src_json.get("generated_at") == GEO_DATE, src_json)
    rev_txt = read(os.path.join(geo_dir(c), "revision.txt")).decode().split()
    check("12.geo.revision_marker_above_builtin", rev_txt and int(rev_txt[0]) > 1, rev_txt)
    check("12.presets.override_file_written", os.path.isfile(os.path.join(c.data, "presets", "override", "lav-ru.json")), "")
    r = c.check()
    check("12.check.nothing_left_after_apply", r[0] == 200 and not offered(r), (r[0], sorted(offered(r))))
    frames, end = apply_all(c)
    check("12.apply.twice_is_not_staged", not frames and endreason(end) == "not_staged", end)
    c.stop()
    # данные переживают перезапуск ядра
    c = data_core("s12", data=c.data)
    check("12.persist.preset_revision", preset(c, "lav-ru").get("revision") == 3 and MARKER_DOMAIN in preset(c, "lav-ru").get("directDomain", []), preset(c, "lav-ru").get("revision"))
    check("12.persist.geo_not_overwritten_by_startup_check", read_riot(c) == marker and geo_source(c).get("rev") == 7000, geo_source(c))
    check("12.persist.rollback_still_available", comp_state(c, COMP_P).get("rollbackAvailable") is True and comp_state(c, COMP_G).get("rollbackAvailable") is True, c.state())
    # откат
    r = c.rpc("UpdateService", "Rollback", {"component": COMP_P})
    check("12.rollback.presets", r[0] == 200 and r[1].get("success") is True and r[1].get("restoredVersion") == "lav-cn:2, lav-ru:2" and not r[1].get("needsProfileRestart"), r[:2])
    ru = preset(c, "lav-ru")
    check("12.rollback.presets.builtin_revision_back", ru.get("revision") == 2 and MARKER_DOMAIN not in ru.get("directDomain", []), ru.get("revision"))
    r = c.rpc("UpdateService", "Rollback", {"component": COMP_G})
    check("12.rollback.geo", r[0] == 200 and r[1].get("success") is True, r[:2])
    check("12.rollback.geo.files_back", read_riot(c) == files["geosite/riot.srs"], "")
    for comp, label in ((COMP_P, "presets"), (COMP_G, "geo")):
        r = c.rpc("UpdateService", "Rollback", {"component": comp})
        check(f"12.rollback.{label}.second_is_no_previous", r[0] == 400 and r[1].get("code") == "failed_precondition" and r[1].get("message", "").startswith("no_previous") and
              r[2].get("Lavray-Update-Reason") == "no_previous", (r[0], r[1]))
    check("12.state.after_rollback", not comp_state(c, COMP_P).get("rollbackAvailable") and not comp_state(c, COMP_G).get("rollbackAvailable"), c.state())
    r = c.check()
    check("12.check.offers_again_after_rollback", r[0] == 200 and set(offered(r)) == {COMP_P, COMP_G}, sorted(offered(r)))
    c.stop()


def sec12_active_session():
    """12.4 Применение при работающем соединении: ready_for_restart(profile); гео на Windows может дать dir_busy."""
    files = geo_files()
    marker = srs("marker-1")
    zpath = os.path.join(DW, "geo.zip")
    ups("geo-pack", "-in", put_tree("geo-src", dict(files, **{"geosite/riot.srs": marker})), "-out", zpath)
    publish_data(presets=make_presets("presets-new"), zip_path=zpath)
    c = data_core("s12b")
    gid = c.rpc("ProfileService", "ListGroups", {})[1]["groups"][0]["id"]
    st, pr, _ = c.rpc("ProfileService", "CreateProfile", {"profile": {"groupId": gid, "type": "PROFILE_TYPE_SOCKS", "name": "a13-dead", "address": "127.0.0.1",
                                                                  "port": 1, "socksHttp": {"proto": "PROTO_SOCKS5"}}})
    c.rpc("SettingsService", "SetSettings", {"values": {"inbound.port": {"intValue": str(free_port())}}})
    c.rpc("RoutingService", "ActivatePreset", {"id": "lav-ru"})
    # режим системного прокси здесь означает только слушатель на loopback: системный прокси ставит оболочка, а её тут нет
    st, cr, _ = c.rpc("CoreService", "Connect", {"profileId": pr.get("id"), "mode": "CONNECT_MODE_SYSTEM_PROXY"})
    check("12.session.connected", st == 200 and cr.get("status", {}).get("state") == "CORE_STATE_CONNECTED" and cr["status"].get("routingPresetId") == "lav-ru", (st, str(cr)[:160]))
    c.check()
    frames, end = download(c, [COMP_P, COMP_G])
    check("12.session.downloaded", end == {} and sum(1 for kk, _ in evs(frames) if kk == "verified") == 3, (evs(frames)[-1:], end))
    frames, end = apply_all(c, (COMP_P,))
    check("12.session.presets_applied_and_restart_requested", evs(frames) == [("applied", "presets"), ("readyForRestart", "profile")] and end == {}, (evs(frames), end))
    frames, end = apply_all(c, (COMP_G,))
    if end.get("error"):
        check("12.session.geo_busy_is_a_clean_refusal", end["error"].get("code") == "failed_precondition" and endreason(end) == "dir_busy" and not frames and
              read_riot(c) == files["geosite/riot.srs"] and not geo_source(c), (end, evs(frames)))
        check("12.session.geo_stays_staged_after_dir_busy", comp_state(c, COMP_G).get("phase") == "PHASE_DOWNLOADED" and len(comp_staging(c)) == 1, (comp_state(c, COMP_G), comp_staging(c)))
        print("НАБЛЮДЕНИЕ 12.session: гео при работающем sing-box не применилось (dir_busy): файлы набора открыты, нужно отключиться и повторить", flush=True)
    else:
        check("12.session.geo_applied_with_restart_request", evs(frames) == [("applied", "geo"), ("readyForRestart", "profile")], (evs(frames), end))
    r = c.rpc("UpdateService", "Rollback", {"component": COMP_P})
    check("12.session.rollback_presets_needs_restart", r[0] == 200 and r[1].get("success") is True and r[1].get("needsProfileRestart") is True, r[:2])
    c.rpc("CoreService", "Disconnect", {})
    if comp_state(c, COMP_G).get("phase") == "PHASE_DOWNLOADED":
        for _ in range(5):
            frames, end = apply_all(c, (COMP_G,))
            if not end.get("error"):
                break
            time.sleep(1.5)
        check("12.session.geo_applies_after_disconnect", evs(frames) == [("applied", "geo")] and read_riot(c) == marker and geo_source(c).get("rev") == 7000, (evs(frames), end))
    c.stop()


def sec12_tamper_and_freshness():
    """12.5 Подмена файлов на зеркале, ревизия «не новее», устаревшая загрузка."""
    files = geo_files()
    marker = srs("marker-1")
    zpath = os.path.join(DW, "geo.zip")
    ups("geo-pack", "-in", put_tree("geo-src", dict(files, **{"geosite/riot.srs": marker})), "-out", zpath)
    pdir = make_presets("presets-new")
    publish_data(presets=pdir, zip_path=zpath)
    gname = f"geo-{GEO_DATE}.zip"

    def flip(d):
        return d[:300] + bytes([d[300] ^ 1]) + d[301:]

    cases = [
        ("tampered_geo_zip", COMP_G, {gname: flip}, "sha256_mismatch"),
        ("tampered_preset_file", COMP_P, {"presets-lav-ru-3.json": lambda d: d[:50] + bytes([d[50] ^ 1]) + d[51:]}, "sha256_mismatch"),
        ("truncated_geo_zip", COMP_G, {gname: lambda d: d[: len(d) // 2]}, "truncated"),
    ]
    for name, comp, tr, want in cases:
        SITE_SRV.behave = {"transform": tr}
        c = data_core("s12t")
        c.check()
        frames, end = download(c, [comp])
        check(f"12.tamper.{name}.{want}", vfail(frames) == [want] and end == {}, (evs(frames), end))
        cs = comp_state(c, comp)
        check(f"12.tamper.{name}.failed_and_nothing_applied", cs.get("phase") == "PHASE_FAILED" and not cs.get("stagedVersion") and not geo_source(c) and
              not os.path.exists(os.path.join(c.data, "presets", "override")), (comp_staging(c), cs))
        check(f"12.tamper.{name}.no_stray_staged_files", comp_staging(c) == [], "в staging остался уже проверенный файл той же пачки: " + str(comp_staging(c)))
        c.stop()
    SITE_SRV.behave = {}
    # ревизия «не новее»: после применения гео с rev 7000 набор с тем же или меньшим rev не предлагается и не качается
    c = data_core("s12n")
    c.check()
    download(c, [COMP_G])
    frames, end = apply_all(c, (COMP_G,))
    check("12.not_newer.first_geo_applied", evs(frames) == [("applied", "geo")], (evs(frames), end))
    other = dict(files, **{"geosite/riot.srs": srs("marker-2")})
    for label, rev in (("same_rev", 7000), ("lower_rev", 6000)):
        z2 = os.path.join(DW, f"geo-{label}.zip")
        ups("geo-pack", "-in", put_tree("geo-src2", other), "-out", z2)
        publish_data(zip_path=z2, geo_rev=rev)
        r = c.check()
        check(f"12.not_newer.{label}.not_offered", r[0] == 200 and COMP_G not in offered(r), (r[0], sorted(offered(r))))
        frames, end = download(c, [COMP_G])
        check(f"12.not_newer.{label}.download_refused", not frames and end.get("error", {}).get("code") == "failed_precondition" and endreason(end) == "no_update" and
              comp_staging(c) == [], (evs(frames), end))
        check(f"12.not_newer.{label}.installed_set_untouched", read_riot(c) == marker and geo_source(c).get("rev") == 7000, geo_source(c))
    z3 = os.path.join(DW, "geo-same-bytes.zip")
    ups("geo-pack", "-in", put_tree("geo-src", dict(files, **{"geosite/riot.srs": marker})), "-out", z3)
    publish_data(zip_path=z3, geo_rev=9000)
    r = c.check()
    check("12.not_newer.same_archive_higher_rev_not_offered", r[0] == 200 and COMP_G not in offered(r), sorted(offered(r)))
    z4 = os.path.join(DW, "geo-newer.zip")
    ups("geo-pack", "-in", put_tree("geo-src2", other), "-out", z4)
    publish_data(zip_path=z4, geo_rev=7001)
    r = c.check()
    check("12.not_newer.higher_rev_is_offered", r[0] == 200 and COMP_G in offered(r), sorted(offered(r)))
    c.stop()
    # устаревшая загрузка: serial манифеста, по которому скачано, вытеснен более новым; манифест успел истечь
    publish_data(zip_path=zpath, serial=500)
    c = data_core("s12f")
    c.check()
    download(c, [COMP_G])
    publish_data(zip_path=zpath, serial=501)
    c.check()
    frames, end = apply_all(c, (COMP_G,))
    check("12.fresh.serial_rollback_after_newer_check", vfail(frames) == ["serial_rollback"] and comp_staging(c) == [] and not geo_source(c), (evs(frames), end))
    publish_data(zip_path=zpath, serial=600, m_ttl="6s")
    c.check()
    download(c, [COMP_G])
    time.sleep(7)
    frames, end = apply_all(c, (COMP_G,))
    check("12.fresh.expired_manifest", vfail(frames) == ["expired"] and comp_staging(c) == [] and not geo_source(c), (evs(frames), end))
    c.stop()


def sec12_race_not_newer():
    """12.6 not_newer при применении: два ядра на одном каталоге данных (второе успело поставить более новый набор)."""
    files = geo_files()
    za, zb = os.path.join(DW, "geo-a.zip"), os.path.join(DW, "geo-b.zip")
    ups("geo-pack", "-in", put_tree("geo-src-a", dict(files, **{"geosite/riot.srs": srs("a")})), "-out", za)
    ups("geo-pack", "-in", put_tree("geo-src-b", dict(files, **{"geosite/riot.srs": srs("b")})), "-out", zb)
    publish_data(zip_path=za, geo_rev=6000, serial=500)
    c1 = data_core("s12r")
    try:
        c1.check()
        download(c1, [COMP_G])
        publish_data(zip_path=zb, geo_rev=7000, serial=500)
        c2 = Core(D["exe"], "s12r", data=c1.data).start()
    except Exception as e:  # noqa: BLE001
        check("12.race.second_core_on_same_data", False, "второе ядро на том же каталоге не запустилось: " + repr(e)[:120], warn=True)
        c1.stop()
        return
    try:
        c2.check()
        download(c2, [COMP_G])
        frames, _ = apply_all(c2, (COMP_G,))
        check("12.race.second_core_applied_newer", evs(frames) == [("applied", "geo")], evs(frames))
        frames, end = apply_all(c1, (COMP_G,))
        check("12.race.not_newer_at_apply", vfail(frames) == ["not_newer"] and read_riot(c2) == srs("b"), (evs(frames), end))
    finally:
        c2.stop()
        c1.stop()


def hostile_cases(files):
    base = [(k, v) for k, v in files.items()]
    link = (stat.S_IFLNK | 0o777) << 16
    bomb = b"SRS\x01" + zlib.compress(b"\0" * (70 << 20), 9)
    many = [(f"geosite/x-{i:04d}.srs", srs("m")) for i in range(520)]
    swap = lambda name, data: [(k, data if k == name else v) for k, v in base]  # noqa: E731
    return [
        ("zip_slip", base + [("geosite/../../evil.srs", srs("evil"))], zipfile.ZIP_STORED, "archive_unsafe"),
        ("absolute_path", base + [("/geosite/evil.srs", srs("evil"))], zipfile.ZIP_STORED, "archive_unsafe"),
        ("backslash_name", base + [("geosite\\evil.srs", srs("evil"))], zipfile.ZIP_STORED, "archive_unsafe"),
        ("drive_letter", base + [("C:/evil.srs", srs("evil"))], zipfile.ZIP_STORED, "archive_unsafe"),
        ("symlink_entry", base + [("geosite/link.srs", b"riot.srs", link)], zipfile.ZIP_STORED, "archive_unsafe"),
        ("directory_entry", base + [("geosite/sub/", b"")], zipfile.ZIP_STORED, "archive_unsafe"),
        ("foreign_file", base + [("geosite/readme.txt", b"x")], zipfile.ZIP_STORED, "archive_unsafe"),
        ("case_duplicate", base + [("geosite/Riot.srs", srs("dup"))], zipfile.ZIP_STORED, "archive_unsafe"),
        ("foreign_compression_bzip2", base, zipfile.ZIP_BZIP2, "archive_unsafe"),
        ("nested_zlib_bomb_in_srs", swap("geosite/riot.srs", bomb), zipfile.ZIP_STORED, "archive_limits"),
        ("too_many_entries", base + many, zipfile.ZIP_STORED, "archive_limits"),
        ("entry_over_8_mib", swap("geosite/riot.srs", b"SRS\x01" + os.urandom(9 << 20)), zipfile.ZIP_STORED, "archive_limits"),
        ("not_an_srs", swap("geosite/riot.srs", b"not an srs file"), zipfile.ZIP_STORED, "geo_invalid"),
        ("incomplete_set", [(k, v) for k, v in base if k != "geosite/youtube.srs"], zipfile.ZIP_STORED, "geo_incomplete"),
    ]


def sec12_hostile_archives():
    """12.7 Манифест подписан верно (тестовым ключом), а архив враждебен: отказ при применении, данные целы."""
    raw, why = build_raw_updsign()
    check("12.hostile.raw_updsign_built", raw is not None, why, warn=True)
    if raw is None:
        return
    D["raw"] = raw
    files = geo_files()
    c = data_core("s12h")
    serial = 700
    for name, entries, method, want in hostile_cases(files):
        z = mkzip(os.path.join(DW, f"hostile-{name}.zip"), entries, method)
        serial += 1
        try:
            publish_data(zip_path=z, tool=raw, serial=serial)
        except RuntimeError as e:
            check(f"12.hostile.{name}.signed", False, str(e)[:160])
            continue
        c.check()
        frames, end = download(c, [COMP_G])
        check(f"12.hostile.{name}.downloads_like_any_signed_file", sum(1 for kk, _ in evs(frames) if kk == "verified") == 1 and end == {}, (evs(frames)[-1:], end))
        frames, end = apply_all(c, (COMP_G,))
        check(f"12.hostile.{name}.{want}", vfail(frames) == [want] and end == {}, (evs(frames), end))
        siblings = sorted(n for n in os.listdir(c.data) if n.startswith("geo") and n != "geo")
        check(f"12.hostile.{name}.data_intact", read_riot(c) == files["geosite/riot.srs"] and not geo_source(c) and comp_staging(c) == [] and not siblings and
              not os.path.exists(os.path.join(c.data, "evil.srs")) and not os.path.exists(os.path.join(os.path.dirname(c.data), "evil.srs")) and
              not os.path.exists(os.path.join(geo_dir(c), "geosite", "evil.srs")) and not os.path.exists(os.path.join(geo_dir(c), "evil.srs")),
              (siblings, comp_staging(c), geo_source(c)))
        check(f"12.hostile.{name}.phase_failed", comp_state(c, COMP_G).get("phase") == "PHASE_FAILED", comp_state(c, COMP_G))
    # после всех отказов ядро работает: чистый набор применяется
    good = os.path.join(DW, "geo-good.zip")
    ups("geo-pack", "-in", put_tree("geo-src", dict(files, **{"geosite/riot.srs": srs("marker-1")})), "-out", good)
    publish_data(zip_path=good, serial=serial + 10)
    c.check()
    download(c, [COMP_G])
    frames, end = apply_all(c, (COMP_G,))
    check("12.hostile.recovery_clean_set_applies", evs(frames) == [("applied", "geo")] and geo_source(c).get("rev") == 7000, (evs(frames), end))
    c.stop()


def sec12_manifest_negatives():
    """12.8 Манифест данных: нет geo.rev, подмена манифеста, неверный канал в настройке."""
    files = geo_files()
    zpath = os.path.join(DW, "geo.zip")
    ups("geo-pack", "-in", put_tree("geo-src", dict(files, **{"geosite/riot.srs": srs("marker-1")})), "-out", zpath)
    if D.get("raw"):
        publish_data(zip_path=zpath, tool=D["raw"], geo_rev=-1, serial=900)
        mf = json.loads(read(os.path.join(META, "manifest-stable.json")))
        signed = json.loads(mf["signed"]) if isinstance(mf.get("signed"), str) else mf.get("signed", {})
        check("12.norev.manifest_really_lacks_rev", "geo" in signed and "rev" not in signed["geo"], signed.get("geo"))
        c = data_core("s12m")
        r = c.check()
        code = r[1].get("code") if isinstance(r[1], dict) else None
        check("12.norev.refused_not_offered", r[0] >= 400 and COMP_G not in offered(r) and last_checked(c) == 0, (r[0], str(r[1])[:200]))
        check("12.norev.has_reason_header", r[2].get("Lavray-Update-Reason") == "metadata_invalid",
              "ответ " + str(r[0]) + ", заголовок Lavray-Update-Reason: " + str(r[2].get("Lavray-Update-Reason")) + "; " + str(r[1])[:100])
        c.stop()
    else:
        check("12.norev.skipped", False, "нет собранного raw-updsign", warn=True)
    # подмена манифеста другим, тоже верно подписанным: его sha256 закреплён в timestamp
    publish_data(zip_path=zpath, serial=910)
    first = read(os.path.join(META, "manifest-stable.json"))
    publish_data(zip_path=zpath, serial=911)
    write(os.path.join(META, "manifest-stable.json"), first)
    c = data_core("s12m")
    r = c.check()
    check("12.swap.manifest_mismatch", r[0] == 400 and reason(r) == ("failed_precondition", "manifest_mismatch", "manifest_mismatch") and last_checked(c) == 0, (r[0], reason(r)))
    check("12.swap.nothing_offered", COMP_G not in offered(r), "")
    r = c.rpc("SettingsService", "SetSettings", {"values": {"update.channel": {"stringValue": "bogus"}}})
    check("12.settings.channel_bogus_invalid_argument", r[0] == 400 and r[1].get("code") == "invalid_argument", (r[0], str(r[1])[:120]))
    r = c.rpc("SettingsService", "GetSettings", {"keys": ["update.channel"]})
    check("12.settings.channel_unchanged", r[0] == 200 and r[1].get("values", {}).get("update.channel", {}).get("stringValue", "stable") == "stable", r[1])
    c.stop()


def build_data_core():
    tags = read(os.path.join(CORE_SRC, "BUILD_TAGS")).decode().strip()
    return build("lavray-core-data.exe", os.path.join(KEYS, "root1.json"), tags=tags)


def main():
    started = time.time()
    only = sys.argv[3] if len(sys.argv) > 3 else "all"
    do_base, do_data = only in ("all", "base"), only in ("all", "data")
    env = dict(os.environ, CGO_ENABLED="0")
    rc, out, err = run(["go", "build", "-o", UPDSIGN, "./cmd/updsign"], cwd=CORE_SRC, env=env)
    if rc != 0:
        print("не собралась утилита updsign:", err[:300])
        return 1
    setup_keys_and_roots()
    if do_base:
        X["exe"] = build("lavray-core-test.exe", R("root1.json"))
        X["exe_ph"] = build("lavray-core-placeholder.exe", None)
        check("0.setup.cores_built_and_keys_outside_repo", os.path.isfile(X["exe"]) and os.path.isfile(X["exe_ph"]), "")
    if do_data:
        shutil.rmtree(DW, ignore_errors=True)
        os.makedirs(DW)
        D["exe"] = build_data_core()
        check("0.setup.data_core_built_with_build_tags", os.path.isfile(D["exe"]), "")
    SITE_SRV.start(P1)
    SITE_SRV.start(P2)
    print(f"зеркала: {BOOT[0]} {BOOT[1]}; подготовка {time.time() - started:.0f} с", flush=True)
    try:
        fns = []
        if do_base:
            fns += [sec1_not_configured, sec2_success_path, sec3_metadata_negatives, sec4_state, sec5_rotation, sec6_transport,
                    sec7_artifact_negatives, sec8_local_verify, sec9_cli, sec10_agent, sec11_channels]
        if do_data:
            fns += [sec12_tools, sec12_success_path, sec12_active_session, sec12_tamper_and_freshness, sec12_race_not_newer,
                    sec12_hostile_archives, sec12_manifest_negatives]
        for fn in fns:
            try:
                fn()
            except Exception as e:  # noqa: BLE001 - сбой раздела не должен скрывать остальные
                import traceback
                traceback.print_exc()
                check(f"{fn.__name__}.no_exception", False, repr(e))
    finally:
        for port in list(SITE_SRV.servers):
            SITE_SRV.stop(port)
    failed = [r for r in RESULTS if not r["pass"] and not r["warn"]]
    warns = [r for r in RESULTS if r["warn"]]
    with open(os.path.join(OUT, "a13-result.json"), "w", encoding="utf-8") as f:
        json.dump({"total": len(RESULTS), "failed": len(failed), "warnings": len(warns), "checks": RESULTS}, f, ensure_ascii=False, indent=1)
    print(f"A13: проверок {len(RESULTS)}, провалов {len(failed)}, наблюдений WARN {len(warns)}, {time.time() - started:.0f} с")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```
