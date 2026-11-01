# A09. Сценарии API ядра по Connect JSON (все влитые сервисы)

| Поле | Значение |
|---|---|
| ID | A09 |
| Слой | авто |
| Время | 6–8 минут |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–7. Ядро с настоящим sing-box берётся из ZIP релиза `<TAG>` (A06, шаг 7) или собирается в A03. Выполняется в группе P |
| Опасность | нет: ядро и тестовые серверы слушают loopback (и один тестовый HTTP-сервер на адресе основного сетевого интерфейса), системный прокси, TUN, реестр не затрагиваются |

`<TAG>` в этом документе — тег выпуска под тестом; по умолчанию `v0.9.0` (единый итоговый тег плана доработки). В `env.ps1` это переменная `LAVRAY_REF`.

## Цель

Пройти по Connect JSON (`POST /lavray.v1.<Сервис>/<Метод>`, заголовок `Authorization: Bearer <токен ядра>`) сценарии каждого влитого сервиса и сверить **точные коды ошибок** с таблицами плана доработки. Покрывает: профили и группы (CRUD, метаданные, фильтры, клонирование, перенос), подтверждение custom-полей по хэшу (T-08B), соединения, статистику и сводку по группе (T-79), наборы маршрутов (T-80: создание из источника и из значений, обновление с ревизией, удаление, сброс копии, экспорт, импорт, маршрут NekoRay, лимит 100, конфликт ревизий → `ABORTED`), резервную копию (T-83), все RPC хвостов A (очистка недоступных, дубликаты, разрешение доменов с `failed`, экспорт конфига, сброс настроек, подписка на настройки, запоминание профиля, таблица читателей настроек), CORS отказы для агентского токена и `MigrationService` (T-78: малый набор, полные сценарии - файл A15).

Раздел `MigrationService` (T-78) - раздел 7 скрипта. Раздел `UpdateService` (T-75) в этой версии файла отсутствует, он ждёт слияния: см. конец документа.

## Предусловия

- Python 3.12; ядро собрано с тегами `core/BUILD_TAGS` (нужен настоящий sing-box для раздела 2); Git для чтения `presets/lav-ru.source.json` (образец маршрута NekoRay).
- На ПК есть адрес сетевого интерфейса вне loopback (ядро не считает соединения с `127.0.0.1`). Нет адреса: раздел 2 получает `BLOCKED`.
- Переменные: `LAVRAY_SRC` (клон продукта, из `env.ps1`).
- Свободны произвольные порты loopback; порт 2080 скрипт не использует.

## Безопасность

Скрипт запускает ядро на отдельном каталоге данных (`C:\lavray-test\tmp\A09\data`), ставит порт входящего подключения на свободный, поднимает локальный SOCKS5-апстрим и HTTP-сервер, подключается и отключается. **Системный прокси ставит окно LAVRay, а не ядро**: окно не запускается. Раздел 4 заменяет данные ядра из копии — только в собственном каталоге. Раздел `Часть 6` запускает второе ядро на том же каталоге с флагом `--headless`.

## Шаги

1. Каталоги и ядро.

   ```powershell
   . C:\lavray-test\env.ps1
   $t = 'C:\lavray-test\tmp\A09'
   New-Item -ItemType Directory -Force -Path $t, C:\lavray-test\results\A09 | Out-Null
   $exe = if (Test-Path $env:LAVRAY_CORE_EXE) { $env:LAVRAY_CORE_EXE } else { 'C:\lavray-test\tmp\A03\lavray-core.exe' }
   Test-Path $exe
   $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
   "адрес интерфейса: $ip"
   ```

   Ожидается: `True` и непустой адрес.

2. Сохраните скрипт из раздела «Скрипт `a09_api.py`» как `C:\lavray-test\tmp\A09\a09_api.py` и запустите:

   ```powershell
   $env:LAVRAY_SRC = $env:LAVRAY_SRC   # скрипт читает presets\lav-ru.source.json из клона
   python -I "$t\a09_api.py" $exe "$t\run" 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A09\run.txt | Select-Object -Last 12
   "a09 exit=$LASTEXITCODE"
   $res = Get-Content "$t\run\a09-result.json" -Raw | ConvertFrom-Json
   "проверок: $($res.total), провалов: $($res.failed), наблюдений: $($res.warnings)"
   $res.checks | Where-Object { -not $_.pass } | Select-Object id, warn, detail | Format-Table -AutoSize -Wrap
   ```

   Ожидается: `a09 exit=0`, `провалов: 0`, список непройденных содержит только записи с `warn = True`. Эталон на `main` `9b26be6` (T-80, T-83, хвосты A, T-76, T-78): 181 проверка, из них 3 `FAIL` очистки (шаг 4) и 1 `WARN`. Каждая проверка в `run.txt` — строка `PASS <id>` / `WARN <id>` / `FAIL <id> :: <подробности>`.

3. Что и по каким кодам проверяет каждый раздел (для отчёта и поиска причины):

   | Раздел | Проверки | Коды и значения |
   |---|---|---|
   | 1. Профили и группы | `GetProfile` существующий/неизвестный; `CreateProfile`; пустой адрес; `UpdateProfile` (переименование); `SetProfileMeta`; `ListProfiles` с `favoritesOnly`, `tagsAnyOf`, `search`; `CloneProfiles`; `MoveProfiles`; `DeleteProfile`; группы | неизвестный профиль `404 not_found`; пустой адрес `400 invalid_argument`; перенос в неизвестную группу `404`/`400` |
   | 1. Custom-поля (T-08B) | `PreviewCustomFields` без полей; клиентский флаг `customFieldsConfirmed: true` игнорируется; хэш из 64 hex, diff и ключи; `ConfirmCustomFields`: плохой хэш, устаревший, неизвестный профиль, верный; переименование и тот же JSON подтверждение сохраняют, правка снимает; JSON не объект, дубли ключей, больше 256 КиБ | `400 failed_precondition` (нет полей, устаревший хэш), `400 invalid_argument` (формат хэша, JSON), `404 not_found` |
   | 2. Соединения и трафик (T-79) | `ListConnections` без инстанса пуст (не ошибка); после трёх загрузок по 20 000 байт список содержит соединение (`downloadBytes ≥ 20000`, `network = tcp`); фильтры `destinationFilter`/`outboundFilter`; `CloseConnection`; `WatchConnections` и `StatsService/Subscribe` отдают кадры; `GetTrafficTotals`; `Disconnect` возвращает `finalStats`; `GetTrafficSummary` по группе | `CloseConnection`: не UUID и пусто `400`, неизвестный UUID `404`; отрицательный интервал `400`; `GetTrafficSummary`: отрицательный `sinceMs` `400`, неизвестная группа `404` |
   | 2. Адреса назначения в журнале | (а) собственные сообщения LAVRay (все источники, кроме `singbox`) не содержат адрес назначения и порт тестового сервера; журнал в виде агента (`GetTail` агентским токеном) тоже; сводка и итоги трафика не содержат адресов. (б) строки sing-box `inbound connection to <адрес>` при `log.level = info` (по умолчанию) ожидаемы, как в NekoBox (`WARN`, если их нет); после `SetSettings log.level = warn` и переподключения таких строк нет | (а) `FAIL`, если адрес найден; (б) `FAIL`, если после `warn` строки остались |
   | 3. Наборы маршрутов (T-80) | в списке пять встроенных (`lav-ru`, `lav-cn`, `global`, `all-proxy`, `all-direct`), активный `global`; создание из источника (`custom:<slug>`, ревизия 1, `builtinSourceId`); из значений с кириллическим названием; `UpdatePreset`: ревизия +1; параллельные обновления с одной ревизией: ровно одно `409 aborted`; активация; удаление активного → `newActiveId = global`; сброс копии к источнику; экспорт и повторный импорт; импорт никогда не занимает id встроенного; маршрут NekoRay (`presets/lav-ru.source.json`) создаёт набор с предупреждениями; лимит 100 | `CreatePreset`: ни источник ни значения / оба — `400 invalid_argument`; неизвестный источник `404`; неверное значение `400`; 101-й набор `429 resource_exhausted`. `UpdatePreset`: встроенный `400 failed_precondition`; неизвестный `404`; устаревшая ревизия `409 aborted`. `DeletePreset`: встроенный `400 failed_precondition`; неизвестный `404`. `ResetBuiltinPreset`: id встроенного и копия без источника `400 failed_precondition`; неизвестный `404`. `ImportPreset`: мусор, пусто, массив `400 invalid_argument`; больше 1 МиБ `429 resource_exhausted`. `ImportNekoRayRoute`: пусто, `null`, `[]`, `{oops` `400 invalid_argument`. Агент: `403` |
   | 4. Резервная копия (T-83) | пароль пустой, 7 символов, 1025 байт → отказ; экспорт: заголовок `LAVBK1`, имя `lavray-backup-….lavbk`, сводка; в файле нет секретов и заголовка SQLite; `PreviewBackup`: сводка равна экспорту, неверный пароль, порча середины, порча заголовка, обрезка, мусор; `ImportBackup`: без `confirmReplace`, при подключении, успешный; профиль с секретом и настройка возвращены; подписчики настроек уведомлены; пароль не попал ни в журнал, ни в настройки; агент; лимит 64 МиБ выше общего 16 МиБ | пароль `400 invalid_argument`; неверный пароль `403 permission_denied`; порча тела `500 data_loss`; не файл копии `400 invalid_argument` с причиной `backup_not_recognized`; без подтверждения и при подключении `400 failed_precondition`; агент `403` |
   | 5. Хвосты A | `RemoveUnavailableProfiles` (пробный прогон, применение, неизвестная группа); `DeduplicateProfiles` (первый остаётся, имя не учитывается, идемпотентность); `ResolveDomains` (`localhost` → IP, несуществующее имя → `failed` с причиной, IP пропущен; пустой список и больше 1000 id); `ExportConfig` (RUN содержит секрет без маскирования, TEST без `inbounds`, внешнее ядро); `ResetSettings` (ключ → умолчание, остальные целы, неизвестный, служебный `sub.hwid_id`, `update.channel`); `SubscribeSettings` (изменение и `removed`, медленный подписчик не блокирует запись); запоминание профиля; CORS | неизвестная группа `404`; пустой/длинный список доменов `400 invalid_argument`; внешнее ядро `400 failed_precondition`; неизвестный и служебный ключи `400 invalid_argument`; агент `403` |
   | 6. Сервисный режим | запомненный профиль подключается вторым ядром с `--headless` только при `remember.enable = true` | в течение 30 с `CORE_STATE_CONNECTED` |
   | 7. MigrationService (T-78) | `DetectNekoBox` с переданным путём: первым идёт кандидат `manual` с числами по именам файлов (1 группа, 3 профиля, 1 маршрут); пути `""`, относительный, файл, каталог без `groups`/`profiles` → `400 invalid_argument`, несуществующий → `404 not_found` (и в `Preview`, и в `Import`); `Preview`: `dryRun`, 1 группа, 2 профиля, 1 маршрут, 1 пропуск (битый файл), база и наборы не изменились; `Import` равен предпросмотру, цепочка указывает на перенесённый профиль, маршрут стал `custom:neko-a09-route`; повтор: `alreadyPresent = 4`, ничего нового; агентский токен в режимах `read` и `control` на все три метода | `403 permission_denied`; остальное см. выше |

4. Известные расхождения и наблюдения на `main` `9b26be6` (так же на `feat/tails-a`, `775a49b`; сверьте с вашим `<TAG>`; если расхождение исчезло, это улучшение):

   - **Очистка недоступных не видит неудачных проверок.** `RemoveUnavailableProfiles` считает недоступным профиль с `latency_ms < 0`, а `TestLatency` при неудаче записывает только `lastError` (задержка остаётся пустой), поэтому после проверки доступности «мёртвого» сервера пробный прогон возвращает пустой список. Проверки `5.cleanup.dry_run_lists_only_failed`, `5.cleanup.apply_removes_only_failed_untested_kept`, `5.cleanup.remaining_two` на этой сборке дают `FAIL` (серьёзность `major`: живая проверка Ф5 п. 4 «Очистка «Недоступные»» невыполнима). Юнит-тесты очистки проходят, потому что пишут отрицательную задержку напрямую в хранилище.
   - **`CreateProfile` принимает порт 0** (`WARN 1.create.port0.invalid_argument`, серьёзность `minor`): профиль создаётся и не подключится.
   - Нормализация Unicode в пароле копии (NFC/NFD) выполняется интерфейсом (`lib/password.ts`), а не ядром; это проверяет A14 (`WARN`).

5. Проверки, которые выполняет `go test ./...` (A02) на том же коде и которые не дублируются скриптом, но входят в критерии файла:

   ```powershell
   Set-Location (Join-Path $env:LAVRAY_SRC 'core')
   go test -count=1 -v -run '^(TestEverySettingHasReader)$' ./internal/model/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   go test -count=1 -v -run '^(TestEveryProcedureHasAgentDecision|TestUnimplementedRatchet)$' ./internal/api/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
   Set-Location C:\lavray-test
   ```

   Ожидается: три строки `--- PASS` (у каждого ключа настроек есть читатель; у каждой процедуры есть решение для агента; список `allowUnimplemented` не вырос). На `main` `9b26be6` в этом списке остаются `UpdateService/ApplyUpdates` (T-75, ещё не влит) и девять процедур `WebSessionService` (постоянная запись: без `--web-bind` сервис не реализован, см. A12). Появление в списке любой другой процедуры — `FAIL`.

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Шаг 2: `a09 exit=0`, провалов 0 | вывод |
| К2 | Все коды ошибок раздела 3 совпали с таблицей (проверки `*.invalid_argument`, `*.not_found`, `*.failed_precondition`, `*.aborted`, `*.resource_exhausted`, `*.permission_denied`, `*.data_loss`) | `a09-result.json` |
| К3 | Адреса назначения не встречаются в собственных сообщениях LAVRay, в журнале агента и в сводке (`2.log.own_messages_have_no_destinations`, `2.log.agent_view_has_no_destinations`, `2.summary.has_no_destinations`) | `PASS` |
| К4 | После `log.level = warn` и переподключения строк sing-box о соединениях нет (`2.log.level_warn.no_inbound_connection_lines`) | `PASS` |
| К5 | Резервная копия не содержит секретов в открытом виде и отвергает неверный пароль и порчу (`4.export.no_plaintext_secrets`, `4.preview.wrong_password…`, `4.preview.tampered_body…`) | `PASS` |
| К6 | Агентский токен не получает доступа к RPC наборов, копии, экспорта конфига, сброса и подписки на настройки (`*.agent.denied`, `*.agent_denied`) | `PASS` |
| К7 | Шаг 5: три защитных теста `--- PASS` | вывод |
| К8 | `MigrationService`: коды путей, предпросмотр равен переносу, повтор без дублей, агент отказан (`7.*`, раздел 7) | `PASS` |

`WARN` не меняет итог файла, но попадает в «Дефекты». Отсутствие адреса интерфейса — `BLOCKED` для раздела 2.

## MigrationService (T-78): таблица RPC и ошибок

Сервис `MigrationService` переносит каталог `config` NekoBox (`groups/`, `profiles/`, `routes_box/`, `groups/nekobox.json`) в LAVRay. Источник только читается; NekoBox не запускается и не останавливается. Агентам закрыт весь сервис. Малый набор (раздел 7 скрипта) проверяет форму ответов и коды ниже; все остальные сценарии (коллизии id, группа с id 0, пределы, символические ссылки, параллельный перенос, настройки, подкоманда `import-nekobox`) выполняет файл `A15-nekobox-import.md`, а экран - `M10-nekobox-migration.md`.

| RPC | Запрос | Ответ | Коды ошибок |
|---|---|---|---|
| `DetectNekoBox` | `extraPaths` - абсолютные пути (относительные и несуществующие игнорируются) | `candidates[]`: `path`, `source` (`manual`, `process`, `appdata`, `localappdata`), `groups`, `profiles`, `routes` (по именам файлов), `looksRunning` | `permission_denied` для агента; пустой список - не ошибка |
| `PreviewNekoBoxImport` | `path`, `includeRoutes`, `includeSettings` | `NekoBoxReport` с `dryRun = true`; те же числа, что даст перенос | `invalid_argument` (путь пуст, не абсолютный, не каталог, нет ни `groups`, ни `profiles`), `not_found` (пути нет), `resource_exhausted` (больше 20 000 файлов или больше 64 МиБ суммарно; файл больше 2 МиБ - не ошибка, он попадает в `skipped`), `aborted` (идёт другой перенос) |
| `ImportNekoBox` | те же | `NekoBoxReport` без `dryRun` | те же, плюс `aborted` при гонке с записью в базу |

Поля отчёта: `groupsImported`, `profilesByType`, `alreadyPresent`, `skipped[]` (`file`, `id`, `type`, `reason`), `warnings[]`, `routesFound`, `routesImported`, `renumbered`, `settingsImported[]`, `dryRun`, `nekoboxActiveRoute`. Каталог установки с вложенным `config` принимается.

## TODO: допишется после слияния T-75 (UpdateService)

Раздел появится вместе с файлами A13 и M12, когда в `main` будет влит центр обновлений. Планируемое содержимое:

- `CheckUpdates` без корня доверия → `not_configured`; с тестовым корнем и локальным статическим сервером → доступность версии, `minUpgradeFrom`;
- `DownloadUpdates` → события `verified{staged_path, sha256}`; подмена артефакта, откат serial, просроченный timestamp → отказ;
- `ApplyUpdates`, `Rollback` (для приложения: `FAILED_PRECONDITION «откат выполняет оболочка»`), `GetUpdateState`, `VerifyLocalUpdate` (только внутри staging);
- коды ошибок по таблице RPC плана (раздел 4), отказ для агента.

## Что собрать

`results\A09\run.txt`, `a09-result.json` (копия), список `WARN` и `FAIL` с подробностями, версия ядра из `status.initial`. Файл `data\` каталога теста не копировать (в нём тестовые секреты).

## Откат / уборка

```powershell
Get-Process lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\lavray-test\*' } | Stop-Process -Force
Remove-Item -Recurse -Force C:\lavray-test\tmp\A09
Test-Path C:\lavray-test\tmp\A09
```

Ожидается `False`. Системного отката нет.

## Отчёт

`results/A09.md` по `templates/REPORT.md`: статусы шагов 1–5, К1–К7, число проверок, список `WARN`. Провал К3 или К4 (адреса назначения в сообщениях LAVRay, строки sing-box при `warn`) — `major`; К5 и К6 — `critical`; остальные коды — `major`/`minor`.

## Скрипт `a09_api.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A09: сценарии API ядра по Connect JSON на loopback: профили, custom-поля, соединения и трафик,
наборы маршрутов, резервная копия, хвосты A (очистка, домены, экспорт конфига, сброс и подписка на настройки,
запоминание профиля), CORS, MigrationService (T-78, малый набор; полный - A15).

Запуск: python -I a09_api.py <lavray-core.exe> <каталог результатов>
Код выхода: 0 - все проверки PASS, 1 - есть FAIL. Итог: <каталог>/a09-result.json.
Ядро обязано быть собрано с тегами из core/BUILD_TAGS (нужен настоящий sing-box для раздела 2).
"""
import base64
import http.server
import json
import os
import secrets
import select
import shutil
import socket
import socketserver
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

sys.stdout.reconfigure(encoding="utf-8")
EXE, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(OUT, exist_ok=True)
RESULTS = []
CRLF = chr(13) + chr(10)


def check(cid, ok, detail="", warn=False):
    RESULTS.append({"id": cid, "pass": bool(ok), "warn": bool(warn and not ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else ("WARN " if warn else "FAIL ")) + cid + ("" if ok else " :: " + str(detail)[:220]), flush=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


class Socks5(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Socks5Handler(socketserver.BaseRequestHandler):
    def handle(self):
        c = self.request
        try:
            n = c.recv(2)[1]
            c.recv(n)
            c.sendall(b"\x05\x00")
            _, _, _, atyp = c.recv(4)
            host = socket.inet_ntoa(c.recv(4)) if atyp == 1 else (c.recv(c.recv(1)[0]).decode() if atyp == 3 else socket.inet_ntop(socket.AF_INET6, c.recv(16)))
            port = int.from_bytes(c.recv(2), "big")
            up = socket.create_connection((host, port), timeout=15)
            c.sendall(b"\x05\x00\x00\x01" + bytes(4) + bytes(2))
            socks = [c, up]
            while True:
                r, _, _ = select.select(socks, [], [], 10)
                if not r:
                    return
                for s in r:
                    d = s.recv(65536)
                    if not d:
                        return
                    (up if s is c else c).sendall(d)
        except Exception:  # noqa: BLE001
            pass
        finally:
            c.close()


class Origin(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"x" * 20000
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class Core:
    def __init__(self, data, extra=()):
        self.tok, self.agent = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        self.p = subprocess.Popen([EXE, "serve", "--listen-socket", "127.0.0.1:0", "--data", data, *extra], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, "core-stderr.log"), "ab"))
        self.p.stdin.write((self.tok + "\n" + self.agent + "\n").encode())
        self.p.stdin.flush()
        self.base = "http://" + self.p.stdout.readline().decode().split()[1].replace("tcp://", "")

    def rpc(self, svc, method, body=None, token=None, headers=None):
        h = {"Authorization": "Bearer " + (token or self.tok), "Content-Type": "application/json"}
        h.update(headers or {})
        req = urllib.request.Request(f"{self.base}/lavray.v1.{svc}/{method}", data=json.dumps(body or {}).encode(), headers=h)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw

    def stream(self, svc, method, body=None, seconds=3.0, action=None):
        """Server-stream по connect+json: читает кадры seconds секунд; action() вызывается после подписки."""
        raw = json.dumps(body or {}).encode()
        env = b"\x00" + struct.pack(">I", len(raw)) + raw
        req = urllib.request.Request(f"{self.base}/lavray.v1.{svc}/{method}", data=env, headers={
            "Authorization": "Bearer " + self.tok, "Content-Type": "application/connect+json", "Connect-Protocol-Version": "1"})
        frames, end = [], {}
        try:
            r = urllib.request.urlopen(req, timeout=seconds + 10)
        except urllib.error.HTTPError as e:
            return [], {"http": e.code}
        t_end = time.time() + seconds
        if action:
            threading.Timer(0.5, action).start()
        r.fp.raw._sock.settimeout(0.5)  # noqa: SLF001 - короткие чтения, чтобы не зависнуть на пустом потоке
        while time.time() < t_end:
            try:
                head = r.read(5)
            except (socket.timeout, TimeoutError, OSError):
                continue
            if len(head) < 5:
                break
            flags, n = head[0], struct.unpack(">I", head[1:])[0]
            body_bytes = r.read(n)
            msg = json.loads(body_bytes) if body_bytes else {}
            if flags & 2:
                end = msg
                break
            frames.append(msg)
        r.close()
        return frames, end

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=20)
        except Exception:  # noqa: BLE001
            self.p.kill()


def code(r):
    return r[1].get("code") if isinstance(r[1], dict) else None


def mixed_fetch(port, url, times=3):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": f"http://127.0.0.1:{port}"}))
    total = 0
    for _ in range(times):
        with opener.open(url, timeout=20) as r:
            total += len(r.read())
    return total


def socks_profile(name, port, **extra):
    p = {"groupId": GID[0], "type": "PROFILE_TYPE_SOCKS", "name": name, "address": "127.0.0.1", "port": port,
         "socksHttp": {"proto": "PROTO_SOCKS5"}}
    p.update(extra)
    return {"profile": p}


GID = [None]



def sec1_profiles(c, X):
    """1. Профили и группы: CRUD, метаданные, фильтры, клон, перенос, custom-поля с хэшем."""
    st, r = c.rpc("ProfileService", "GetProfile", {"id": X["pidA"]})
    check("1.get.ok", st == 200 and r["name"] == "a09-A", (st, r))
    st, r = c.rpc("ProfileService", "GetProfile", {"id": "999999"})
    check("1.get.unknown.not_found", st == 404 and code((st, r)) == "not_found", (st, r))
    st, r = c.rpc("ProfileService", "CreateProfile", socks_profile("a09-created", free_port()))
    created = r.get("id") if st == 200 else None
    check("1.create.ok", st == 200 and r.get("name") == "a09-created" and created, (st, r))
    bad = socks_profile("a09-bad", 0)
    st, r = c.rpc("ProfileService", "CreateProfile", bad)
    check("1.create.port0.invalid_argument", st == 400 and code((st, r)) == "invalid_argument", "порт 0 принят: профиль, который не подключится", warn=True)
    if st == 200:
        c.rpc("ProfileService", "DeleteProfile", {"ids": [r["id"]]})
    st, r = c.rpc("ProfileService", "CreateProfile", {"profile": {"groupId": GID[0], "type": "PROFILE_TYPE_SOCKS", "name": "", "address": "", "port": 1}})
    check("1.create.empty_address.invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, r))
    st, cur = c.rpc("ProfileService", "GetProfile", {"id": created})
    cur["name"] = "a09-renamed"
    st, r = c.rpc("ProfileService", "UpdateProfile", {"profile": cur})
    check("1.update.rename", st == 200 and r["profile"]["name"] == "a09-renamed" and not r.get("needsProfileRestart"), (st, r))
    st, r = c.rpc("ProfileService", "SetProfileMeta", {"id": created, "favorite": True, "tags": ["a09", "tmp"], "notes": "заметка"})
    check("1.meta.ok", st == 200 and r.get("favorite") is True and r.get("tags") == ["a09", "tmp"], (st, r))
    st, r = c.rpc("ProfileService", "ListProfiles", {"favoritesOnly": True})
    check("1.list.favorites_only", st == 200 and [p["id"] for p in r["profiles"]] == [created], (st, r.get("total")))
    st, r = c.rpc("ProfileService", "ListProfiles", {"tagsAnyOf": ["tmp"]})
    check("1.list.tags", st == 200 and r["total"] == "1", (st, r.get("total")))
    st, r = c.rpc("ProfileService", "ListProfiles", {"search": "a09-renamed"})
    check("1.list.search", st == 200 and r["total"] == "1", (st, r.get("total")))
    st, r = c.rpc("ProfileService", "CloneProfiles", {"ids": [created]})
    clones = r.get("newIds", []) if st == 200 else []
    check("1.clone.ok", st == 200 and len(clones) == 1, (st, r))
    st, g = c.rpc("ProfileService", "CreateGroup", {"group": {"name": "a09-group"}})
    gid2 = g.get("id") if st == 200 else None
    check("1.group.create", st == 200 and gid2, (st, g))
    st, r = c.rpc("ProfileService", "MoveProfiles", {"ids": clones, "targetGroupId": gid2})
    check("1.move.ok", st == 200, (st, r))
    st, r = c.rpc("ProfileService", "ListProfiles", {"groupId": gid2})
    check("1.move.visible_in_target", st == 200 and r["total"] == "1", (st, r.get("total")))
    st, r = c.rpc("ProfileService", "MoveProfiles", {"ids": clones, "targetGroupId": "999999"})
    check("1.move.unknown_group.not_found", st in (404, 400) and code((st, r)) in ("not_found", "invalid_argument"), (st, r))
    st, r = c.rpc("ProfileService", "DeleteProfile", {"ids": clones + [created]})
    check("1.delete.ok", st == 200, (st, r))
    st, r = c.rpc("ProfileService", "GetProfile", {"id": created})
    check("1.delete.then_not_found", st == 404, (st, r))
    st, r = c.rpc("ProfileService", "DeleteGroup", {"id": gid2})
    check("1.group.delete", st == 200, (st, r))

    # custom-поля: подтверждение привязано к хэшу содержимого (T-08B)
    pid = X["pidA"]
    st, r = c.rpc("ProfileService", "PreviewCustomFields", {"profileId": pid})
    check("1.custom.preview_without_fields.failed_precondition", st == 400 and code((st, r)) == "failed_precondition", (st, r))
    st, prof = c.rpc("ProfileService", "GetProfile", {"id": pid})
    edited = dict(prof, customOutboundJson='{"connect_timeout": "7s"}', customFieldsConfirmed=True)
    st, r = c.rpc("ProfileService", "UpdateProfile", {"profile": edited})
    check("1.custom.client_flag_ignored", st == 200 and not r["profile"].get("customFieldsConfirmed"), r)
    st, pv = c.rpc("ProfileService", "PreviewCustomFields", {"profileId": pid})
    h = pv.get("customHash", "") if isinstance(pv, dict) else ""
    check("1.custom.preview.hash64_diff_keys", st == 200 and len(h) == 64 and "connect_timeout" in pv.get("diff", "") and pv.get("touchedKeys"), (st, h))
    for cid, body, want_status, want_code in (
            ("bad_hash", {"profileId": pid, "customHash": "xyz"}, 400, "invalid_argument"),
            ("stale_hash", {"profileId": pid, "customHash": "0" * 64}, 400, "failed_precondition"),
            ("unknown_profile", {"profileId": "999999", "customHash": h}, 404, "not_found")):
        st, r = c.rpc("ProfileService", "ConfirmCustomFields", body)
        check("1.custom.confirm." + cid, st == want_status and code((st, r)) == want_code, (st, r))
    st, r = c.rpc("ProfileService", "ConfirmCustomFields", {"profileId": pid, "customHash": h})
    check("1.custom.confirm.ok", st == 200 and r.get("customFieldsConfirmed") is True, (st, r))
    st, cur = c.rpc("ProfileService", "GetProfile", {"id": pid})
    st, r = c.rpc("ProfileService", "UpdateProfile", {"profile": dict(cur, name="a09-A")})
    check("1.custom.same_json_keeps_confirmation", st == 200 and r["profile"].get("customFieldsConfirmed") is True, r)
    st, r = c.rpc("ProfileService", "UpdateProfile", {"profile": dict(cur, customOutboundJson='{"connect_timeout": "9s"}')})
    check("1.custom.edit_revokes", st == 200 and not r["profile"].get("customFieldsConfirmed"), r)
    st, r = c.rpc("ProfileService", "UpdateProfile", {"profile": dict(cur, customOutboundJson='[1]')})
    check("1.custom.not_object.invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, r))
    st, r = c.rpc("ProfileService", "UpdateProfile", {"profile": dict(cur, customOutboundJson='{"a":1,"a":2}')})
    check("1.custom.duplicate_keys.invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, r))
    big = '{"k":"' + "x" * 270000 + '"}'
    st, r = c.rpc("ProfileService", "UpdateProfile", {"profile": dict(cur, customOutboundJson=big)})
    check("1.custom.over_256kib.invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, str(r)[:80]))
    st, r = c.rpc("ProfileService", "UpdateProfile", {"profile": dict(cur, customOutboundJson="", customFieldsConfirmed=False)})
    check("1.custom.cleanup", st == 200, (st, r))


def tail(c, n=1000, token=None):
    st, r = c.rpc("LogService", "GetTail", {"lines": n}, token=token)
    return r.get("lines", []) if st == 200 and isinstance(r, dict) else []


def sec2_connections(c, X):
    """2. Соединения, трафик, итоговая статистика, сводка по группе, адреса назначения в журнале."""
    if not X["ip"] or X["ip"].startswith("127."):
        check("2.lan_ip_available", False, "нет адреса вне loopback: раздел пропущен (BLOCKED)")
        return
    ip, op, mixed = X["ip"], X["origin_port"], X["mixed"]
    st, r = c.rpc("ConnectionService", "ListConnections")
    check("2.list.no_instance_is_empty_not_error", st == 200, (st, r))
    st, r = c.rpc("CoreService", "Connect", {"profileId": X["pidA"], "mode": "CONNECT_MODE_SYSTEM_PROXY"})
    check("2.connect", st == 200 and r["status"]["state"] == "CORE_STATE_CONNECTED", (st, str(r)[:150]))
    t0 = int(time.time() * 1000)
    got = mixed_fetch(mixed, f"http://{ip}:{op}/")
    check("2.fetch.through_mixed", got == 60000, got)
    time.sleep(1.5)
    st, r = c.rpc("ConnectionService", "ListConnections", {"destinationFilter": str(op)})
    conns = r.get("connections", []) if st == 200 else []
    check("2.list.destination_filter", len(conns) >= 1, (st, len(conns)))
    if conns:
        c0 = conns[0]
        check("2.list.bytes_network_status", int(c0.get("downloadBytes", 0)) >= 20000 and c0.get("network") == "tcp" and c0.get("status") in ("STATUS_ACTIVE", "STATUS_CLOSED"),
              {k: c0.get(k) for k in ("downloadBytes", "network", "status", "outbound")})
        X["conn_id"] = c0["id"]
    st, r = c.rpc("ConnectionService", "ListConnections", {"outboundFilter": "no-such-outbound-tag"})
    check("2.list.outbound_filter_empty", st == 200 and not r.get("connections"), (st, r))
    for cid, body, want in (("not_uuid", {"id": "not-a-uuid"}, 400), ("empty", {"id": ""}, 400), ("unknown_uuid", {"id": str(uuid.uuid4())}, 404)):
        st, r = c.rpc("ConnectionService", "CloseConnection", body)
        check("2.close." + cid, st == want, (st, r))
    frames, end = c.stream("ConnectionService", "WatchConnections", {"intervalMs": 250}, seconds=2.5)
    check("2.watch.frames_with_active_list", len(frames) >= 2 and all("active" in f or f == {} for f in frames), (len(frames), end))
    st, r = c.rpc("ConnectionService", "WatchConnections", {"intervalMs": -5})
    check("2.watch.negative_interval.invalid_argument", st in (400, 415) and (st == 415 or code((st, r)) == "invalid_argument"), (st, str(r)[:80]))
    frames, end = c.stream("StatsService", "Subscribe", {"intervalMs": 250}, seconds=2.5)
    check("2.stats.subscribe.frames_with_tags", len(frames) >= 2 and any(f.get("tags") for f in frames), (len(frames), end))
    st, r = c.rpc("StatsService", "GetTrafficTotals", {"profileIds": [X["pidA"]]})
    check("2.stats.totals.ok", st == 200, (st, r))
    # (a) собственные сообщения LAVRay не содержат адресов назначения
    own = [l["message"] for l in tail(c) if l.get("source") != "singbox"]
    leak = [m for m in own if ip in m or f":{op}" in m]
    check("2.log.own_messages_have_no_destinations", not leak, leak[:2])
    # агентский журнал дополнительно маскирует адреса и в строках sing-box
    c.rpc("SettingsService", "SetSettings", {"values": {"agent.mode": {"stringValue": "control"}}})
    agent_lines = " ".join(l["message"] for l in tail(c, 200, token=c.agent))
    check("2.log.agent_view_has_no_destinations", ip not in agent_lines and f":{op}" not in agent_lines, "адрес назначения виден агенту")
    # (б) строки sing-box «inbound connection to <адрес>» ожидаемы при log.level=info (по умолчанию)
    sb = [l["message"] for l in tail(c) if l.get("source") == "singbox" and int(l.get("tsMs", 0)) >= t0]
    check("2.log.singbox_info_lines_expected_at_info", any("inbound connection to" in m and f":{op}" in m for m in sb), "при info строк sing-box не нашлось (допустимо)", warn=True)
    st, r = c.rpc("CoreService", "Disconnect")
    sess = (r.get("finalStats") or {}).get("session") if st == 200 else None
    check("2.disconnect.final_stats", sess and int(sess.get("downlinkTotal", 0)) >= 60000, sess)
    st, r = c.rpc("StatsService", "GetTrafficSummary", {"groupId": X["gid"]})
    g0 = (r.get("groups") or [{}])[0] if st == 200 else {}
    check("2.summary.session_counted", int(g0.get("sessionCount", 0)) >= 1 and int(g0.get("downlinkBytes", 0)) >= 60000, g0)
    check("2.summary.has_no_destinations", ip not in json.dumps(r), "")
    for cid, body, want in (("negative_since", {"sinceMs": "-1"}, 400), ("unknown_group", {"groupId": "999999"}, 404)):
        st, r = c.rpc("StatsService", "GetTrafficSummary", body)
        check("2.summary." + cid, st == want, (st, r))
    # уровень журнала warn убирает строки sing-box о соединениях
    st, r = c.rpc("SettingsService", "SetSettings", {"values": {"log.level": {"stringValue": "warn"}}})
    check("2.log.level_warn.accepted", st == 200 and r.get("needsProfileRestart") in (True, None, False), (st, r))
    t1 = int(time.time() * 1000)
    st, r = c.rpc("CoreService", "Connect", {"profileId": X["pidA"], "mode": "CONNECT_MODE_SYSTEM_PROXY"})
    check("2.log.level_warn.reconnect", st == 200, (st, str(r)[:120]))
    mixed_fetch(mixed, f"http://{ip}:{op}/", 2)
    time.sleep(1.5)
    sb2 = [l["message"] for l in tail(c) if l.get("source") == "singbox" and int(l.get("tsMs", 0)) >= t1]
    check("2.log.level_warn.no_inbound_connection_lines", not any("inbound connection to" in m or "outbound connection to" in m for m in sb2), sb2[:2])
    c.rpc("CoreService", "Disconnect")
    c.rpc("SettingsService", "SetSettings", {"values": {"log.level": {"stringValue": "info"}}})


def sec3_presets(c, X):
    """3. Наборы маршрутов: список, создание, обновление с ревизией, удаление, сброс, экспорт, импорт, маршрут NekoRay, лимит."""
    R = "RoutingService"
    st, r = c.rpc(R, "ListPresets")
    ids = [p["id"] for p in r.get("presets", [])] if st == 200 else []
    check("3.list.five_builtin", st == 200 and ids[:5] == ["lav-ru", "lav-cn", "global", "all-proxy", "all-direct"] and r.get("activePresetId") == "global", (st, ids, r.get("activePresetId")))
    st, r = c.rpc(R, "GetPreset", {"id": "no-such"})
    check("3.get.unknown.not_found", st == 404, (st, r))
    # создание: источник XOR значения
    st, p1 = c.rpc(R, "CreatePreset", {"builtinSourceId": "global"})
    check("3.create.from_builtin", st == 200 and p1["id"].startswith("custom:") and p1.get("builtin") in (None, False) and p1["revision"] == 1
          and p1.get("builtinSourceId") == "global", (st, p1))
    st, r = c.rpc(R, "CreatePreset", {})
    check("3.create.neither.invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, r))
    st, r = c.rpc(R, "CreatePreset", {"builtinSourceId": "global", "preset": {"displayName": "x"}})
    check("3.create.both.invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, r))
    st, r = c.rpc(R, "CreatePreset", {"builtinSourceId": "no-such"})
    check("3.create.unknown_source.not_found", st == 404, (st, r))
    st, p2 = c.rpc(R, "CreatePreset", {"preset": {"displayName": "Мой пресет", "proxyDomain": ["example.org"], "directDomain": ["full:lori.ru"],
                                                  "defaultOutbound": "OUTBOUND_PROXY", "sniffingMode": "SNIFFING_FOR_ROUTING",
                                                  "processRules": [{"processNames": ["steam.exe"], "outbound": "OUTBOUND_DIRECT", "platforms": ["windows"]}]}})
    check("3.create.from_values.slug_from_cyrillic", st == 200 and p2["id"].startswith("custom:") and p2["revision"] == 1, (st, str(p2)[:200]))
    st, r = c.rpc(R, "CreatePreset", {"preset": {"displayName": "x", "proxyDomain": ["bad domain with spaces!!"]}})
    check("3.create.invalid_value.invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, r))
    # обновление
    st, r = c.rpc(R, "UpdatePreset", {"preset": {"id": "global", "displayName": "x"}, "expectedRevision": 1})
    check("3.update.builtin.failed_precondition", st == 400 and code((st, r)) == "failed_precondition", (st, r))
    st, r = c.rpc(R, "UpdatePreset", {"preset": {"id": "custom:no-such", "displayName": "x"}, "expectedRevision": 1})
    check("3.update.unknown.not_found", st == 404, (st, r))
    upd = dict(p2, directDomain=["full:lori.ru", "full:ya.ru"])
    st, r = c.rpc(R, "UpdatePreset", {"preset": upd, "expectedRevision": p2["revision"]})
    check("3.update.increments_revision", st == 200 and r["newRevision"] == 2 and r["preset"]["revision"] == 2 and not r.get("needsProfileRestart"), (st, str(r)[:200]))
    st, r = c.rpc(R, "UpdatePreset", {"preset": upd, "expectedRevision": 1})
    check("3.update.stale_revision.aborted", st == 409 and code((st, r)) == "aborted", (st, r))
    # два параллельных обновления с одной ревизией: ровно одно ABORTED
    cur = c.rpc(R, "GetPreset", {"id": p2["id"]})[1]
    out = []
    ths = [threading.Thread(target=lambda i=i: out.append(c.rpc(R, "UpdatePreset", {"preset": dict(cur, directDomain=[f"full:race{i}.example"]), "expectedRevision": cur["revision"]}))) for i in range(2)]
    [t.start() for t in ths]
    [t.join() for t in ths]
    statuses = sorted(o[0] for o in out)
    check("3.update.concurrent_exactly_one_aborted", statuses == [200, 409], statuses)
    # активация, перезапуск, удаление активного
    st, r = c.rpc(R, "ActivatePreset", {"id": p2["id"]})
    check("3.activate.custom", st == 200, (st, r))
    st, r = c.rpc(R, "GetActivePreset")
    check("3.active.is_custom", st == 200 and r["id"] == p2["id"], (st, r.get("id")))
    cur = c.rpc(R, "GetPreset", {"id": p2["id"]})[1]
    st, r = c.rpc(R, "UpdatePreset", {"preset": dict(cur, proxyDomain=["example.net"]), "expectedRevision": cur["revision"]})
    check("3.update.active_without_connection_no_restart_flag", st == 200, (st, str(r)[:160]))
    st, r = c.rpc(R, "DeletePreset", {"id": "global"})
    check("3.delete.builtin.failed_precondition", st == 400 and code((st, r)) == "failed_precondition", (st, r))
    st, r = c.rpc(R, "DeletePreset", {"id": "custom:no-such"})
    check("3.delete.unknown.not_found", st == 404, (st, r))
    st, r = c.rpc(R, "DeletePreset", {"id": p2["id"]})
    check("3.delete.active_falls_back_to_global", st == 200 and r.get("newActiveId") == "global", (st, r))
    # сброс копии к источнику
    cur = c.rpc(R, "GetPreset", {"id": p1["id"]})[1]
    c.rpc(R, "UpdatePreset", {"preset": dict(cur, proxyDomain=["changed.example"]), "expectedRevision": cur["revision"]})
    st, r = c.rpc(R, "ResetBuiltinPreset", {"id": p1["id"]})
    check("3.reset.copy_restores_source", st == 200 and not r.get("proxyDomain"), (st, str(r)[:160]))
    st, r = c.rpc(R, "ResetBuiltinPreset", {"id": "global"})
    check("3.reset.builtin_id.failed_precondition", st == 400 and code((st, r)) == "failed_precondition", (st, r))
    st, r = c.rpc(R, "ResetBuiltinPreset", {"id": "custom:no-such"})
    check("3.reset.unknown.not_found", st == 404, (st, r))
    st, own = c.rpc(R, "CreatePreset", {"preset": {"displayName": "Без источника"}})
    st, r = c.rpc(R, "ResetBuiltinPreset", {"id": own["id"]})
    check("3.reset.copy_without_source.failed_precondition", st == 400 and code((st, r)) == "failed_precondition", (st, r))
    # экспорт и импорт
    st, ex = c.rpc(R, "ExportPreset", {"id": p1["id"]})
    check("3.export.json_and_name", st == 200 and ex.get("json", "").lstrip().startswith("{") and ex.get("suggestedName", "").replace("-", "").isalnum(), (st, str(ex)[:120]))
    st, im = c.rpc(R, "ImportPreset", {"json": ex["json"]})
    check("3.import.roundtrip_new_id_not_builtin", st == 200 and im["preset"]["id"].startswith("custom:") and im["preset"]["id"] != p1["id"] and not im["preset"].get("builtin"), (st, str(im)[:160]))
    st, bi = c.rpc(R, "ExportPreset", {"id": "global"})
    spoof = json.loads(bi["json"]) if st == 200 else {}
    spoof["id"] = "global"
    st, im2 = c.rpc(R, "ImportPreset", {"json": json.dumps(spoof)})
    check("3.import.never_takes_builtin_id", st == 200 and im2["preset"]["id"].startswith("custom:"), (st, str(im2)[:160]))
    for cid, body in (("garbage", "{oops"), ("empty", ""), ("array", "[]")):
        st, r = c.rpc(R, "ImportPreset", {"json": body})
        check("3.import." + cid + ".invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, r))
    st, r = c.rpc(R, "ImportPreset", {"json": '{"x":"' + "a" * (1 << 20) + '"}'})
    check("3.import.over_1mib.resource_exhausted", st in (400, 429, 413) and code((st, r)) == "resource_exhausted", (st, str(r)[:100]))
    src = os.path.join(os.environ.get("LAVRAY_SRC", ""), "presets", "lav-ru.source.json")
    if os.path.isfile(src):
        raw = open(src, encoding="utf-8").read()
        st, nr = c.rpc(R, "ImportNekoRayRoute", {"nekoboxJson": raw, "name": "RU из NekoBox"})
        check("3.nekoray.creates_custom_preset_with_warnings", st == 200 and nr["preset"]["id"].startswith("custom:") and nr["preset"]["displayName"] == "RU из NekoBox" and nr.get("warnings"), (st, str(nr)[:160]))
    else:
        check("3.nekoray.source_file", False, "нет presets/lav-ru.source.json: задайте LAVRAY_SRC (BLOCKED)")
    for body in ("", "null", "[]", "{oops"):
        st, r = c.rpc(R, "ImportNekoRayRoute", {"nekoboxJson": body})
        check(f"3.nekoray.bad[{body or 'empty'}].invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, r))
    # агент: все RPC наборов закрыты
    st, r = c.rpc(R, "ListPresets", token=c.agent)
    check("3.agent.denied", st == 403, (st, r))
    # лимит 100 пользовательских наборов
    n_before = len([p for p in c.rpc(R, "ListPresets")[1]["presets"] if p["id"].startswith("custom:")])
    made = 0
    last = (0, {})
    for i in range(100 - n_before + 1):
        last = c.rpc(R, "CreatePreset", {"preset": {"displayName": f"lim{i}"}})
        made += last[0] == 200
    check("3.create.limit_101st.resource_exhausted", made == 100 - n_before and last[0] == 429 and code(last) == "resource_exhausted", (made, last[0], str(last[1])[:80]))
    for p in c.rpc(R, "ListPresets")[1]["presets"]:
        if p["id"].startswith("custom:"):
            c.rpc(R, "DeletePreset", {"id": p["id"]})


def b64(data):
    return base64.b64encode(data).decode()


def sec4_backup(c, X):
    """4. BackupService: экспорт, просмотр, восстановление, ошибки, отсутствие секретов в открытом виде."""
    B = "BackupService"
    secret = "SECRET-trojan-pw-" + uuid.uuid4().hex
    st, r = c.rpc("ProfileService", "CreateProfile", {"profile": {"groupId": X["gid"], "type": "PROFILE_TYPE_TROJAN", "name": "a09-secret", "address": "secret.example.org",
                                                               "port": 443, "trojanVless": {"password": secret}}})
    secret_id = r.get("id") if st == 200 else None
    check("4.setup.secret_profile", bool(secret_id), (st, r))
    pw = "пароль-копии-123"
    for cid, pwd in (("empty", ""), ("short", "1234567"), ("long", "p" * 1025)):
        st, r = c.rpc(B, "ExportBackup", {"password": pwd})
        check("4.export.password_" + cid + ".invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, str(r)[:100]))
    st, ex = c.rpc(B, "ExportBackup", {"password": pw})
    data = base64.b64decode(ex["data"]) if st == 200 else b""
    sm = ex.get("summary", {}) if st == 200 else {}
    check("4.export.ok_lavbk1_name_summary", st == 200 and data[:6] == b"LAVBK1" and ex["suggestedName"].startswith("lavray-backup-") and ex["suggestedName"].endswith(".lavbk")
          and int(sm.get("profiles", 0)) >= 3 and int(sm.get("groups", 0)) >= 1, (st, ex.get("suggestedName"), sm))
    check("4.export.no_plaintext_secrets", secret.encode() not in data and b"secret.example.org" not in data and b"SQLite format" not in data, "секрет или заголовок SQLite виден в файле")
    with open(os.path.join(OUT, "backup.lavbk"), "wb") as f:
        f.write(data)
    st, r = c.rpc(B, "PreviewBackup", {"data": b64(data), "password": pw})
    check("4.preview.summary_matches_export", st == 200 and r.get("profiles") == sm.get("profiles") and r.get("groups") == sm.get("groups") and r.get("appVersion"), (st, r))
    st, r = c.rpc(B, "PreviewBackup", {"data": b64(data), "password": "другой-пароль-999"})
    check("4.preview.wrong_password.permission_denied", st == 403 and code((st, r)) == "permission_denied", (st, r))
    flipped = bytearray(data)
    flipped[len(flipped) // 2] ^= 0x01
    st, r = c.rpc(B, "PreviewBackup", {"data": b64(bytes(flipped)), "password": pw})
    check("4.preview.tampered_body.data_loss", st == 500 and code((st, r)) == "data_loss", (st, str(r)[:120]))
    hdr = bytearray(data)
    hdr[40] ^= 0x01
    st, r = c.rpc(B, "PreviewBackup", {"data": b64(bytes(hdr)), "password": pw})
    check("4.preview.tampered_header.not_ok", st != 200 and code((st, r)) in ("data_loss", "permission_denied", "invalid_argument"), (st, str(r)[:120]))
    st, r = c.rpc(B, "PreviewBackup", {"data": b64(data[:30]), "password": pw})
    check("4.preview.truncated.not_ok", st != 200, (st, str(r)[:120]))
    st, r = c.rpc(B, "PreviewBackup", {"data": b64(b"not a backup at all, just text"), "password": pw})
    check("4.preview.garbage.invalid_argument", st == 400 and code((st, r)) == "invalid_argument" and "backup_not_recognized" in json.dumps(r), (st, str(r)[:160]))
    st, r = c.rpc(B, "PreviewBackup", {"data": b64(data), "password": "short"})
    check("4.preview.short_password.invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, str(r)[:100]))
    # восстановление
    st, r = c.rpc(B, "ImportBackup", {"data": b64(data), "password": pw})
    check("4.import.without_confirm.failed_precondition", st == 400 and code((st, r)) == "failed_precondition", (st, str(r)[:120]))
    c.rpc("CoreService", "Connect", {"profileId": X["pidA"], "mode": "CONNECT_MODE_SYSTEM_PROXY"})
    st, r = c.rpc(B, "ImportBackup", {"data": b64(data), "password": pw, "confirmReplace": True})
    check("4.import.while_connected.failed_precondition", st == 400 and code((st, r)) == "failed_precondition", (st, str(r)[:120]))
    c.rpc("CoreService", "Disconnect")
    # меняем состояние, затем возвращаем копией
    c.rpc("ProfileService", "DeleteProfile", {"ids": [secret_id]})
    c.rpc("SettingsService", "SetSettings", {"values": {"inbound.port": {"intValue": "2099"}}})
    frames_holder = []
    ev = threading.Thread(target=lambda: frames_holder.extend(c.stream("SettingsService", "SubscribeSettings", {}, seconds=4)[0]))
    ev.start()
    time.sleep(0.8)
    st, r = c.rpc(B, "ImportBackup", {"data": b64(data), "password": pw, "confirmReplace": True})
    ev.join()
    check("4.import.ok", st == 200 and r.get("restored", {}).get("profiles") == sm.get("profiles"), (st, str(r)[:160]))
    st, p = c.rpc("ProfileService", "GetProfile", {"id": secret_id})
    check("4.import.profile_restored_with_secret", st == 200 and p.get("name") == "a09-secret", (st, str(p)[:80]))
    st, s = c.rpc("SettingsService", "GetSettings", {"keys": ["inbound.port"]})
    check("4.import.setting_restored", st == 200 and str(X["mixed"]) in json.dumps(s), (st, s))
    check("4.import.notifies_settings_subscribers", any(f.get("changed") or f.get("removed") for f in frames_holder), len(frames_holder))
    # журнал и настройки не содержат пароля копии
    allog = " ".join(l["message"] for l in tail(c, 1000))
    st, gs = c.rpc("SettingsService", "GetSettings", {})
    check("4.password_never_logged_or_stored", pw not in allog and pw not in json.dumps(gs, ensure_ascii=False), "пароль копии найден")
    # копия из «более новой схемы» и из чужого пароля — отдельные коды проверяет A14; агент
    for m, body in (("ExportBackup", {"password": pw}), ("PreviewBackup", {"data": "", "password": pw}), ("ImportBackup", {"data": "", "password": pw})):
        st, r = c.rpc(B, m, body, token=c.agent)
        check("4.agent.denied." + m, st == 403, (st, r))
    # лимит BackupService (64 МиБ) выше общего (16 МиБ): 20 МиБ проходят до разбора (ошибка формата), а не по размеру
    blob = b64(b"\x00" * (20 << 20))
    st, r = c.rpc(B, "PreviewBackup", {"data": blob, "password": pw})
    check("4.limit.20mib_reaches_parser", st == 400 and code((st, r)) == "invalid_argument", (st, str(r)[:100]))
    st, r = c.rpc("ProfileService", "ImportContent", {"content": "x" * (20 << 20)})
    check("4.limit.general_cap_16mib_for_other_services", st in (400, 413, 429) and code((st, r)) in ("resource_exhausted", "invalid_argument", None), (st, str(r)[:100]))


def tcp_ping_failed(c, ids):
    """Тест задержки TCP: у недоступных серверов результат сохраняется как отрицательная задержка."""
    return c.stream("ProfileService", "TestLatency", {"profileIds": ids, "mode": "MODE_TCP_PING", "timeoutMs": 1500}, seconds=6)


def sec5_tails_a(c, X):
    """5. Хвосты A: очистка, дубликаты, домены, экспорт конфига, сброс и подписка на настройки, запоминание, CORS."""
    P = "ProfileService"
    G = X["gid"]
    # --- RemoveUnavailableProfiles ---
    st, g = c.rpc(P, "CreateGroup", {"group": {"name": "a09-clean"}})
    cg = g["id"]
    dead = free_port()
    mk = lambda name, port, grp=cg: c.rpc(P, "CreateProfile", {"profile": {"groupId": grp, "type": "PROFILE_TYPE_SOCKS", "name": name, "address": "127.0.0.1", "port": port, "socksHttp": {"proto": "PROTO_SOCKS5"}}})[1]["id"]
    alive_id = mk("a09-alive", X["up_port"])
    dead_id = mk("a09-dead", dead)
    untested_id = mk("a09-untested", free_port())
    tcp_ping_failed(c, [alive_id, dead_id])
    st, r = c.rpc(P, "RemoveUnavailableProfiles", {"groupId": cg, "apply": False})
    check("5.cleanup.dry_run_lists_only_failed", st == 200 and r.get("wouldRemoveIds") == [dead_id] and not r.get("removedIds"), (st, r))
    st, lst = c.rpc(P, "ListProfiles", {"groupId": cg})
    check("5.cleanup.dry_run_writes_nothing", lst["total"] == "3", lst["total"])
    st, r = c.rpc(P, "RemoveUnavailableProfiles", {"groupId": "999999", "apply": True})
    check("5.cleanup.unknown_group.not_found", st == 404, (st, r))
    st, r = c.rpc(P, "RemoveUnavailableProfiles", {"groupId": cg, "apply": True})
    check("5.cleanup.apply_removes_only_failed_untested_kept", st == 200 and r.get("removedIds") == [dead_id] and untested_id not in r.get("removedIds", []), (st, r))
    st, lst = c.rpc(P, "ListProfiles", {"groupId": cg})
    check("5.cleanup.remaining_two", lst["total"] == "2", lst["total"])
    # --- DeduplicateProfiles ---
    st, g2 = c.rpc(P, "CreateGroup", {"group": {"name": "a09-dedup"}})
    dg = g2["id"]
    same_port = free_port()
    first = mk("a09-first", same_port, dg)
    copy1 = mk("a09-copy-with-other-name", same_port, dg)
    other = mk("a09-other", free_port(), dg)
    st, r = c.rpc(P, "DeduplicateProfiles", {"groupId": dg, "apply": False})
    dup_ids = [p["id"] for p in r.get("duplicates", [])] if st == 200 else []
    check("5.dedup.dry_run_reports_copy_ignores_name", st == 200 and dup_ids == [copy1] and not r.get("removedIds"), (st, dup_ids))
    st, r = c.rpc(P, "DeduplicateProfiles", {"groupId": "999999", "apply": True})
    check("5.dedup.unknown_group.not_found", st == 404, (st, r))
    st, r = c.rpc(P, "DeduplicateProfiles", {"groupId": dg, "apply": True})
    check("5.dedup.apply_keeps_first", st == 200 and r.get("removedIds") == [copy1], (st, r))
    st, r = c.rpc(P, "DeduplicateProfiles", {"groupId": dg, "apply": True})
    check("5.dedup.idempotent", st == 200 and not r.get("removedIds"), (st, r))
    st, o = c.rpc(P, "GetProfile", {"id": other})
    check("5.dedup.different_server_kept", st == 200, (st, o))
    # --- ResolveDomains ---
    rg = mk("a09-ip", free_port(), G)
    st, dom = c.rpc(P, "CreateProfile", {"profile": {"groupId": G, "type": "PROFILE_TYPE_SOCKS", "name": "a09-domain", "address": "localhost", "port": free_port(), "socksHttp": {"proto": "PROTO_SOCKS5"}}})
    dom_id = dom["id"]
    st, bad = c.rpc(P, "CreateProfile", {"profile": {"groupId": G, "type": "PROFILE_TYPE_SOCKS", "name": "a09-nxdomain", "address": "no-such-host.invalid", "port": free_port(), "socksHttp": {"proto": "PROTO_SOCKS5"}}})
    bad_id = bad["id"]
    st, r = c.rpc(P, "ResolveDomains", {"ids": [dom_id, bad_id, rg]})
    failed = {f["id"]: f.get("reason", "") for f in r.get("failed", [])} if st == 200 else {}
    check("5.resolve.partial_failure_collected", st == 200 and dom_id in r.get("resolvedIds", []) and bad_id in failed and failed[bad_id], (st, r))
    check("5.resolve.ip_profile_skipped", rg in r.get("skippedIds", []), r)
    st, p = c.rpc(P, "GetProfile", {"id": dom_id})
    check("5.resolve.address_became_ip", st == 200 and p["address"] in ("127.0.0.1", "::1"), p.get("address"))
    for cid, ids in (("empty", []), ("over_1000", [str(i) for i in range(1, 1002)])):
        st, r = c.rpc(P, "ResolveDomains", {"ids": ids})
        check("5.resolve." + cid + ".invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, str(r)[:80]))
    # --- ExportConfig ---
    sec_pw = "SECRET-export-" + uuid.uuid4().hex
    st, t = c.rpc(P, "CreateProfile", {"profile": {"groupId": G, "type": "PROFILE_TYPE_TROJAN", "name": "a09-export", "address": "export.example.org", "port": 443, "trojanVless": {"password": sec_pw}}})
    tid = t["id"]
    st, run = c.rpc(P, "ExportConfig", {"profileId": tid, "purpose": "PURPOSE_RUN"})
    check("5.export_config.run_unredacted", st == 200 and sec_pw in run.get("singBoxJson", "") and not run.get("isRawConfig"), (st, str(run)[:100]))
    st, tst = c.rpc(P, "ExportConfig", {"profileId": tid, "purpose": "PURPOSE_TEST"})
    run_cfg, tst_cfg = json.loads(run["singBoxJson"]), json.loads(tst["singBoxJson"]) if st == 200 else {}
    check("5.export_config.test_purpose_has_no_inbounds", st == 200 and run_cfg.get("inbounds") and not tst_cfg.get("inbounds"), (st, list(tst_cfg.keys())))
    st, r = c.rpc(P, "ExportConfig", {"profileId": "999999"})
    check("5.export_config.unknown.not_found", st == 404, (st, r))
    st, r = c.rpc(P, "ExportConfig", {"profileId": tid}, token=c.agent)
    check("5.export_config.agent_denied", st == 403, (st, r))
    st, ext = c.rpc(P, "CreateProfile", {"profile": {"groupId": G, "type": "PROFILE_TYPE_NAIVE", "name": "a09-naive", "address": "naive.example.org", "port": 443, "naive": {}}})
    if st == 200:
        st, r = c.rpc(P, "ExportConfig", {"profileId": ext["id"]})
        check("5.export_config.external_core.failed_precondition", st == 400 and code((st, r)) == "failed_precondition", (st, str(r)[:120]))
    else:
        check("5.export_config.external_core.failed_precondition", False, f"не удалось создать профиль naive: {st} {str(ext)[:100]}")
    # --- SettingsService: ResetSettings, SubscribeSettings ---
    S = "SettingsService"
    c.rpc(S, "SetSettings", {"values": {"inbound.port": {"intValue": "2077"}, "inbound.auth.user": {"stringValue": "a09user"}}})
    changes = []
    th = threading.Thread(target=lambda: changes.extend(c.stream(S, "SubscribeSettings", {}, seconds=5)[0]))
    th.start()
    time.sleep(0.8)
    c.rpc(S, "SetSettings", {"values": {"inbound.auth.user": {"stringValue": "a09user2"}}})
    st, r = c.rpc(S, "ResetSettings", {"keys": ["inbound.auth.user"]})
    check("5.reset.keys_accepted", st == 200 and r.get("acceptedKeys") == ["inbound.auth.user"], (st, r))
    th.join()
    check("5.subscribe.sees_change_and_removed", any("inbound.auth.user" in f.get("changed", {}) for f in changes) and any("inbound.auth.user" in f.get("removed", []) for f in changes), changes)
    st, v = c.rpc(S, "GetSettings", {"keys": ["inbound.auth.user", "inbound.port"]})
    check("5.reset.value_back_to_default_others_kept", st == 200 and "a09user" not in json.dumps(v) and "2077" in json.dumps(v), v)
    for cid, keys in (("unknown_key", ["no.such.key"]), ("internal_key", ["sub.hwid_id"]), ("update_key", ["update.channel"])):
        st, r = c.rpc(S, "ResetSettings", {"keys": keys})
        check("5.reset." + cid + ".invalid_argument", st == 400 and code((st, r)) == "invalid_argument", (st, r))
    st, r = c.rpc(S, "ResetSettings", {"keys": [], }, token=c.agent)
    check("5.reset.agent_denied", st == 403, (st, r))
    st, r = c.rpc(S, "SubscribeSettings", {}, token=c.agent)
    check("5.subscribe.agent_denied", st in (403, 415), (st, str(r)[:80]))
    # медленный подписчик не блокирует SetSettings (буфер 16, затем ABORTED)
    host, port = c.base.replace("http://", "").split(":")
    slow = socket.create_connection((host, int(port)), timeout=30)  # подписались и ничего не читаем
    payload = bytes([0]) + struct.pack(">I", 2) + b"{}"
    head = ("POST /lavray.v1.SettingsService/SubscribeSettings HTTP/1.1" + CRLF + "Host: " + c.base[7:] + CRLF + "Authorization: Bearer " + c.tok + CRLF
            + "Content-Type: application/connect+json" + CRLF + "Connect-Protocol-Version: 1" + CRLF + "Content-Length: " + str(len(payload)) + CRLF + CRLF)
    slow.sendall(head.encode() + payload)
    t0 = time.time()
    for i in range(60):
        c.rpc(S, "SetSettings", {"values": {"inbound.auth.pass": {"stringValue": f"p{i}"}}})
    check("5.subscribe.slow_subscriber_does_not_block_writers", time.time() - t0 < 20, f"60 записей за {time.time() - t0:.1f} с")
    slow.close()
    # --- remember ---
    st, r = c.rpc("CoreService", "Connect", {"profileId": X["pidA"], "mode": "CONNECT_MODE_SYSTEM_PROXY"})
    st2, v = c.rpc(S, "GetSettings", {"keys": ["remember.id", "remember.modes"]})
    check("5.remember.connect_writes_id_and_modes", st == 200 and X["pidA"] in json.dumps(v) and "system_proxy" in json.dumps(v), v)
    c.rpc("CoreService", "Disconnect")
    c.rpc("CoreService", "Connect", {"profileId": X["pidB"], "mode": "CONNECT_MODE_SYSTEM_PROXY"})
    c.rpc("CoreService", "Disconnect")
    before = c.rpc(S, "GetSettings", {"keys": ["remember.id"]})[1]
    check("5.remember.second_connect_updates_id", X["pidB"] in json.dumps(before.get("values", {}).get("remember.id", {})), before)
    c.rpc("CoreService", "Connect", {"inlineProfile": {"type": "PROFILE_TYPE_SOCKS", "name": "inline", "address": "127.0.0.1", "port": X["up_port"], "socksHttp": {"proto": "PROTO_SOCKS5"}}})
    after = c.rpc(S, "GetSettings", {"keys": ["remember.id"]})[1]
    check("5.remember.inline_profile_not_remembered", after == before, (before, after))
    c.rpc("CoreService", "Disconnect")
    c.rpc("CoreService", "Connect", {"profileId": X["pidA"], "mode": "CONNECT_MODE_SYSTEM_PROXY"})
    c.rpc("CoreService", "Disconnect")
    # --- CORS ---
    for origin, want in (("tauri://localhost", True), ("http://tauri.localhost", True), ("http://127.0.0.1:5173", True), ("https://evil.example", False), ("http://localhost.evil.example", False)):
        req = urllib.request.Request(f"{c.base}/lavray.v1.CoreService/GetStatus", method="OPTIONS", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})
        with urllib.request.urlopen(req, timeout=10) as r:
            acao, status, hdrs = r.headers.get("Access-Control-Allow-Origin"), r.status, r.headers.get("Access-Control-Allow-Headers", "")
        check(f"5.cors.preflight[{origin}]", status == 204 and (acao == origin) == want and (not want or "X-LAVRay-CSRF" in hdrs), (status, acao))
    st, r = c.rpc("CoreService", "GetStatus", token="wrong", headers={"Origin": "tauri://localhost"})
    check("5.cors.origin_is_not_authentication", st == 401, (st, r))


def sec6_headless_remember(c, X):
    """6. Сервисный режим: --headless подключает запомненный профиль только при remember.enable=true."""
    c.rpc("CoreService", "Connect", {"profileId": X["pidA"], "mode": "CONNECT_MODE_SYSTEM_PROXY"})
    c.rpc("CoreService", "Disconnect")
    c.rpc("SettingsService", "SetSettings", {"values": {"remember.enable": {"boolValue": False}}})
    c.close()

    def wait_connected(core, seconds):
        for _ in range(seconds):
            time.sleep(1)
            st, r = core.rpc("CoreService", "GetStatus")
            if st == 200 and r.get("state") == "CORE_STATE_CONNECTED" and r.get("activeProfileId") == X["pidA"]:
                return True
        return False

    h = Core(X["data"], extra=("--headless",))
    try:
        check("6.headless.disabled_by_default_does_not_connect", not wait_connected(h, 5), "подключился при remember.enable=false")
        h.rpc("SettingsService", "SetSettings", {"values": {"remember.enable": {"boolValue": True}}})
    finally:
        h.close()
    h = Core(X["data"], extra=("--headless",))
    try:
        check("6.headless.reconnects_remembered_profile", wait_connected(h, 30), "не подключился за 30 с при remember.enable=true")
        h.rpc("CoreService", "Disconnect")
    finally:
        h.close()
    X["core"] = c


def sec7_migration(c, X):
    """7. MigrationService (T-78): Detect, Preview, Import на малом синтетическом каталоге, коды ошибок, агент. Полный набор сценариев - файл A15."""
    M = "MigrationService"
    root = os.path.join(OUT, "neko-mini")
    shutil.rmtree(root, ignore_errors=True)

    def w(rel, obj):
        path = os.path.join(root, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False))

    w("groups/0.json", {"id": 0, "name": "a09 neko group", "order": [1, 2], "front_proxy_id": -1})
    w("profiles/1.json", {"type": "socks", "id": 1, "gid": 0, "bean": {"name": "a09-neko-1", "addr": "203.0.113.21", "port": 1080, "v": 5}})
    w("profiles/2.json", {"type": "chain", "id": 2, "gid": 0, "bean": {"name": "a09-neko-chain", "list": [1]}})
    w("profiles/3.json", '{"type":"vmess","id":3,"bean":{"name":"broken')
    w("routes_box/a09 route", {"def_outbound": "proxy", "direct_domain": "domain:a09.example", "direct_ip": "", "proxy_domain": "", "proxy_ip": "",
                               "block_domain": "", "block_ip": "", "sniffing_mode": 1})
    # DetectNekoBox: переданный путь возвращается первым как «manual» с числами по именам файлов
    st, r = c.rpc(M, "DetectNekoBox", {"extraPaths": [root, "relative-path", os.path.join(root, "no-such")]})
    mine = [x for x in r.get("candidates", []) if os.path.normcase(os.path.normpath(x["path"])) == os.path.normcase(os.path.normpath(root))] if st == 200 else []
    check("7.detect.extra_path_is_manual", st == 200 and len(mine) == 1 and mine[0]["source"] == "manual" and mine[0].get("groups") == 1 and mine[0].get("profiles") == 3 and mine[0].get("routes") == 1,
          (st, mine))
    # коды ошибок пути
    for cid, path, want, wcode in (("empty", "", 400, "invalid_argument"), ("relative", "neko-mini", 400, "invalid_argument"), ("file", os.path.join(root, "groups", "0.json"), 400, "invalid_argument"),
                                   ("not_neko_dir", OUT, 400, "invalid_argument"), ("missing", os.path.join(OUT, "neko-missing"), 404, "not_found")):
        for call in ("PreviewNekoBoxImport", "ImportNekoBox"):
            st, r = c.rpc(M, call, {"path": path})
            check(f"7.path.{cid}.{call}", st == want and isinstance(r, dict) and r.get("code") == wcode, (st, str(r)[:100]))
    n_before = len(c.rpc("ProfileService", "ListProfiles")[1].get("profiles", []))
    st, pv = c.rpc(M, "PreviewNekoBoxImport", {"path": root, "includeRoutes": True, "includeSettings": True})
    check("7.preview.dry_run_report", st == 200 and pv.get("dryRun") is True and pv.get("groupsImported") == 1 and sum((pv.get("profilesByType") or {}).values()) == 2 and pv.get("routesFound") == 1 and
          pv.get("routesImported") == 1 and len(pv.get("skipped", [])) == 1, (st, str(pv)[:200]))
    check("7.preview.wrote_nothing", len(c.rpc("ProfileService", "ListProfiles")[1].get("profiles", [])) == n_before and "custom:neko-a09-route" not in [p["id"] for p in c.rpc("RoutingService", "ListPresets")[1]["presets"]], "")
    st, rp = c.rpc(M, "ImportNekoBox", {"path": root, "includeRoutes": True, "includeSettings": True})
    same = dict(pv)
    same.pop("dryRun", None)
    got = dict(rp) if isinstance(rp, dict) else {}
    got.pop("dryRun", None)
    check("7.import.equals_preview", st == 200 and same == got, (st, str(rp)[:200]))
    profs = {p["name"]: p for p in c.rpc("ProfileService", "ListProfiles")[1]["profiles"]}
    chain_ids = profs.get("a09-neko-chain", {}).get("chain", {}).get("profileIds")
    check("7.import.chain_points_to_imported_member", chain_ids == [profs.get("a09-neko-1", {}).get("id")] and len(profs) == n_before + 2, (chain_ids, profs.get("a09-neko-1", {}).get("id")))
    check("7.import.route_became_custom_preset", "custom:neko-a09-route" in [p["id"] for p in c.rpc("RoutingService", "ListPresets")[1]["presets"]], "")
    st, again = c.rpc(M, "ImportNekoBox", {"path": root, "includeRoutes": True})
    check("7.import.second_run_adds_nothing", st == 200 and again.get("alreadyPresent") == 4 and not again.get("groupsImported") and not again.get("routesImported") and not any((again.get("profilesByType") or {}).values()),
          (st, again.get("alreadyPresent")))
    # агентский токен: весь сервис закрыт и в read, и в control
    for mode in ("read", "control"):
        c.rpc("SettingsService", "SetSettings", {"values": {"agent.mode": {"stringValue": mode}}})
        for call, body in (("DetectNekoBox", {}), ("PreviewNekoBoxImport", {"path": root}), ("ImportNekoBox", {"path": root})):
            st, r = c.rpc(M, call, body, token=c.agent)
            check(f"7.agent.{mode}.{call}.denied", st == 403 and isinstance(r, dict) and r.get("code") == "permission_denied", (st, str(r)[:80]))
    c.rpc("SettingsService", "SetSettings", {"values": {"agent.mode": {"stringValue": "off"}}})
    # уборка: перенесённое удаляется, чтобы не влиять на следующие запуски
    ids = [p["id"] for n, p in profs.items() if n.startswith("a09-neko-")]
    c.rpc("ProfileService", "DeleteProfile", {"ids": [i for i in ids if i != profs.get("a09-neko-1", {}).get("id")]})
    c.rpc("ProfileService", "DeleteProfile", {"ids": [profs.get("a09-neko-1", {}).get("id")]})
    c.rpc("RoutingService", "DeletePreset", {"id": "custom:neko-a09-route"})
    shutil.rmtree(root, ignore_errors=True)


SECTIONS = [sec1_profiles, sec2_connections, sec3_presets, sec4_backup, sec5_tails_a, sec7_migration, sec6_headless_remember]


def main():
    up = Socks5(("127.0.0.1", 0), Socks5Handler)
    threading.Thread(target=up.serve_forever, daemon=True).start()
    origin = http.server.ThreadingHTTPServer(("0.0.0.0", 0), Origin)
    threading.Thread(target=origin.serve_forever, daemon=True).start()
    X = {"up_port": up.server_address[1], "origin_port": origin.server_address[1], "mixed": free_port(), "ip": lan_ip()}
    data = os.path.join(OUT, "data")
    os.makedirs(data, exist_ok=True)
    X["data"] = data
    c = Core(data)
    X["core"] = c
    try:
        c.rpc("SettingsService", "SetSettings", {"values": {"inbound.port": {"intValue": str(X["mixed"])}, "connect.health_check": {"boolValue": False}}})
        GID[0] = c.rpc("ProfileService", "ListGroups")[1]["groups"][0]["id"]
        X["gid"] = GID[0]
        c.rpc("ProfileService", "ImportContent", {"content": f"socks://127.0.0.1:{X['up_port']}#a09-A", "intent": "INTENT_AS_LINKS", "targetGroupId": GID[0]})
        c.rpc("ProfileService", "ImportContent", {"content": f"socks://127.0.0.1:{free_port()}#a09-B", "intent": "INTENT_AS_LINKS", "targetGroupId": GID[0]})
        profs = c.rpc("ProfileService", "ListProfiles")[1]["profiles"]
        X["pidA"], X["pidB"] = profs[0]["id"], profs[1]["id"]
        check("0.setup", len(profs) == 2 and profs[0]["name"] == "a09-A", [p["name"] for p in profs])
        for fn in SECTIONS:
            try:
                fn(c, X)
            except Exception as e:  # noqa: BLE001 - сбой раздела не должен скрывать остальные
                import traceback
                check(f"{fn.__name__}.exception", False, repr(e) + " @ " + traceback.format_exc().strip().splitlines()[-3].strip())
    finally:
        c.close()
    failed = [r for r in RESULTS if not r["pass"] and not r["warn"]]
    warns = [r for r in RESULTS if r["warn"]]
    with open(os.path.join(OUT, "a09-result.json"), "w", encoding="utf-8") as f:
        json.dump({"total": len(RESULTS), "failed": len(failed), "warnings": len(warns), "checks": RESULTS}, f, ensure_ascii=False, indent=1)
    print(f"A09: проверок {len(RESULTS)}, провалов {len(failed)}, наблюдений WARN {len(warns)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```
