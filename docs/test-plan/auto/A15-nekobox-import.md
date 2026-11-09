# A15. Перенос из NekoBox (T-78): синтетический каталог, MigrationService и `lavray-core import-nekobox`

| Поле | Значение |
|---|---|
| ID | A15 |
| Слой | авто |
| Время | 1–2 минуты скрипт (создание 20 000 файлов для проверки пределов занимает больше всего) + около 1 минуты Go-тесты |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–7; ядро выпуска `<TAG>` (по умолчанию `v0.9.3`; на момент написания — `main` на `9b26be6`, ветка `feat/T-78-nekobox`, `03ca0f6`, то же дерево). Группа P. Сценарии по API с кодами ошибок, общие для всех сервисов, — `A09` (раздел 7); экран — `M10` |
| Опасность | нет: ядра работают на loopback в каталогах `C:\lavray-test\tmp\A15`; системный прокси, TUN, реестр и настоящий профиль пользователя не затрагиваются. Одна оговорка: на несколько секунд запускается копия `PING.EXE` под именем `nekobox.exe` (так проверяется признак «NekoBox запущен»); страж «тестовый ПК» отказывает при настоящем `nekobox.exe`, поэтому A15 не запускают одновременно с проверкой стража и с файлами группы S. Скрипт завершает этот процесс в любом случае |

`<TAG>` — тег выпуска под тестом; по умолчанию `v0.9.3` (единый итоговый тег плана доработки). В `env.ps1` это переменная `LAVRAY_REF`.

## Цель

Проверить перенос данных из NekoBox (T-78, Ф4) без настоящего NekoBox: скрипт строит синтетический каталог `config` по образцу `core/internal/store/nekoimport/testdata/nekobox/config/` из репозитория и проходит по `MigrationService` и по подкоманде `lavray-core import-nekobox`. Проверяются:

- поиск установок (`DetectNekoBox`): переданные пути, профиль пользователя, дубли, признак «NekoBox запущен»;
- предпросмотр равен переносу и ничего не пишет; состав перенесённого (группы в порядке `pm.json`, порядок профилей из `order`, цепочка, `front_proxy_id`, подписка, custom-поля без подтверждения);
- идемпотентность по ключу «id + тип + адрес» (`alreadyPresent = 11`), возврат удалённой локально записи, тот же id с другим содержимым — новая запись;
- коллизии id с чужими профилями LAVRay: свои данные не затронуты, перенумерованные записи получают новые id, цепочка, `front_proxy_id` и ссылки в настройках переписаны; освободившийся локальный id не возвращается в оборот;
- группа с id 0 и front proxy; звено цепочки, которого нет; профиль чужой группы; каталог без групп;
- маршруты `routes_box/` → пользовательские наборы `custom:neko-<slug>`, активный маршрут NekoBox (`nekoboxActiveRoute`), битый маршрут не фатален;
- настройки по таблице соответствия: недопустимые значения не пишутся, `update.*` не пишется никогда;
- пределы (20 000 файлов, 64 МиБ, 2 МиБ на файл), символические ссылки и не обычные файлы не читаются;
- параллельный перенос → `ABORTED`; агентский токен отказан во всех режимах;
- подкоманда `import-nekobox`: коды выхода, сухой прогон оставляет файлы базы побайтно прежними.

## Предусловия

- Python 3.12 (модуль `sqlite3` читает базу только на чтение); ядро выпуска `<TAG>`; Git и Go для шага 3.
- Свободное место: проверка пределов создаёт и сразу удаляет около 80 МиБ.
- Права на создание символических ссылок (режим разработчика Windows или администратор) — по желанию. Без них проверки ссылок получают `WARN` и пропускаются; настройки системы для этого не меняются.

## Безопасность

Настоящий NekoBox и настоящий профиль не читаются: каталог строится скриптом (адреса из документационной сети `203.0.113.0/24`, секреты случайные при каждом запуске), а ядрам подменяются `APPDATA` и `LOCALAPPDATA`. Секреты в отчёты не попадают; сам скрипт проверяет, что их нет ни в отчётах переноса, ни в журнале ядра. Если на ПК уже запущен настоящий NekoBox (не тестовый ПК), проверки «не запущен» пропускаются с `WARN`, а найденные настоящие установки отбрасываются и не печатаются.

## Шаги

1. Каталоги и ядро.

   ```powershell
   . C:\lavray-test\env.ps1
   $t = 'C:\lavray-test\tmp\A15'
   New-Item -ItemType Directory -Force -Path $t, C:\lavray-test\results\A15 | Out-Null
   $exe = if (Test-Path $env:LAVRAY_CORE_EXE) { $env:LAVRAY_CORE_EXE } else { 'C:\lavray-test\tmp\A03\lavray-core.exe' }
   Test-Path $exe
   ```

   Ожидается: `True`. Ядру нужен только тот же набор тегов, что и в A03; настоящий sing-box для A15 не требуется.

2. Сохраните скрипт из раздела «Скрипт `a15_nekobox.py`» как `C:\lavray-test\tmp\A15\a15_nekobox.py` и запустите:

   ```powershell
   python -I "$t\a15_nekobox.py" $exe "$t\run" 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A15\run.txt | Select-Object -Last 12
   "a15 exit=$LASTEXITCODE"
   $res = Get-Content "$t\run\a15-result.json" -Raw | ConvertFrom-Json
   "проверок: $($res.total), провалов: $($res.failed), наблюдений: $($res.warnings)"
   $res.checks | Where-Object { -not $_.pass } | Select-Object id, warn, detail | Format-Table -AutoSize -Wrap
   ```

   Ожидается: `a15 exit=0`, `провалов: 0`. Эталон на теге v0.9.0 (коммит `8093656`): 129 проверок, если у PowerShell есть право создавать символические ссылки (Режим разработчика Windows или администратор), обычно без `WARN`; без этого права (обычный пользователь) строка итога `проверок: 128, провалов: 0, наблюдений: 1`, то есть 128 проверок, из которых одна `WARN` — `8.symlink.can_create_links`: две проверки `8.symlink.*` заменяет одна запись-наблюдение, поэтому общее число на единицу меньше. Скрипт считает `проверок` вместе с `WARN`-записями. Итого допускается до трёх `WARN` (на более поздних тегах проверок может быть больше, меньше быть не должно). Допустимые `WARN` (их список идёт в «Дефекты» с серьёзностью из таблицы ниже):

   | `WARN` | Причина | Серьёзность |
   |---|---|---|
   | `8.symlink.can_create_links` | нет права на символические ссылки: проверки `8.symlink.*` пропущены (поведение покрывает Go-тест `TestSymlinkNotFollowed`, который без права тоже `SKIP`) | не дефект |
   | `9.concurrent.some_import_aborted` | диск настолько быстр, что ни один из шести параллельных переносов не получил `ABORTED`; поведение покрывает `TestConcurrentImportAborted` (шаг 3) | не дефект |
   | `11.cli.failed_real_run_creates_no_database` | только на сборках до `470d5f2`: `import-nekobox` без `--dry-run` открывал базу в `--data` до проверки `--from`, и неудачный перенос оставлял пустую `lavray.db` (в `main` с `80be1e9` исправлено) | `minor` |
   | `1.detect.no_real_neko_process` | на ПК уже запущен настоящий NekoBox (не тестовый ПК) | не дефект |

   Если на тестовом ПК не прошла проверка `1.detect.process_looks_running`, сначала выполните `Get-Process nekobox, nekoray`, затем проверьте, не заблокировал ли антивирус запуск копии `PING.EXE`.

3. Тесты репозитория, которые скрипт не повторяет (создать из скрипта такие условия нельзя или нужны права):

   ```powershell
   Set-Location (Join-Path $env:LAVRAY_SRC 'core')
   go test -count=1 -v -run '^(TestScanDoesNotWrite|TestPreviewMatchesImport|TestImportRemapsIDOnCollision|TestRemapRewritesChainAndFrontProxy|TestReimportAfterLocalDelete|TestImportIsOneTransaction|TestApplyConflictIsReported|TestImportRollsBackSettingsAndMeta|TestFileSizeAndCountCaps|TestSymlinkNotFollowed|TestOnlyBaseNamesAreUsed|TestFrontProxyOfGroupZero|TestDeletedLocalIDIsNotReused|TestNoUpdateKeysFromNekoBox|TestSettingRulesMatchDescriptors|FuzzScanEntity)$' ./internal/store/nekoimport/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   go test -count=1 -v -run '^(TestPreviewMatchesImport|TestImportRoutesCreatesPreset|TestPathValidation|TestConcurrentImportAborted|TestImportLimitsExhausted|TestAgentDeniedMigration)$' ./internal/api/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   Set-Location C:\lavray-test
   ```

   Ожидается: для каждого имени `--- PASS` (кроме `TestSymlinkNotFollowed`: `--- SKIP` без права на ссылки), строки `ok`. Тест, которого нет в выбранном коммите (`testing: warning: no tests to run`), запишите в отклонения и сверьтесь с `go test -list 'Import|Neko|Migration' ./internal/...`. `FuzzScanEntity` без флага `-fuzz` выполняет только seed-корпус (A02 шаг 7 прогоняет его короче по времени).

4. Что проверяет скрипт (для отчёта и поиска причины):

   | Блок | Проверки (идентификаторы начинаются с номера блока) |
   |---|---|
   | 1. `DetectNekoBox` | в профиле (`APPDATA\nekoray\config`, `LOCALAPPDATA\nekoray\config`) найдено два кандидата `appdata` и `localappdata` с числами по именам файлов (группы 2, профили 9, маршруты 2); переданный путь идёт первым с источником `manual`; каталог установки приводится к вложенному `config`; дубли (в том числе другим регистром) схлопываются; относительный, несуществующий и пустой каталог игнорируются без ошибки; при запущенном «nekobox.exe» (копия `PING.EXE` в каталоге установки) появляется кандидат `process`, у него и у каталогов профиля `looksRunning = true`, а `manual` побеждает `process` при том же каталоге; после завершения процесса признак снимается |
   | 2. Пути | пустой, из пробелов, относительный, файл, каталог без `groups`/`profiles` → `400 invalid_argument`, несуществующий → `404 not_found` (и в `Preview`, и в `Import`); после отказов база пуста; каталог установки с вложенным `config` принимается |
   | 3. Состав и повторы | `Preview`: `dryRun`, база и наборы не изменились; `Import` равен предпросмотру; 2 группы, 7 профилей известных типов (vless, vmess, trojan, shadowsocks, hysteria2, chain, socks), 2 пропуска с причинами (битый `profiles/8.json`, неизвестный тип `wireguard` в `profiles/9.json`), `renumbered = 0`, 2 маршрута, активный маршрут `custom:neko-ru-bypass-games`; группы с id 0 и 1, подписка (адрес, трафик, время обновления), порядок профилей из `order`, цепочка и `front_proxy_id` указывают на перенесённые профили, custom-поля перенесены **неподтверждёнными**, порты прыжков hysteria2, признак «недоступен» (`yc = -1`) сохранён; каталог NekoBox не изменился; в отчётах и журнале нет секретов; повтор: ничего нового, `alreadyPresent = 11`, база байт в байт прежняя; после локального удаления профиля и набора повтор возвращает ровно их (`alreadyPresent = 9`, дублей нет); тот же id с другим адресом — новая запись (`alreadyPresent = 10`) |
   | 4. Коллизии | четыре чужих профиля LAVRay с id 1–4: после переноса они на месте с теми же id и адресами, перенумерованные записи получили новые id, цепочка и `front_proxy_id` переписаны, `remember.id` и `ui.current_group` указывают на новые id; повтор идемпотентен; освободившийся локальный id не занят новой записью |
   | 5. Края | группа 0 с `front_proxy_id` переносится так же, как проходит предпросмотр; звено цепочки 77 отброшено с предупреждением `member 77`; профиль несуществующей группы попал в первую группу с предупреждением `group 5 missing`; каталог только с `profiles/` получает группу `Imported` (`no groups found`) |
   | 6. Маршруты | без `includeRoutes` наборов нет, но `routesFound` посчитан и `nekoboxActiveRoute` не задан; с ним — `custom:neko-default` и `custom:neko-ru-bypass-games` (имя `Neko: …`, не встроенный, ревизия 1, три прямых домена и один блокируемый); битый файл маршрута в `skipped` с типом `route`, остальные переносятся; активный набор после переноса остаётся `lav-ru`, пока клиент не вызовет `ActivatePreset` с `nekoboxActiveRoute` |
   | 7. Настройки | перенесённые значения читаются через `GetSettings` (`inbound.port = 3090` и др.); каждый ключ таблицы либо перенесён, либо назван в замечаниях; `theme = Fusion` (не из допустимых) назван в замечаниях; неизвестные ключи — одно замечание; `conn_stat`, `extraCore`, `check_include_pre` названы как не переносимые; `update.channel = beta` после переноса с `check_include_pre = true` остаётся `beta`, ни один ключ `update.*` не записан; недопустимые значения (`vpn_mtu = 99999`, `mux_protocol = quic`) не пишутся, допустимые рядом — пишутся; без `includeSettings` настройки не трогаются |
   | 8. Пределы | 20 001 файл → `429 resource_exhausted` (оба метода, база не меняется); 34 файла по ~2 МиБ (больше 64 МиБ суммарно) → `429`; один файл больше 2 МиБ пропущен (`larger than the per-file limit`), остальные перенесены; каталог с именем `50.json` пропущен как не обычный файл; символическая ссылка вместо `profiles/60.json` и `groups/nekobox.json` не читается (нужно право на ссылки) |
   | 9. Параллельность | шесть одновременных `ImportNekoBox` на каталоге с тысячами лишних файлов: все ответы `200` или `409 aborted`; в базе 7 профилей, 2 набора, `import_map` без повторов, `foreign_key_check` пуст |
   | 10. Агент | в режимах `read` и `control` все три метода → `403 permission_denied`; база не изменилась; основной токен работает |
   | 11. Командная строка | без `--from` и с неизвестным флагом — код 2; несуществующий путь и каталог не NekoBox — код 1 с текстом в stderr; сухой прогон без базы ничего не создаёт; сухой прогон при существующей базе оставляет `lavray.db` (и `-wal`) побайтно прежними; настоящий перенос с относительным `--from` — код 0; отчёт сухого прогона равен отчёту переноса и отчёту API на такой же базе; ядро видит перенесённое; повтор (`--no-settings`) — `alreadyPresent = 11`, база прежняя; `--no-routes --no-settings` отключают маршруты и настройки; каталог NekoBox не менялся |

5. Синтетический каталог (создаётся скриптом на каждый раздел заново; секреты случайные):

   | Файл | Содержимое |
   |---|---|
   | `groups/pm.json` | `{"groups":[0,1]}` (порядок вкладок) |
   | `groups/0.json` | группа 0 «Основная», `order = [1, 2, 3, 6]`, `front_proxy_id = -1` |
   | `groups/1.json` | группа 1 «Подписка», `order = [4, 5, 7]`, `url` с токеном, `info` (трафик, срок), `lastup`, `front_proxy_id = 1` |
   | `groups/nekobox.json` | настройки: `inbound_socks_port = 3090`, `remember_id = 3`, `current_group = 1`, `spmode2`, `check_include_pre = true`, `theme = "Fusion"`, `active_routing = "RU-bypass + Games"`, неизвестные ключи и др. |
   | `profiles/1.json` … `7.json` | vless (REALITY), vmess (ws), trojan, shadowsocks, hysteria2 (прыжки портов), цепочка `[3, 2]`, socks с полями `c_cfg`/`c_out` |
   | `profiles/8.json` | обрезанный JSON |
   | `profiles/9.json` | тип `wireguard` (неизвестный) |
   | `routes_box/Default`, `routes_box/RU-bypass + Games` | маршруты NekoRay (второй содержит процессное правило в поле `custom`) |

## Критерии PASS/FAIL

| № | Критерий | Шаг |
|---|---|---|
| К1 | `a15 exit=0`, провалов 0, проверок не меньше 128 (129 при праве на символические ссылки; значение для тега v0.9.0, коммит `8093656`), допустимые `WARN` только из таблицы шага 2 | 2 |
| К2 | Каталог NekoBox не изменяется ни предпросмотром, ни переносом, ни командной строкой; секретов нет в отчётах и журнале | 2 (`3.source_dir_unchanged_after_import`, `3.report.has_no_secrets`, `3.log.has_no_secrets`, `11.cli.source_dir_unchanged`) |
| К3 | Предпросмотр равен переносу и ничего не пишет; отказанные вызовы ничего не пишут | 2 (`3.preview.*`, `3.preview_equals_import`, `2.paths.rejected_calls_wrote_nothing`) |
| К4 | Повторный перенос не создаёт дублей; удалённое локально возвращается; тот же id с другим содержимым — новая запись | 2 (`3.idem.*`, `3.reimport_after_delete.*`, `3.same_id_new_content.*`) |
| К5 | Чужие данные LAVRay не затронуты; ссылки цепочек, `front_proxy_id` и настроек переписаны; группа 0 с front proxy переносится | 2 (блоки 4, 5) |
| К6 | Маршруты → наборы `custom:neko-<slug>`; настройки по таблице; `update.*` не пишется; недопустимое не пишется | 2 (блоки 6, 7) |
| К7 | Пределы работают, ссылки и не обычные файлы не читаются, параллельный перенос не портит базу | 2 (блоки 8, 9) |
| К8 | Агент отказан во всех режимах; коды путей по таблице | 2 (блоки 2, 10) |
| К9 | Подкоманда: коды выхода, сухой прогон не меняет файлы базы | 2 (блок 11) |
| К10 | Go-тесты шага 3 проходят | 3 |

## Что собрать

`results\A15\run.txt`, копия `a15-result.json`, вывод шага 3. Каталог `run\src` (синтетические данные, удаляется скриптом по частям) и базы `run\*\data` **не** копировать.

## Откат / уборка

```powershell
Get-Process lavray-core, nekobox -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\lavray-test\*' } | Stop-Process -Force
Remove-Item -Recurse -Force C:\lavray-test\tmp\A15
Test-Path C:\lavray-test\tmp\A15
```

Ожидается `False`. Если `nekobox.exe` из `C:\lavray-test\tmp\A15\run\src\s1-install` остался, это копия `PING.EXE`: завершите её командой выше.

## Отчёт

`results/A15.md` по `templates/REPORT.md`: шаги 1–3, К1–К10. Серьёзность: секрет в отчёте или журнале, изменение каталога NekoBox, потеря или перезапись данных LAVRay при переносе (К5), доступ агента (К8) — `critical`; предпросмотр не равен переносу, дубли при повторе, запись `update.*`, изменение базы сухим прогоном командной строки, непрочитанные пределы (К3, К4, К6, К7, К9) — `major`; `WARN 11.cli.failed_real_run_creates_no_database` — `minor`.

## Скрипт `a15_nekobox.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A15: перенос из NekoBox (T-78) на синтетическом каталоге config: MigrationService по Connect JSON и
подкоманда `lavray-core import-nekobox`. Настоящий NekoBox и настоящий профиль пользователя не читаются:
каталог строится здесь, а ядру подменяются APPDATA и LOCALAPPDATA.

Запуск: python -I a15_nekobox.py <lavray-core.exe> <каталог результатов>
Код выхода: 0 - все проверки PASS, 1 - есть FAIL. Итог: <каталог>/a15-result.json.
"""
import hashlib
import json
import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
EXE, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(OUT, exist_ok=True)
RESULTS = []
M = "MigrationService"
R = "RoutingService"
P = "ProfileService"
S = "SettingsService"


def check(cid, ok, detail="", warn=False):
    """warn=True: наблюдение, при провале печатается WARN и итог файла не меняется."""
    RESULTS.append({"id": cid, "pass": bool(ok), "warn": bool(warn and not ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else ("WARN " if warn else "FAIL ")) + cid + ("" if ok else " :: " + str(detail)[:220]), flush=True)


def norm(p):
    return os.path.normcase(os.path.normpath(p))


def slash(p):
    return p.replace(chr(92), "/")


def wjson(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------- ядро ----

class Core:
    """Ядро `serve` с отдельным каталогом данных и подменённым профилем (APPDATA, LOCALAPPDATA)."""

    def __init__(self, name):
        self.name = name
        self.root = os.path.join(OUT, name)
        shutil.rmtree(self.root, ignore_errors=True)
        self.data = os.path.join(self.root, "data")
        self.appdata = os.path.join(self.root, "appdata")
        self.localappdata = os.path.join(self.root, "localappdata")
        for d in (self.data, self.appdata, self.localappdata):
            os.makedirs(d)
        self.tok, self.agent = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        self.p = None

    def start(self):
        env = dict(os.environ, APPDATA=self.appdata, LOCALAPPDATA=self.localappdata)
        self.p = subprocess.Popen([EXE, "serve", "--listen-socket", "127.0.0.1:0", "--data", self.data], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=open(os.path.join(self.root, "core-stderr.log"), "ab"), env=env)
        self.p.stdin.write((self.tok + chr(10) + self.agent + chr(10)).encode())
        self.p.stdin.flush()
        self.base = "http://" + self.p.stdout.readline().decode().split()[1].replace("tcp://", "")
        return self

    def rpc(self, svc, method, body=None, token=None):
        req = urllib.request.Request(f"{self.base}/lavray.v1.{svc}/{method}", data=json.dumps(body or {}).encode(),
                                     headers={"Authorization": "Bearer " + (token or self.tok), "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw

    def stop(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=30)
        except Exception:  # noqa: BLE001
            self.p.kill()
            self.p.wait()

    def dbfile(self):
        return os.path.join(self.data, "lavray.db")

    # --- удобные обёртки ---
    def preview(self, path, routes=True, settings=False):
        return self.rpc(M, "PreviewNekoBoxImport", {"path": path, "includeRoutes": routes, "includeSettings": settings})

    def imp(self, path, routes=True, settings=False):
        return self.rpc(M, "ImportNekoBox", {"path": path, "includeRoutes": routes, "includeSettings": settings})

    def profiles(self):
        st, r = self.rpc(P, "ListProfiles", {})
        return {p["name"]: p for p in r.get("profiles", [])} if st == 200 else {}

    def groups(self):
        st, r = self.rpc(P, "ListGroups", {})
        return {g["name"]: g for g in r.get("groups", [])} if st == 200 else {}

    def custom_presets(self):
        st, r = self.rpc(R, "ListPresets")
        return {p["id"]: p for p in r.get("presets", []) if p["id"].startswith("custom:")} if st == 200 else {}

    def seed(self, n):
        gid = self.rpc(P, "ListGroups", {})[1]["groups"][0]["id"]
        ids = []
        for i in range(n):
            st, r = self.rpc(P, "CreateProfile", {"profile": {"groupId": gid, "type": "PROFILE_TYPE_SOCKS", "name": f"a15-local-{i + 1}",
                                                              "address": "127.0.0.1", "port": 1081 + i, "socksHttp": {"proto": "PROTO_SOCKS5"}}})
            ids.append(r.get("id"))
        return ids


def db_snapshot(data):
    """Содержимое базы, которое меняет перенос: группы, профили, import_map, настройки (кроме update.*), наборы маршрутов."""
    con = sqlite3.connect("file:" + os.path.join(data, "lavray.db").replace(os.sep, "/") + "?mode=ro", uri=True)
    out = {}
    try:
        for name in ("groups", "profiles", "import_map", "settings"):
            rows = con.execute(f'SELECT * FROM "{name}"').fetchall()
            if name == "settings":
                rows = [r for r in rows if not str(r[0]).startswith("update.")]
            out[name] = sorted(json.dumps(r, default=str, ensure_ascii=False) for r in rows)
        out["meta.presets"] = [r[0] for r in con.execute("SELECT value FROM meta WHERE key = 'routing.custom_presets'")]
    finally:
        con.close()
    return out


def snap_dir(path):
    """{относительный путь: (размер, sha256)} - проверка, что каталог NekoBox не менялся."""
    out = {}
    for base, _dirs, files in os.walk(path):
        for fn in files:
            full = os.path.join(base, fn)
            try:
                with open(full, "rb") as f:
                    out[slash(os.path.relpath(full, path))] = (os.path.getsize(full), hashlib.sha256(f.read()).hexdigest())
            except OSError:
                out[slash(os.path.relpath(full, path))] = ("err", "")
    return out


def file_hash(path):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


# --------------------------------------------------------- синтетический каталог ----

SECRETS = {k: secrets.token_hex(12) for k in ("sub", "vless", "vmess", "trojan", "ss", "hy2", "obfs", "sockspw", "pbk")}


def make_fixture(root, front0=-1, chain=(3, 2), routes=True, nekobox_json=True, extra=None):
    """Каталог config, устроенный как testdata/nekobox/config из репозитория: 2 группы, 7 профилей известных типов,
    один битый файл, один профиль неизвестного типа, 2 маршрута, настройки. Адреса из документационной сети 203.0.113.0/24."""
    S_ = SECRETS
    wjson(os.path.join(root, "groups", "pm.json"), '{"groups":[0,1]}')
    wjson(os.path.join(root, "groups", "0.json"), {"id": 0, "front_proxy_id": front0, "archive": False, "skip_auto_update": False,
                                                    "name": "Основная", "order": [1, 2, 3, 6], "manually_column_width": False, "column_width": [220, 120, 90]})
    wjson(os.path.join(root, "groups", "1.json"), {"id": 1, "front_proxy_id": 1, "archive": False, "skip_auto_update": False, "name": "Подписка",
                                                    "order": [4, 5, 7], "url": "https://sub.a15.example/list?token=" + S_["sub"],
                                                    "info": "upload=1048576; download=2097152; total=1073741824; expire=1735689600",
                                                    "lastup": 1730000000, "manually_column_width": True, "column_width": [200, 100]})
    prof = {
        1: {"type": "vless", "id": 1, "gid": 0, "yc": 85, "bean": {"_v": 0, "name": "a15 vless", "addr": "203.0.113.10", "port": 443, "pass": S_["vless"],
            "flow": "xtls-rprx-vision", "stream": {"net": "tcp", "sec": "reality", "sni": "www.example.com", "utls": "chrome", "pbk": S_["pbk"],
                                                    "sid": "abcd1234", "insecure": False, "ed_len": 0, "mux_s": 0}}, "traffic": {"dl": 5000, "ul": 1000}},
        2: {"type": "vmess", "id": 2, "gid": 0, "yc": -1, "bean": {"_v": 0, "name": "a15 vmess", "addr": "203.0.113.11", "port": 443, "id": S_["vmess"],
            "aid": 0, "sec": "auto", "stream": {"net": "ws", "sec": "tls", "path": "/ws", "host": "cdn.example.com", "sni": "cdn.example.com",
                                                 "insecure": False, "ed_len": 0, "mux_s": 0}}},
        3: {"type": "trojan", "id": 3, "gid": 0, "yc": 120, "bean": {"_v": 0, "name": "a15 trojan", "addr": "203.0.113.12", "port": 443, "pass": S_["trojan"],
            "stream": {"net": "tcp", "sec": "tls", "sni": "tr.example.com", "alpn": "h2,http/1.1", "insecure": False, "ed_len": 0, "mux_s": 0}}},
        4: {"type": "shadowsocks", "id": 4, "gid": 1, "yc": 0, "bean": {"_v": 0, "name": "a15 ss", "addr": "203.0.113.13", "port": 8388,
            "method": "aes-256-gcm", "pass": S_["ss"], "uot": 0}},
        5: {"type": "hysteria2", "id": 5, "gid": 1, "yc": 60, "bean": {"_v": 0, "name": "a15 hy2", "addr": "203.0.113.14", "port": 8443, "password": S_["hy2"],
            "obfsPassword": S_["obfs"], "uploadMbps": 100, "downloadMbps": 500, "hopInterval": 30, "hopPort": "20000-30000", "sni": "hy.example.com"}},
        6: {"type": "chain", "id": 6, "gid": 0, "yc": 0, "bean": {"_v": 0, "name": "a15 chain", "list": list(chain)}},
        7: {"type": "socks", "id": 7, "gid": 1, "yc": 0, "bean": {"_v": 0, "name": "a15 socks custom", "addr": "203.0.113.15", "port": 1080, "v": 5,
            "username": "user7", "password": S_["sockspw"], "c_cfg": json.dumps({"outbounds": [{"type": "direct"}]}), "c_out": json.dumps({"type": "socks"})}},
        9: {"type": "wireguard", "id": 9, "gid": 0, "yc": 0, "bean": {"_v": 0, "name": "a15 wg future", "addr": "203.0.113.16", "port": 51820}},
    }
    for pid, obj in prof.items():
        wjson(os.path.join(root, "profiles", f"{pid}.json"), obj)
    wjson(os.path.join(root, "profiles", "8.json"), '{"type":"vmess","id":8,"gid":0,"bean":{"name":"broken')
    for pid, obj in (extra or {}).items():
        wjson(os.path.join(root, "profiles", f"{pid}.json"), obj)
    if routes:
        wjson(os.path.join(root, "routes_box", "Default"), {"def_outbound": "proxy", "direct_domain": "", "direct_ip": "geoip:private",
                                                              "proxy_domain": "", "proxy_ip": "", "block_domain": "", "block_ip": "", "sniffing_mode": 1})
        wjson(os.path.join(root, "routes_box", "RU-bypass + Games"), {
            "def_outbound": "proxy", "direct_dns": "local", "remote_dns": "https://1.1.1.1/dns-query", "dns_routing": True,
            "direct_domain": "geosite:category-ru" + chr(10) + "domain:exitgames.com" + chr(10) + "domain:photonengine.io",
            "direct_ip": "geoip:ru" + chr(10) + "geoip:private", "proxy_domain": "geosite:google" + chr(10) + "geosite:youtube", "proxy_ip": "",
            "block_domain": "geosite:category-ads-all", "block_ip": "", "domain_strategy": "AsIs", "outbound_domain_strategy": "", "sniffing_mode": 1,
            "custom": json.dumps({"rules": [{"process_name": ["game.exe", "launcher.exe"], "outbound": "bypass"}]})})
    if nekobox_json:
        wjson(os.path.join(root, "groups", "nekobox.json"), {
            "inbound_address": "127.0.0.1", "inbound_socks_port": 3090, "inbound_auth": {"user": "demo", "pass": "demo-" + S_["sockspw"]},
            "test_url": "https://www.gstatic.com/generate_204", "test_concurrent": 5, "sub_use_proxy": True, "sub_auto_update": 1440,
            "user_agent2": "a15-agent/1.0", "mux_protocol": "h2mux", "mux_concurrency": -1, "vpn_impl": 2, "vpn_mtu": 9000, "vpn_strict_route": True,
            "vpn_ipv6": False, "hk_mw": "Ctrl+Alt+M", "remember_id": 3, "remember_enable": True, "spmode2": ["system_proxy"], "current_group": 1,
            "core_box_clash_api": -9090, "check_include_pre": True, "active_routing": "RU-bypass + Games", "log_level": "info", "theme": "Fusion",
            "conn_stat": True, "extraCore": {"core_map": "{}"}, "future_option_x": 1, "another_unknown": "y"})
    return root


def gid(x):
    """id группы или профиля: нулевое значение proto3 JSON не печатает."""
    return x.get("id", "0")


def neko_processes():
    """Имена запущенных NekoBox или nekoray (на тестовом ПК страж гарантирует, что их нет)."""
    out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True).stdout.decode("cp866", "replace")
    return sorted({ln.split(",")[0].strip('"').lower() for ln in out.splitlines() if ln.split(",")[0].strip('"').lower() in ("nekobox.exe", "nekoray.exe")})


def rget(r, key, default=0):
    return r.get(key, default) if isinstance(r, dict) else default


def reports_equal(a, b):
    a, b = dict(a), dict(b)
    a.pop("dryRun", None)
    b.pop("dryRun", None)
    return a == b


def nonzero_types(r):
    return {k: v for k, v in rget(r, "profilesByType", {}).items() if v}


# ---------------------------------------------------------------- разделы ----

def sec1_detect(base):
    """1. DetectNekoBox: extra_paths, профиль пользователя, дубли, запущенный NekoBox (копия ping.exe под именем nekobox.exe)."""
    c = Core("s1").start()
    install = os.path.join(base, "s1-install")
    make_fixture(os.path.join(install, "config"))
    make_fixture(os.path.join(c.appdata, "nekoray", "config"), nekobox_json=False)
    make_fixture(os.path.join(c.localappdata, "nekoray", "config"), nekobox_json=False)
    empty = os.path.join(base, "s1-empty")
    os.makedirs(empty, exist_ok=True)
    cfg = os.path.join(install, "config")

    real = neko_processes()
    if real:
        check("1.detect.no_real_neko_process", False, f"на этом ПК уже запущен {', '.join(real)}: проверки looks_running=false пропущены, кандидаты вне каталога результатов отброшены", warn=True)

    def cands(extra=None):
        st, r = c.rpc(M, "DetectNekoBox", {"extraPaths": extra} if extra is not None else {})
        if st != 200:
            return st, r
        return st, [x for x in r.get("candidates", []) if norm(x["path"]).startswith(norm(OUT))]  # настоящие установки пользователя не учитываются

    st, cs = cands()
    by = {x["source"]: x for x in cs} if st == 200 else {}
    check("1.detect.profile_dirs_found", st == 200 and set(by) == {"appdata", "localappdata"}, (st, [x["source"] for x in cs] if st == 200 else cs))
    a = by.get("appdata", {})
    check("1.detect.counts_by_file_names", a.get("groups") == 2 and a.get("profiles") == 9 and a.get("routes") == 2, {k: a.get(k) for k in ("groups", "profiles", "routes")})
    check("1.detect.not_running", real or not any(x.get("looksRunning") for x in cs), [x.get("looksRunning") for x in cs])
    st, cs = cands([cfg])
    check("1.detect.extra_path_is_manual_and_first", st == 200 and cs and cs[0]["source"] == "manual" and norm(cs[0]["path"]) == norm(cfg), [(x["source"], x["path"]) for x in cs] if st == 200 else cs)
    check("1.detect.extra_path_adds_one", st == 200 and len(cs) == 3, len(cs) if st == 200 else cs)
    st, cs = cands([install])
    check("1.detect.install_dir_resolves_to_config", st == 200 and cs and norm(cs[0]["path"]) == norm(cfg), [x["path"] for x in cs] if st == 200 else cs)
    st, cs = cands([install, cfg, cfg.upper()])
    check("1.detect.duplicates_collapsed", st == 200 and len(cs) == 3, len(cs) if st == 200 else cs)
    st, cs = cands(["relative", os.path.join(base, "no-such-dir"), empty])
    check("1.detect.bad_extra_paths_ignored", st == 200 and {x["source"] for x in cs} == {"appdata", "localappdata"}, (st, [x["source"] for x in cs] if st == 200 else cs))
    # запущенный NekoBox: копия ping.exe под именем nekobox.exe в каталоге установки
    proc = None
    fake = os.path.join(install, "nekobox.exe")
    try:
        shutil.copy(os.path.join(os.environ.get("SystemRoot", r"C:" + chr(92) + "Windows"), "System32", "PING.EXE"), fake)
        proc = subprocess.Popen([fake, "-n", "60", "127.0.0.1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.0)
        st, cs = cands()
        by = {x["source"]: x for x in cs} if st == 200 else {}
        check("1.detect.process_source", "process" in by and norm(by["process"]["path"]) == norm(cfg), [(x["source"], x["path"]) for x in cs] if st == 200 else cs)
        check("1.detect.process_looks_running", by.get("process", {}).get("looksRunning") is True, by.get("process"))
        check("1.detect.profile_dirs_warn_too", by.get("appdata", {}).get("looksRunning") is True and by.get("localappdata", {}).get("looksRunning") is True,
              (by.get("appdata", {}).get("looksRunning"), by.get("localappdata", {}).get("looksRunning")))
        st, cs = cands([cfg])
        check("1.detect.manual_beats_process", st == 200 and cs[0]["source"] == "manual" and cs[0].get("looksRunning") is True and
              len([x for x in cs if norm(x["path"]) == norm(cfg)]) == 1, [(x["source"], x.get("looksRunning")) for x in cs] if st == 200 else cs)
    except OSError as e:
        check("1.detect.process_probe_available", False, f"не удалось подготовить поддельный процесс: {e}", warn=True)
    finally:
        if proc is not None:
            proc.kill()
            proc.wait()
    time.sleep(0.5)
    st, cs = cands()
    check("1.detect.not_running_after_process_exit", st == 200 and (real or not any(x.get("looksRunning") for x in cs)), [x.get("looksRunning") for x in cs] if st == 200 else cs)
    c.stop()


def sec2_paths(base):
    """2. Проверка пути: коды ошибок Preview и Import."""
    c = Core("s2").start()
    make_fixture(os.path.join(base, "s2-fx"))
    install = os.path.join(base, "s2-install")
    make_fixture(os.path.join(install, "config"))
    plain = os.path.join(base, "s2-file.txt")
    wjson(plain, "x")
    empty = os.path.join(base, "s2-empty")
    os.makedirs(empty, exist_ok=True)
    db0 = db_snapshot(c.data)
    cases = [("empty", "", 400, "invalid_argument"), ("spaces", "   ", 400, "invalid_argument"), ("relative", "s2-fx", 400, "invalid_argument"),
             ("file", plain, 400, "invalid_argument"), ("empty_dir", empty, 400, "invalid_argument"), ("missing", os.path.join(base, "s2-missing"), 404, "not_found")]
    for name, path, want, wcode in cases:
        for call in ("PreviewNekoBoxImport", "ImportNekoBox"):
            st, r = c.rpc(M, call, {"path": path})
            check(f"2.paths.{name}.{call}", st == want and isinstance(r, dict) and r.get("code") == wcode, (st, str(r)[:100]))
    check("2.paths.rejected_calls_wrote_nothing", db_snapshot(c.data) == db0 and not c.profiles() and not c.custom_presets(), "после отказов в базе появились данные")
    st, r = c.imp(install, routes=False)
    check("2.paths.install_dir_with_nested_config", st == 200 and rget(r, "groupsImported") == 2, (st, str(r)[:100]))
    c.stop()


def sec3_import(base):
    """3. Предпросмотр = перенос; состав перенесённого; идемпотентность; повтор после локального удаления; тот же id с другим содержимым."""
    c = Core("s3").start()
    src = make_fixture(os.path.join(base, "s3-config"))
    src_before = snap_dir(src)
    db0 = db_snapshot(c.data)
    st, pv = c.preview(src, routes=True, settings=True)
    check("3.preview.ok_and_dry_run", st == 200 and pv.get("dryRun") is True, (st, str(pv)[:120]))
    check("3.preview.wrote_nothing", db_snapshot(c.data) == db0 and not c.custom_presets(), "база или наборы изменились")
    st, rp = c.imp(src, routes=True, settings=True)
    check("3.import.ok_not_dry_run", st == 200 and not rp.get("dryRun"), (st, str(rp)[:120]))
    check("3.preview_equals_import", st == 200 and reports_equal(pv, rp), json.dumps([pv, rp], ensure_ascii=False)[:250])
    want_types = {"vless": 1, "vmess": 1, "trojan": 1, "shadowsocks": 1, "hysteria2": 1, "chain": 1, "socks": 1}
    check("3.report.counts", rget(rp, "groupsImported") == 2 and nonzero_types(rp) == want_types and rget(rp, "alreadyPresent") == 0 and rget(rp, "renumbered") == 0,
          {k: rp.get(k) for k in ("groupsImported", "profilesByType", "alreadyPresent", "renumbered")})
    sk = {slash(x["file"]): x for x in rget(rp, "skipped", [])}
    check("3.report.skipped_two_with_reasons", set(sk) == {"profiles/8.json", "profiles/9.json"} and all(x.get("reason") for x in sk.values()), list(sk))
    check("3.report.unknown_type_recorded", sk.get("profiles/9.json", {}).get("type") == "wireguard", sk.get("profiles/9.json"))
    check("3.report.routes", rget(rp, "routesFound") == 2 and rget(rp, "routesImported") == 2 and rp.get("nekoboxActiveRoute") == "custom:neko-ru-bypass-games",
          {k: rp.get(k) for k in ("routesFound", "routesImported", "nekoboxActiveRoute")})
    g, p = c.groups(), c.profiles()
    check("3.groups.created_with_neko_ids_in_pm_order", "Основная" in g and "Подписка" in g and gid(g["Основная"]) == "0" and gid(g["Подписка"]) == "1" and list(g).index("Основная") < list(g).index("Подписка"), {k: gid(v) for k, v in g.items()})
    sub = g.get("Подписка", {})
    info = sub.get("subscriptionInfo", {})
    check("3.groups.subscription_fields", sub.get("kind") == "KIND_SUBSCRIPTION" and sub.get("subscriptionUrl", "").endswith(SECRETS["sub"]) and
          str(info.get("uploadBytes")) == "1048576" and str(info.get("totalBytes")) == "1073741824" and str(sub.get("lastUpdateMs")) == "1730000000000", (sub.get("kind"), info, sub.get("lastUpdateMs")))
    ids = {n: x["id"] for n, x in p.items()}
    check("3.profiles.seven_known_types_imported", len(p) == 7 and "a15 wg future" not in p, sorted(p))
    check("3.groups.profile_order_from_neko_order", g.get("Основная", {}).get("profileOrder") == [ids.get("a15 vless"), ids.get("a15 vmess"), ids.get("a15 trojan"), ids.get("a15 chain")] and
          g.get("Подписка", {}).get("profileOrder") == [ids.get("a15 ss"), ids.get("a15 hy2"), ids.get("a15 socks custom")], (g.get("Основная", {}).get("profileOrder"), g.get("Подписка", {}).get("profileOrder")))
    chain = p.get("a15 chain", {}).get("chain", {}).get("profileIds")
    check("3.chain.members_point_to_imported_profiles", chain == [ids.get("a15 trojan"), ids.get("a15 vmess")], (chain, ids))
    check("3.group.front_proxy_points_to_imported_profile", sub.get("frontProxyId") == ids.get("a15 vless"), (sub.get("frontProxyId"), ids.get("a15 vless")))
    sk_p = p.get("a15 socks custom", {})
    check("3.custom_fields.imported_unconfirmed", sk_p.get("customConfigJson") and sk_p.get("customOutboundJson") and not sk_p.get("customFieldsConfirmed"),
          {k: sk_p.get(k) for k in ("customConfigJson", "customOutboundJson", "customFieldsConfirmed")})
    check("3.hysteria2.hop_ports_mapped", "20000-30000" in json.dumps(p.get("a15 hy2", {})), json.dumps(p.get("a15 hy2", {}))[:200])
    check("3.vmess.unavailable_marker_kept", str(p.get("a15 vmess", {}).get("testResult", {}).get("latencyMs")) == "-1", p.get("a15 vmess", {}).get("testResult"))
    check("3.source_dir_unchanged_after_import", snap_dir(src) == src_before, "каталог NekoBox изменился")
    blob = json.dumps([pv, rp], ensure_ascii=False)
    check("3.report.has_no_secrets", not any(v in blob for v in SECRETS.values()), "в отчёте есть секрет из каталога NekoBox")
    st, tl = c.rpc("LogService", "GetTail", {"lines": 2000})
    logtxt = chr(10).join(x.get("message", "") for x in tl.get("lines", [])) if st == 200 else ""
    check("3.log.has_no_secrets", st == 200 and not any(v in logtxt for v in SECRETS.values()), "в журнале ядра есть секрет из каталога NekoBox")
    # идемпотентность
    snap1 = db_snapshot(c.data)
    st, r2 = c.imp(src, routes=True, settings=False)
    check("3.idem.nothing_new", st == 200 and rget(r2, "groupsImported") == 0 and not nonzero_types(r2) and rget(r2, "routesImported") == 0 and rget(r2, "renumbered") == 0,
          {k: r2.get(k) for k in ("groupsImported", "profilesByType", "routesImported", "renumbered")} if st == 200 else r2)
    check("3.idem.already_present_11", rget(r2, "alreadyPresent") == 11, rget(r2, "alreadyPresent"))
    check("3.idem.active_route_still_reported", r2.get("nekoboxActiveRoute") == "custom:neko-ru-bypass-games", r2.get("nekoboxActiveRoute"))
    check("3.idem.db_unchanged", db_snapshot(c.data) == snap1, "повторный перенос изменил базу")
    # локальное переименование и удаление
    pid_ss = ids["a15 ss"]
    c.rpc(P, "DeleteProfile", {"ids": [pid_ss]})
    st, dp = c.rpc(R, "DeletePreset", {"id": "custom:neko-default"})
    check("3.delete.local_delete_ok", st == 200 and "a15 ss" not in c.profiles() and "custom:neko-default" not in c.custom_presets(), (st, dp))
    st, r3 = c.imp(src, routes=True)
    p3 = c.profiles()
    check("3.reimport_after_delete.restores_only_deleted", st == 200 and nonzero_types(r3) == {"shadowsocks": 1} and rget(r3, "groupsImported") == 0 and rget(r3, "routesImported") == 1,
          {k: r3.get(k) for k in ("profilesByType", "groupsImported", "routesImported")} if st == 200 else r3)
    check("3.reimport_after_delete.already_present_9", rget(r3, "alreadyPresent") == 9, rget(r3, "alreadyPresent"))
    check("3.reimport_after_delete.no_duplicates", len(p3) == 7 and "a15 ss" in p3 and set(c.custom_presets()) == {"custom:neko-default", "custom:neko-ru-bypass-games"},
          (len(p3), sorted(c.custom_presets())))
    check("3.reimport_after_delete.restored_id_not_reused", p3.get("a15 ss", {}).get("id") != pid_ss, (p3.get("a15 ss", {}).get("id"), pid_ss), warn=True)
    # тот же id NekoBox, другое содержимое - новая запись
    wjson(os.path.join(src, "profiles", "3.json"), {"type": "trojan", "id": 3, "gid": 0, "bean": {"name": "a15 trojan moved", "addr": "203.0.113.99", "port": 443, "pass": "x" + SECRETS["trojan"]}})
    st, r4 = c.imp(src, routes=True)
    p4 = c.profiles()
    check("3.same_id_new_content.is_new_record", st == 200 and nonzero_types(r4) == {"trojan": 1} and rget(r4, "alreadyPresent") == 10 and "a15 trojan" in p4 and "a15 trojan moved" in p4,
          ({k: r4.get(k) for k in ("profilesByType", "alreadyPresent")}, sorted(p4)) if st == 200 else r4)
    c.stop()


def sec4_collisions(base):
    """4. Коллизии id: чужие профили LAVRay остаются на месте, NekoBox получает новые id, цепочка и front_proxy переписаны, настройки с id тоже."""
    c = Core("s4").start()
    src = make_fixture(os.path.join(base, "s4-config"))
    local_ids = c.seed(4)
    before = c.profiles()
    st, pv = c.preview(src, settings=True)
    st2, rp = c.imp(src, settings=True)
    check("4.collide.preview_equals_import", st == 200 and st2 == 200 and reports_equal(pv, rp), json.dumps([pv, rp], ensure_ascii=False)[:250])
    check("4.collide.local_ids_are_1_to_4", local_ids == ["1", "2", "3", "4"], local_ids, warn=True)
    check("4.collide.renumbered_reported", rget(rp, "renumbered") >= 1 and rget(rp, "alreadyPresent") == 0 and sum(nonzero_types(rp).values()) == 7,
          {k: rp.get(k) for k in ("renumbered", "alreadyPresent", "profilesByType")})
    after = c.profiles()
    check("4.collide.local_profiles_untouched", all(after.get(n, {}).get("id") == x["id"] and after[n].get("address") == x.get("address") for n, x in before.items()), {n: after.get(n, {}).get("id") for n in before})
    ids = {n: x["id"] for n, x in after.items() if n.startswith("a15 ")}
    check("4.collide.no_id_shared", len({x["id"] for x in after.values()}) == len(after) and len(after) == 4 + 7, len(after))
    chain = after.get("a15 chain", {}).get("chain", {}).get("profileIds")
    check("4.collide.chain_rewritten", chain == [ids.get("a15 trojan"), ids.get("a15 vmess")], (chain, ids.get("a15 trojan"), ids.get("a15 vmess")))
    g = c.groups()
    check("4.collide.front_proxy_rewritten", g.get("Подписка", {}).get("frontProxyId") == ids.get("a15 vless"), (g.get("Подписка", {}).get("frontProxyId"), ids.get("a15 vless")))
    st, sv = c.rpc(S, "GetSettings", {"keys": ["remember.id", "ui.current_group"]})
    vals = sv.get("values", {}) if st == 200 else {}
    check("4.collide.setting_refs_rewritten", vals.get("remember.id", {}).get("intValue") == ids.get("a15 trojan") and vals.get("ui.current_group", {}).get("intValue") == gid(g.get("Подписка", {})),
          (vals, ids.get("a15 trojan"), gid(g.get("Подписка", {}))))
    snap = db_snapshot(c.data)
    st, r2 = c.imp(src, settings=False)
    check("4.collide.reimport_idempotent", st == 200 and sum(nonzero_types(r2).values()) == 0 and rget(r2, "alreadyPresent") == 11 and rget(r2, "renumbered") == 0 and db_snapshot(c.data) == snap,
          {k: r2.get(k) for k in ("profilesByType", "alreadyPresent", "renumbered")} if st == 200 else r2)
    # освободившийся локальный id не возвращается в оборот: новая запись NekoBox с номером 1 получает другой id
    st, _ = c.rpc(P, "DeleteProfile", {"ids": [local_ids[0]]})
    src2 = make_fixture(os.path.join(base, "s4-config2"))
    wjson(os.path.join(src2, "profiles", "1.json"), {"type": "vless", "id": 1, "gid": 0, "bean": {"_v": 0, "name": "a15 vless v2", "addr": "203.0.113.77", "port": 443, "pass": SECRETS["vless"]}})
    st, r5 = c.imp(src2, routes=False)
    p5 = c.profiles()
    check("4.collide.deleted_local_id_not_reused", st == 200 and "a15 vless v2" in p5 and all(x["id"] != "1" for x in p5.values()), (st, p5.get("a15 vless v2", {}).get("id")))
    c.stop()


def sec5_group_and_chain_edges(base):
    """5. Группа с id 0 и front_proxy; звено цепочки, которого нет; профиль чужой группы; каталог без групп."""
    c = Core("s5").start()
    src = make_fixture(os.path.join(base, "s5-config"), front0=2, chain=(3, 77, 2), extra={
        10: {"type": "socks", "id": 10, "gid": 5, "bean": {"name": "a15 orphan", "addr": "203.0.113.60", "port": 1080, "v": 5}}})
    st, pv = c.preview(src, routes=False)
    check("5.group0.preview_ok", st == 200, (st, str(pv)[:100]))
    st, rp = c.imp(src, routes=False)
    check("5.group0.import_ok_after_ok_preview", st == 200 and reports_equal(pv, rp), (st, str(rp)[:150]))
    p, g = c.profiles(), c.groups()
    check("5.group0.front_proxy_set_on_group_zero", gid(g.get("Основная", {})) == "0" and g["Основная"].get("frontProxyId") == p.get("a15 vmess", {}).get("id"),
          (gid(g.get("Основная", {})), g.get("Основная", {}).get("frontProxyId"), p.get("a15 vmess", {}).get("id")))
    check("5.chain.missing_member_dropped_with_warning", any("member 77" in w for w in rget(rp, "warnings", [])) and p.get("a15 chain", {}).get("chain", {}).get("profileIds") == [p["a15 trojan"]["id"], p["a15 vmess"]["id"]],
          (p.get("a15 chain", {}).get("chain"), [w for w in rget(rp, "warnings", []) if "77" in w]))
    check("5.orphan.profile_goes_to_first_group_with_warning", any("group 5 missing" in w for w in rget(rp, "warnings", [])) and p.get("a15 orphan", {}).get("groupId", "0") == gid(g.get("Основная", {})),
          (p.get("a15 orphan", {}).get("groupId"), [w for w in rget(rp, "warnings", []) if "group 5" in w]))
    c.stop()
    c = Core("s5b").start()
    only = os.path.join(base, "s5-only-profiles")
    wjson(os.path.join(only, "profiles", "1.json"), {"type": "socks", "id": 1, "gid": 0, "bean": {"name": "a15 lonely", "addr": "203.0.113.70", "port": 1080, "v": 5}})
    st, rp = c.imp(only)
    g = c.groups()
    check("5.no_groups.fallback_group_imported", st == 200 and "Imported" in g and any("no groups found" in w for w in rget(rp, "warnings", [])) and rget(rp, "groupsImported") == 1,
          (st, rp.get("warnings") if st == 200 else rp, list(g)))
    c.stop()


def sec6_routes(base):
    """6. routes_box -> наборы custom:neko-<slug>; без include_routes наборов нет; битый маршрут не фатален; активация."""
    c = Core("s6").start()
    src = make_fixture(os.path.join(base, "s6-config"))
    wjson(os.path.join(src, "routes_box", "Broken"), "{not json")
    st, r0 = c.imp(src, routes=False)
    check("6.routes.off_counts_but_does_not_import", st == 200 and rget(r0, "routesFound") == 2 and rget(r0, "routesImported") == 0 and "nekoboxActiveRoute" not in r0 and not c.custom_presets(),
          {k: r0.get(k) for k in ("routesFound", "routesImported", "nekoboxActiveRoute")} if st == 200 else r0)
    st, rp = c.imp(src, routes=True)
    pre = c.custom_presets()
    check("6.routes.two_presets_with_neko_prefix", st == 200 and set(pre) == {"custom:neko-default", "custom:neko-ru-bypass-games"}, (st, sorted(pre)))
    check("6.routes.broken_route_skipped_not_fatal", st == 200 and any(slash(x["file"]) == "routes_box/Broken" and x.get("type") == "route" for x in rget(rp, "skipped", [])) and rget(rp, "routesImported") == 2,
          [(x["file"], x.get("type")) for x in rget(rp, "skipped", [])] if st == 200 else rp)
    st, gp = c.rpc(R, "GetPreset", {"id": "custom:neko-ru-bypass-games"})
    check("6.routes.preset_fields", st == 200 and gp.get("displayName") == "Neko: RU-bypass + Games" and not gp.get("builtin") and str(gp.get("revision")) == "1" and len(gp.get("directDomain", [])) == 3 and
          len(gp.get("blockDomain", [])) == 1, {k: gp.get(k) for k in ("displayName", "builtin", "revision", "directDomain", "blockDomain")} if st == 200 else gp)
    st, lp = c.rpc(R, "ListPresets")
    check("6.routes.active_preset_not_switched_by_import", st == 200 and lp.get("activePresetId") == "lav-ru", lp.get("activePresetId") if st == 200 else lp)
    st, ac = c.rpc(R, "ActivatePreset", {"id": rp.get("nekoboxActiveRoute")})
    st2, lp = c.rpc(R, "ListPresets")
    check("6.routes.activate_reported_route", st == 200 and lp.get("activePresetId") == "custom:neko-ru-bypass-games", (st, st2, lp.get("activePresetId")))
    c.stop()


def sec7_settings(base):
    """7. Таблица соответствия настроек; значения проходят валидатор SetSettings; update.* не пишется."""
    c = Core("s7").start()
    src = make_fixture(os.path.join(base, "s7-config"))
    st, _ = c.rpc(S, "SetSettings", {"values": {"update.channel": {"stringValue": "beta"}}})
    check("7.settings.update_channel_preset_to_beta", st == 200, st)
    st, rp = c.imp(src, routes=False, settings=True)
    imported = set(rget(rp, "settingsImported", []))
    warns = " | ".join(rget(rp, "warnings", []))
    check("7.settings.import_ok", st == 200 and imported, (st, str(rp)[:150]))
    check("7.settings.never_update_keys", st == 200 and not any(k.startswith("update.") for k in imported), sorted(k for k in imported if k.startswith("update.")))
    check("7.settings.check_include_pre_dropped_with_reason", "check_include_pre не переносится" in warns, warns[:200])
    st, sv = c.rpc(S, "GetSettings", {"keys": ["update.channel", "inbound.port", "sub.user_agent", "remember.enable", "remember.modes"]})
    vals = sv.get("values", {}) if st == 200 else {}
    check("7.settings.update_channel_still_beta", vals.get("update.channel", {}).get("stringValue") == "beta", vals.get("update.channel"))
    check("7.settings.values_applied", vals.get("inbound.port", {}).get("intValue") == "3090" and vals.get("sub.user_agent", {}).get("stringValue") == "a15-agent/1.0" and
          vals.get("remember.enable", {}).get("boolValue") is True, {k: vals.get(k) for k in ("inbound.port", "sub.user_agent", "remember.enable")})
    p, g = c.profiles(), c.groups()
    st, sv2 = c.rpc(S, "GetSettings", {"keys": ["remember.id", "ui.current_group"]})
    v2 = sv2.get("values", {}) if st == 200 else {}
    check("7.settings.references_become_local_ids", v2.get("remember.id", {}).get("intValue") == p.get("a15 trojan", {}).get("id") and v2.get("ui.current_group", {}).get("intValue") == gid(g.get("Подписка", {})), v2)
    table = {"inbound_address": "inbound.address", "inbound_socks_port": "inbound.port", "test_url": "test.url", "test_concurrent": "test.concurrent", "sub_use_proxy": "sub.use_proxy",
             "sub_auto_update": "sub.auto_update", "user_agent2": "sub.user_agent", "mux_protocol": "mux.protocol", "mux_concurrency": "mux.concurrency", "vpn_impl": "tun.impl",
             "vpn_mtu": "tun.mtu", "vpn_strict_route": "tun.strict_route", "vpn_ipv6": "tun.ipv6", "hk_mw": "hotkeys.main_window", "remember_id": "remember.id",
             "remember_enable": "remember.enable", "spmode2": "remember.modes", "current_group": "ui.current_group", "core_box_clash_api": "core.clash_api.enabled", "log_level": "log.level"}
    lost = [f"{n}->{k}" for n, k in table.items() if k not in imported and (f"настройка {k} не перенесена" not in warns and f"настройка {n} не перенесена" not in warns)]
    check("7.settings.every_mapped_key_imported_or_explained", not lost, lost)
    check("7.settings.invalid_theme_explained", "theme" in warns or "ui.theme" in warns, warns[:200])
    check("7.settings.unknown_keys_one_warning", "настроек NekoBox без соответствия" in warns and "another_unknown" in warns and "future_option_x" in warns, warns[:260])
    check("7.settings.not_transferable_listed", all(k in warns for k in ("conn_stat", "extraCore")), warns[:260])
    # значения вне допустимого: не пишутся, попадают в замечания
    bad = os.path.join(base, "s7-bad")
    wjson(os.path.join(bad, "profiles", "1.json"), {"type": "socks", "id": 1, "gid": 0, "bean": {"name": "a15 bad-settings", "addr": "203.0.113.80", "port": 1080, "v": 5}})
    wjson(os.path.join(bad, "groups", "nekobox.json"), {"inbound_socks_port": 3091, "vpn_mtu": 99999, "mux_protocol": "quic", "sub_use_proxy": False})
    st, rb = c.imp(bad, routes=False, settings=True)
    wb = " | ".join(rget(rb, "warnings", []))
    check("7.settings.invalid_values_rejected_valid_kept", st == 200 and set(rget(rb, "settingsImported", [])) == {"inbound.port", "sub.use_proxy"} and "tun.mtu" in wb and "mux.protocol" in wb,
          (sorted(rget(rb, "settingsImported", [])), wb[:200]) if st == 200 else rb)
    # без include_settings настройки не трогаются
    st, rn = c.imp(src, routes=False, settings=False)
    check("7.settings.off_means_none", st == 200 and not rget(rn, "settingsImported", []), rget(rn, "settingsImported", []))
    c.stop()


def sec8_limits(base):
    """8. Пределы и ссылки: 20 000 файлов, 64 МиБ, 2 МиБ на файл, символическая ссылка, не обычный файл."""
    c = Core("s8").start()
    big = make_fixture(os.path.join(base, "s8-many"))
    pdir = os.path.join(big, "profiles")
    for i in range(1000, 1000 + 20001):
        with open(os.path.join(pdir, f"{i}.json"), "w", newline="\n") as f:
            f.write("{}")
    snap = db_snapshot(c.data)
    for call in ("PreviewNekoBoxImport", "ImportNekoBox"):
        st, r = c.rpc(M, call, {"path": big})
        check(f"8.limits.too_many_files.{call}", st == 429 and isinstance(r, dict) and r.get("code") == "resource_exhausted", (st, str(r)[:100]))
    check("8.limits.too_many_files_wrote_nothing", db_snapshot(c.data) == snap, "база изменилась")
    shutil.rmtree(big, ignore_errors=True)
    heavy = make_fixture(os.path.join(base, "s8-heavy"))
    pad = "A" * (2 * 1024 * 1024 - 4096)
    for i in range(30, 30 + 34):
        wjson(os.path.join(heavy, "profiles", f"{i}.json"), {"type": "socks", "id": i, "gid": 0, "bean": {"name": f"a15 heavy {i}", "addr": "203.0.113.90", "port": 1080, "v": 5, "pad": pad}})
    st, r = c.rpc(M, "PreviewNekoBoxImport", {"path": heavy})
    check("8.limits.total_size_over_64mib", st == 429 and isinstance(r, dict) and r.get("code") == "resource_exhausted", (st, str(r)[:100]))
    shutil.rmtree(heavy, ignore_errors=True)
    # файл больше 2 МиБ пропускается, остальное переносится
    one = make_fixture(os.path.join(base, "s8-bigfile"))
    wjson(os.path.join(one, "profiles", "40.json"), {"type": "socks", "id": 40, "gid": 0, "bean": {"name": "a15 huge", "addr": "203.0.113.91", "port": 1080, "v": 5, "pad": "B" * (2 * 1024 * 1024 + 1024)}})
    st, r = c.imp(one, routes=False)
    sk = {slash(x["file"]): x.get("reason", "") for x in rget(r, "skipped", [])}
    check("8.limits.file_over_2mib_skipped_rest_imported", st == 200 and "profiles/40.json" in sk and "larger" in sk["profiles/40.json"] and sum(nonzero_types(r).values()) == 7 and "a15 huge" not in c.profiles(),
          (st, sk.get("profiles/40.json"), nonzero_types(r)))
    # не обычный файл: каталог с именем 50.json
    odd = make_fixture(os.path.join(base, "s8-special"))
    os.makedirs(os.path.join(odd, "profiles", "50.json"))
    st, r = c.imp(odd, routes=False)
    sk = {slash(x["file"]): x.get("reason", "") for x in rget(r, "skipped", [])}
    check("8.special.directory_named_json_skipped", st == 200 and "profiles/50.json" in sk and "not a regular file" in sk["profiles/50.json"], (st, sk.get("profiles/50.json")))
    # символическая ссылка не читается
    sl = make_fixture(os.path.join(base, "s8-symlink"))
    outside = os.path.join(base, "s8-outside.json")
    wjson(outside, {"type": "socks", "id": 60, "gid": 0, "bean": {"name": "a15 outside secret", "addr": "203.0.113.92", "port": 1080, "v": 5}})
    outside_set = os.path.join(base, "s8-outside-settings.json")
    wjson(outside_set, {"inbound_socks_port": 3999})
    try:
        os.symlink(outside, os.path.join(sl, "profiles", "60.json"))
        os.remove(os.path.join(sl, "groups", "nekobox.json"))
        os.symlink(outside_set, os.path.join(sl, "groups", "nekobox.json"))
        linked = True
    except OSError as e:
        linked = False
        check("8.symlink.can_create_links", False, f"символическую ссылку создать нельзя ({e}); проверка пропущена", warn=True)
    if linked:
        st, r = c.imp(sl, routes=False, settings=True)
        sk = {slash(x["file"]): x.get("reason", "") for x in rget(r, "skipped", [])}
        check("8.symlink.profile_link_not_followed", st == 200 and "profiles/60.json" in sk and "symlink" in sk["profiles/60.json"] and "a15 outside secret" not in c.profiles(), (st, sk.get("profiles/60.json")))
        check("8.symlink.settings_link_not_followed", st == 200 and "groups/nekobox.json" in sk and not rget(r, "settingsImported", []), (st, sk.get("groups/nekobox.json"), rget(r, "settingsImported", [])))
    c.stop()


def sec9_concurrent(base):
    """9. Параллельный перенос: лишние получают ABORTED (409), в базе ни дублей, ни половинчатого состояния."""
    c = Core("s9").start()
    src = make_fixture(os.path.join(base, "s9-config"))
    for n_junk in (6000, 12000, 19000):
        for i in range(2000, 2000 + n_junk):
            p = os.path.join(src, "profiles", f"{i}.json")
            if not os.path.exists(p):
                with open(p, "w", newline="\n") as f:
                    f.write("{}")
        res = [None] * 6

        def worker(k):
            try:
                res[k] = c.imp(src, routes=True)[0]
            except Exception as e:  # noqa: BLE001
                res[k] = str(e)[:60]

        ts = [threading.Thread(target=worker, args=(k,)) for k in range(6)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        if 409 in res:
            break
    check("9.concurrent.every_answer_is_200_or_aborted", 200 in res and set(res) <= {200, 409}, res)
    check("9.concurrent.some_import_aborted", 409 in res, f"ABORTED не получен при {n_junk} файлах (быстрый диск); см. Go-тест TestConcurrentImportAborted", warn=True)
    p = c.profiles()
    check("9.concurrent.no_duplicates", len(p) == 7 and len(c.custom_presets()) == 2, (len(p), sorted(c.custom_presets())))
    conn = sqlite3.connect("file:" + c.dbfile().replace(os.sep, "/") + "?mode=ro", uri=True)
    try:
        rows = conn.execute("SELECT kind, COUNT(*) FROM import_map WHERE source='nekobox' GROUP BY kind").fetchall()
        fk = conn.execute("PRAGMA foreign_key_check").fetchall()
    finally:
        conn.close()
    check("9.concurrent.import_map_consistent", dict(rows) == {"group": 2, "profile": 7, "preset": 2} and not fk, (rows, fk))
    c.stop()


def sec10_agent(base):
    """10. Агентский токен не получает доступа к MigrationService ни в режиме read, ни в control."""
    c = Core("s10").start()
    src = make_fixture(os.path.join(base, "s10-config"))
    snap = None
    for mode in ("read", "control"):
        st, _ = c.rpc(S, "SetSettings", {"values": {"agent.mode": {"stringValue": mode}}})
        if snap is None:
            snap = db_snapshot(c.data)
        for call, body in (("DetectNekoBox", {}), ("PreviewNekoBoxImport", {"path": src}), ("ImportNekoBox", {"path": src, "includeRoutes": True})):
            st, r = c.rpc(M, call, body, token=c.agent)
            check(f"10.agent.{mode}.{call}.denied", st == 403 and isinstance(r, dict) and r.get("code") == "permission_denied", (st, str(r)[:100]))
    now = db_snapshot(c.data)
    check("10.agent.denied_calls_wrote_nothing", all(now[k] == snap[k] for k in ("groups", "profiles", "import_map", "meta.presets")) and not c.profiles(), "база изменилась")
    st, r = c.rpc(M, "DetectNekoBox", {})
    check("10.agent.main_token_still_allowed", st == 200, (st, str(r)[:80]))
    c.stop()


def run_cli(args, cwd=None):
    p = subprocess.run([EXE, "import-nekobox", *args], capture_output=True, cwd=cwd, timeout=180)
    return p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")


def snake_equal(cli, api):
    """Отчёт CLI (snake_case, нулевые значения есть) совпадает с отчётом API (camelCase, нулевые опущены)."""
    key = {"groups_imported": "groupsImported", "profiles_by_type": "profilesByType", "already_present": "alreadyPresent", "renumbered": "renumbered", "routes_found": "routesFound",
           "routes_imported": "routesImported", "settings_imported": "settingsImported", "nekobox_active_route": "nekoboxActiveRoute"}
    for k, ak in key.items():
        a, b = cli.get(k), api.get(ak)
        if a in (None, 0, "", [], {}) and b in (None, 0, "", [], {}):
            continue
        if k == "profiles_by_type":
            a, b = {x: y for x, y in (a or {}).items() if y}, {x: y for x, y in (b or {}).items() if y}
        if a != b:
            return False
    return True


def sec11_cli(base):
    """11. lavray-core import-nekobox: коды выхода, сухой прогон не меняет базу побайтно, отчёт равен отчёту API."""
    root = os.path.join(OUT, "s11")
    shutil.rmtree(root, ignore_errors=True)
    data = os.path.join(root, "data")
    src = make_fixture(os.path.join(base, "s11-config"))
    src_before = snap_dir(src)
    rc, out, err = run_cli([])
    check("11.cli.no_from_exit_2", rc == 2 and "--from" in err, (rc, err[:100]))
    rc, out, err = run_cli(["--data", data, "--from", src, "--no-such-flag"])
    check("11.cli.bad_flag_exit_2", rc == 2, rc)
    rc, out, err = run_cli(["--data", data, "--from", os.path.join(base, "s11-missing"), "--dry-run"])
    check("11.cli.missing_dir_exit_1_message", rc == 1 and err.strip() != "", (rc, err[:120]))
    plain = os.path.join(base, "s11-plain")
    os.makedirs(plain, exist_ok=True)
    rc, out, err = run_cli(["--data", data, "--from", plain, "--dry-run"])
    check("11.cli.not_a_neko_dir_exit_1", rc == 1 and "groups" in err, (rc, err[:120]))
    failed_data = os.path.join(root, "failed-data")
    rc, out, err = run_cli(["--data", failed_data, "--from", plain])
    check("11.cli.failed_real_run_exit_1", rc == 1, rc)
    check("11.cli.failed_real_run_creates_no_database", not os.path.exists(os.path.join(failed_data, "lavray.db")), "неудачный перенос создал пустую базу в --data", warn=True)
    # сухой прогон при несуществующем каталоге данных не создаёт ничего
    rc, out, err = run_cli(["--data", data, "--from", src, "--dry-run"])
    rep = json.loads(out) if rc == 0 and out.strip() else {}
    check("11.cli.dry_run_without_database_exit_0", rc == 0 and rep.get("dry_run") is True and rep.get("groups_imported") == 2 and not os.path.exists(os.path.join(data, "lavray.db")), (rc, err[:100], rep.get("dry_run")))
    check("11.cli.dry_run_creates_no_data_dir_files", not os.path.isdir(data) or not os.listdir(data), os.listdir(data) if os.path.isdir(data) else None)
    # настоящая база с локальными данными: ядро создаёт её и останавливается
    c = Core("s11core")
    c.data = data
    os.makedirs(data, exist_ok=True)
    c.start()
    c.seed(2)
    c.stop()
    time.sleep(0.5)
    files_before = {f: (os.path.getsize(os.path.join(data, f)), file_hash(os.path.join(data, f))) for f in sorted(os.listdir(data)) if os.path.isfile(os.path.join(data, f))}
    rc, out, err = run_cli(["--data", data, "--from", src, "--dry-run"])
    dry = json.loads(out) if rc == 0 and out.strip() else {}
    files_after = {f: (os.path.getsize(os.path.join(data, f)), file_hash(os.path.join(data, f))) for f in sorted(os.listdir(data)) if os.path.isfile(os.path.join(data, f))}
    check("11.cli.dry_run_exit_0_with_report", rc == 0 and dry.get("dry_run") is True and dry.get("groups_imported") == 2 and sum((dry.get("profiles_by_type") or {}).values()) == 7, (rc, err[:120], dry))
    check("11.cli.dry_run_leaves_database_files_byte_identical", files_before == files_after and "lavray.db" in files_before, {f: (files_before.get(f), files_after.get(f)) for f in set(files_before) | set(files_after) if files_before.get(f) != files_after.get(f)})
    # настоящий перенос из CLI, относительный --from
    rc, out, err = run_cli(["--data", data, "--from", os.path.basename(src)], cwd=os.path.dirname(src))
    real = json.loads(out) if rc == 0 and out.strip() else {}
    check("11.cli.real_import_exit_0_relative_from", rc == 0 and not real.get("dry_run") and real.get("groups_imported") == 2 and real.get("routes_imported") == 2 and real.get("settings_imported"), (rc, err[:120], real.get("groups_imported")))
    dry_cmp, real_cmp = dict(dry), dict(real)
    dry_cmp.pop("dry_run", None)
    real_cmp.pop("dry_run", None)
    check("11.cli.dry_run_report_equals_real_report", bool(real) and dry_cmp == real_cmp, "отчёты сухого прогона и переноса различаются")
    c2 = Core("s11core2")
    c2.data = data
    c2.start()
    p = c2.profiles()
    check("11.cli.imported_data_visible_to_core", {"a15-local-1", "a15-local-2", "a15 vless", "a15 chain"} <= set(p) and len(p) == 9 and len(c2.custom_presets()) == 2, (len(p), sorted(c2.custom_presets())))
    c2.stop()
    ca = Core("s11api").start()
    ca.seed(2)
    st, api_rep = ca.imp(src, routes=True, settings=True)
    check("11.cli.report_equals_api_report", st == 200 and snake_equal(real, api_rep), (st, {k: api_rep.get(k) for k in ("groupsImported", "profilesByType", "routesImported")}))
    ca.stop()
    snap = db_snapshot(data)
    rc, out, err = run_cli(["--data", data, "--from", src, "--no-settings"])
    again = json.loads(out) if rc == 0 and out.strip() else {}
    check("11.cli.second_run_idempotent", rc == 0 and again.get("groups_imported") == 0 and again.get("already_present") == 11 and sum((again.get("profiles_by_type") or {}).values()) == 0 and db_snapshot(data) == snap,
          (rc, again.get("already_present"), again.get("groups_imported")))
    rc, out, err = run_cli(["--data", data, "--from", src, "--no-routes", "--no-settings", "--dry-run"])
    nr = json.loads(out) if rc == 0 and out.strip() else {}
    check("11.cli.no_routes_no_settings_flags", rc == 0 and nr.get("routes_imported") == 0 and not nr.get("settings_imported") and nr.get("routes_found") == 2, (rc, nr.get("routes_imported"), nr.get("settings_imported")))
    check("11.cli.source_dir_unchanged", snap_dir(src) == src_before, "каталог NekoBox изменился")


def main():
    base = os.path.join(OUT, "src")
    shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base)
    try:
        for fn in (sec1_detect, sec2_paths, sec3_import, sec4_collisions, sec5_group_and_chain_edges, sec6_routes, sec7_settings, sec8_limits, sec9_concurrent, sec10_agent, sec11_cli):
            try:
                fn(base)
            except Exception as e:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                check(f"{fn.__name__}.no_exception", False, repr(e))
    finally:
        pass
    failed = [r for r in RESULTS if not r["pass"] and not r["warn"]]
    warns = [r for r in RESULTS if r["warn"]]
    with open(os.path.join(OUT, "a15-result.json"), "w", encoding="utf-8") as f:
        json.dump({"total": len(RESULTS), "failed": len(failed), "warnings": len(warns), "checks": RESULTS}, f, ensure_ascii=False, indent=1)
    print(f"A15: проверок {len(RESULTS)}, провалов {len(failed)}, наблюдений WARN {len(warns)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```
