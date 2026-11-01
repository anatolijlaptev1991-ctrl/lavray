# A07. Живой дымовой тест ядра на loopback

| Поле | Значение |
|---|---|
| ID | A07 |
| Слой | авто |
| Время | 5–8 минут |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–7. Лучше после A06 (ядро берётся из ZIP релиза); без релиза допустимо ядро, собранное в A03 (`tmp\A03\lavray-core.exe`) |
| Опасность | нет: ядро слушает только `127.0.0.1`; системный прокси, TUN, реестр и порт 2080 не затрагиваются |

## Цель

Запустить настоящее ядро (с sing-box) без окна и оболочки, подключить его к крошечному локальному SOCKS5-серверу и пройти полный жизненный цикл: запуск, авторизация, настройки, импорт, подключение, трафик через входящий порт, отключение, повторное подключение, защита от двойного подключения, выход при закрытии stdin. Затем на том же ядре проверить подтверждение custom-полей (T-08B) и учёт соединений и трафика (T-79). Покрывает: T-01 (туннель), T-02 (теги ядра), T-08B (RPC `PreviewCustomFields`, `ConfirmCustomFields`), T-79 (RPC `ListConnections`, `CloseConnection`, `GetTrafficTotals`, `GetTrafficSummary`, `final_stats` в `Disconnect`), «Подключено» с проверкой связи (0.2.1), ошибки RPC и их коды.

Часть А — скрипт репозитория `scripts/smoke/smoke_core.py` (он же упомянут в плане как шаг выпуска). Часть Б — CI-проверка на curl (задание `core-run`). Часть В — расширенные проверки T-08B и T-79, скрипт из этого файла.

## Предусловия

- Python 3.12, Git Bash (для части Б). Ядро: `$env:LAVRAY_CORE_EXE` (из ZIP релиза, шаг 7 файла A06).
- Сеть: часть А ходит через SOCKS-апстрим на `example.com`, `www.google.com`, `ya.ru` (прямые запросы с этого ПК). Если интернета нет, шаги с `fetch` получают `BLOCKED`.
- Порты: `47950` свободен (см. `01-ENVIRONMENT.md`, раздел 8). Остальные порты случайные.

## Безопасность

Ядро запускается с отдельным временным каталогом данных `C:\lavray-test\tmp\A07\...` и не читает `%APPDATA%\LAVRay`. Часть А подключает ядро в режиме `CONNECT_MODE_SYSTEM_PROXY`, но **системный прокси ставит окно LAVRay, а не ядро**: ядро лишь открывает свой входящий порт `127.0.0.1:47950`. Проверка (шаг 7) подтверждает, что реестр не менялся.

## Шаги

1. Каталоги, переменные, ядро.

```powershell
. C:\lavray-test\env.ps1
$t = 'C:\lavray-test\tmp\A07'
New-Item -ItemType Directory -Force -Path $t, "$t\a", "$t\b", "$t\c", C:\lavray-test\results\A07 | Out-Null
$exe = if (Test-Path $env:LAVRAY_CORE_EXE) { $env:LAVRAY_CORE_EXE } else { 'C:\lavray-test\tmp\A03\lavray-core.exe' }
$exe
Test-Path $exe
Get-NetTCPConnection -State Listen -LocalPort 47950 -ErrorAction SilentlyContinue
$isBefore = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$before = "$($isBefore.ProxyEnable)|$($isBefore.ProxyServer)|$($isBefore.AutoConfigURL)"
"реестр до: $before"
```

   Ожидается: путь к ядру, `True`, команда с портом `47950` ничего не печатает. Запомните строку «реестр до».

2. Часть А: запуск `smoke_core.py`. Скрипт в `src\` только читается.

```powershell
$smoke = Join-Path $env:LAVRAY_SRC 'scripts\smoke\smoke_core.py'
python -I $smoke --exe $exe --out "$t\a" --mixed-port 47950 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A07\smoke-stdout.txt | Select-Object -Last 6
"smoke exit=$LASTEXITCODE"
Get-ChildItem "$t\a" | Select-Object Name, Length
```

   Ожидается: `smoke exit=0`; в каталоге есть `smoke-report.json`, `runtime-config.json`, `core-stderr.log`, `core-stdout.log`, `data\`. Скрипт печатает блоки `## <шаг>`; последний — `## exit on stdin EOF`.

3. Проверка результата части А. Сохраните скрипт-проверку из раздела «Скрипт проверки части А» ниже как `C:\lavray-test\tmp\A07\a07_verify.py` и запустите:

```powershell
python -I "$t\a07_verify.py" "$t\a\smoke-report.json" 47950 $env:LAVRAY_VERSION 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A07\verify-a.txt | Select-Object -Last 30
"verify-a exit=$LASTEXITCODE"
```

   Ожидается: строки `PASS …` на каждый шаг, `A07-A: провалов 0`, `verify-a exit=0`. Что проверяет каждый шаг `smoke_core.py`:

   | Шаг скрипта | Что проверяет | Критерий |
   |---|---|---|
   | `ready` | ядро печатает `LAVRAY_CORE_READY tcp://127.0.0.1:<порт>` | строка по шаблону, быстрее 10 с (эталон 0,3 с) |
   | `no-token request` | запрос без токена отвергается | `401` |
   | `status.initial` | `GetStatus`: версия ядра, режим по умолчанию, имя адаптера TUN | `coreVersion` равна версии продукта, `tun.interfaceName` = `lavray-tun` |
   | `settings.port` | `SetSettings inbound.port` принят | `acceptedKeys` содержит `inbound.port` |
   | `groups`, `import` | встроенная группа `Default` (id 2147483000), импорт ссылки `socks://127.0.0.1:<порт>#smoke-upstream` | тип контента `CONTENT_KIND_SHARE_LINKS`, добавлен профиль `1` |
   | `connect` | `Connect` в режиме системного прокси | `CORE_STATE_CONNECTED`, `inbound.port` = порту mixed, быстрее 10 с (эталон 0,1 с) |
   | `listening.connected` | `netstat`: порт mixed слушается процессом ядра | в списке `127.0.0.1:47950` |
   | `fetch …` | три запроса через mixed-вход → SOCKS-апстрим → Интернет | `example.com` = 200; хотя бы один из `generate_204` (204) и `ya.ru` (200); апстрим видел `example.com:80` |
   | `runtime-config.saved` | `GetRuntimeConfig` отдаёт конфиг без секретов | `200`; в файле один inbound `mixed` на `127.0.0.1:47950`, строки `2080` нет |
   | `disconnect` | `Disconnect` возвращает итоговую статистику (T-79) | `finalStats.final = true`, `downlinkTotal > 0` |
   | `status.after-disconnect`, `listening.after-disconnect` | состояние простоя, порт закрыт | поля `state` нет (простой) или `CORE_STATE_IDLE`; порта mixed в списке нет |
   | `reconnect`, `fetch after reconnect` | повторное подключение работает | `CONNECTED`, запрос 200 |
   | `double-connect` | второе подключение при активном | `400`, код `failed_precondition`, статус остаётся `CONNECTED` |
   | `exit on stdin EOF` | закрытие stdin = «оболочка умерла», ядро выходит само | код `0`, быстрее 10 с (эталон 0,04 с) |

4. Часть Б: проверка задания `core-run` CI на curl. Сохраните скрипт из раздела «Скрипт части Б» как `C:\lavray-test\tmp\A07\ci_smoke.sh` и запустите в Git Bash (вывод — в файл, иначе фоновый `sleep` задержит завершение):

```bash
export LAVRAY_CORE_EXE_UNIX="$(cygpath -u "$LAVRAY_CORE_EXE")"
bash /c/lavray-test/tmp/A07/ci_smoke.sh > /c/lavray-test/results/A07/ci-smoke.txt 2>&1; echo "ci-smoke exit=$?"
cut -c1-200 /c/lavray-test/results/A07/ci-smoke.txt
```

   Ожидается: `ci-smoke exit=0`, в выводе `healthz=200 no-auth=401 bad-auth=401`, строка `status={...}` с полем `coreVersion`, последняя строка `CI-SMOKE-OK`. Если `LAVRAY_CORE_EXE` не задана в сессии Git Bash, передайте путь вручную в формате `/c/lavray-test/portable/0.9.0/binaries/lavray-core.exe`.

5. Часть В: T-08B и T-79 на настоящем ядре. Сохраните скрипт «Скрипт части В» как `C:\lavray-test\tmp\A07\a07_extra.py` и запустите:

```powershell
python -I "$t\a07_extra.py" $exe "$t\c" 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A07\extra.txt | Select-Object -Last 32
"extra exit=$LASTEXITCODE"
```

   Ожидается: `extra exit=0`, `A07-B: проверок 30, провалов 0, наблюдений WARN 0` (число проверок может вырасти). Скрипт сам выбирает адрес основного сетевого интерфейса (не loopback), потому что ядро не считает соединения с `127.0.0.1`. Нет сетевого адреса — проверка `conn.lan_ip_available` падает: итог шага `BLOCKED`.

   Адреса назначения в журнале (решение плана по T-79 «адреса назначения не пишутся в журнал» в части собственных сообщений LAVRay):
   (а) `FAIL log.own_messages_have_no_destinations`: если в строках журнала с источником, отличным от `singbox` (трекер соединений, учёт, статистика, сервис соединений), есть адрес или порт тестового сервера. Дефект `major`.
   (б) строки самого sing-box вида `inbound connection to <адрес>:<порт>` при `log.level = info` (по умолчанию) **ожидаемы**, как в NekoBox (`cfgbuild/builder.go`, значение по умолчанию `info`); их отсутствие — `WARN log.singbox_inbound_lines_expected_at_info` (допустимо). Затем скрипт задаёт `log.level = warn` через `SetSettings`, переподключается и сверяет, что таких строк больше нет (`log.level_warn.no_connection_lines`, ожидается `PASS`; строка осталась — `FAIL`, `minor`: настройка не снижает шум). Модульный тест `TestDestinationsNeverLogged` работает на подставном источнике и строк sing-box не видит, поэтому живая проверка нужна. Для ИИ-агентов адреса дополнительно маскирует `get_logs` (`[addr]`, `docs/MCP.md`); агентский вид журнала (`GetTail` агентским токеном, тот же вызов, что использует `get_logs`) проверяет A09 (`2.log.agent_view_has_no_destinations`).

6. Что проверяет часть В (для отчёта):

   | Блок | Проверки |
   |---|---|
   | T-08B | профиль без custom-полей не подтверждён; `PreviewCustomFields` без полей → `failed_precondition`; клиентский флаг `customFieldsConfirmed: true` в `UpdateProfile` игнорируется; хэш подтверждения из 64 hex; в diff есть `connect_timeout`, затронутые ключи непусты; `ConfirmCustomFields` с плохим хэшем → `invalid_argument`, с устаревшим → `failed_precondition`, с неизвестным профилем → `not_found`, с верным → профиль подтверждён; переименование сохраняет подтверждение; правка JSON его снимает |
   | T-79 | `ListConnections` без соединений не ошибка; после трёх запросов на 20 000 байт список содержит соединение с `downloadBytes >= 20000` и `network = tcp`; `CloseConnection` с не-UUID → `invalid_argument`, с неизвестным UUID → `not_found`; `GetTrafficTotals` отвечает; `Disconnect` возвращает `finalStats.session.downlinkTotal > 0`; `GetTrafficSummary` по группе даёт `sessionCount >= 1` и `downlinkBytes > 0`; отрицательный `sinceMs` → `invalid_argument` |
   | Журнал | собственные сообщения LAVRay без адреса назначения; строки sing-box о соединениях при `info`; после `log.level = warn` и переподключения строк о соединениях нет; собственные сообщения и тогда без адреса |

7. Системное состояние не изменилось.

```powershell
$isAfter = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$after = "$($isAfter.ProxyEnable)|$($isAfter.ProxyServer)|$($isAfter.AutoConfigURL)"
"реестр после: $after"
"реестр не менялся: " + ($before -eq $after)
Get-Process lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\lavray-test\*' }
Get-NetTCPConnection -State Listen -LocalPort 47950 -ErrorAction SilentlyContinue
```

   Ожидается: `реестр не менялся: True`; процессов ядра из `C:\lavray-test` нет; порт `47950` свободен.

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Шаг 2: `smoke_core.py` завершился кодом 0 и написал `smoke-report.json` | `smoke exit=0` |
| К2 | Шаг 3: все проверки части А `PASS` | `A07-A: провалов 0` |
| К3 | Шаг 4: CI-проверка прошла | `CI-SMOKE-OK`, `ci-smoke exit=0` |
| К4 | Шаг 5: часть В без провалов (`WARN` допустим) | `провалов 0` |
| К5 | Шаг 7: системный прокси не менялся, процессов и открытых портов не осталось | `True` и пустые вывода |
| К6 | Версия ядра в `status.initial` равна версии продукта | проверка `status.initial: версия ядра` |

Сетевые `fetch` без интернета — `BLOCKED` (итог файла `PARTIAL`), а не `FAIL`.

## Что собрать

`results\A07\`: `smoke-stdout.txt`, `verify-a.txt`, `ci-smoke.txt`, `extra.txt`; из `tmp\A07\a`: `smoke-report.json`, `runtime-config.json`, `core-stderr.log`. В `core-stderr.log` секретов нет; `smoke-report.json` содержит токены только как факт запроса (тело ответов), перед публикацией проверьте поиском `Bearer`.

## Откат / уборка

```powershell
Get-Process lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\lavray-test\*' } | Stop-Process -Force
Remove-Item -Recurse -Force C:\lavray-test\tmp\A07
Test-Path C:\lavray-test\tmp\A07
```

Ожидается `False`. Системного отката нет (ничего не менялось).

## Отчёт

`results/A07.md` по `templates/REPORT.md`: статусы 7 шагов, К1–К6, список `WARN`. Провал К1–К4 — `major`; К5 — `critical`, если изменился системный прокси (ядро не должно его трогать); К6 — `major`.

## Скрипт проверки части А (`a07_verify.py`)

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка smoke-report.json, который пишет scripts/smoke/smoke_core.py.

Запуск: python -I a07_verify.py <smoke-report.json> <порт mixed> <ожидаемая версия ядра>
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
report_path, mixed, version = sys.argv[1], int(sys.argv[2]), sys.argv[3]
rep = {s["step"]: s["value"] for s in json.load(open(report_path, encoding="utf-8"))}
bad = []


def check(cid, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + cid + ("" if ok else " :: " + str(detail)[:160]))
    if not ok:
        bad.append(cid)


def body(step):
    v = rep.get(step)
    return v[1] if isinstance(v, list) and len(v) == 2 else {}


def code(step):
    v = rep.get(step)
    return v[0] if isinstance(v, list) and len(v) == 2 else v


check("ready", bool(re.fullmatch(r"LAVRAY_CORE_READY tcp://127\.0\.0\.1:\d+", rep["ready"]["line"])) and rep["ready"]["seconds"] < 10, rep["ready"])
check("no-token request = 401", rep["no-token request"] == 401, rep["no-token request"])
st0 = body("status.initial")
check("status.initial: версия ядра", st0.get("coreVersion") == version, st0.get("coreVersion"))
check("status.initial: интерфейс TUN по умолчанию", st0.get("tun", {}).get("interfaceName") == "lavray-tun", st0.get("tun"))
check("settings.port принят", "inbound.port" in body("settings.port").get("acceptedKeys", []), rep["settings.port"])
check("groups: одна группа Default", [g["name"] for g in rep["groups"]["groups"]] == ["Default"], rep["groups"])
imp = body("import")
check("import: ссылка разобрана, профиль добавлен", imp.get("kind") == "CONTENT_KIND_SHARE_LINKS" and imp.get("addedProfileIds") == ["1"], imp)
con = body("connect").get("status", {})
check("connect: CONNECTED на порту mixed", code("connect") == 200 and con.get("state") == "CORE_STATE_CONNECTED" and con.get("inbound", {}).get("port") == mixed, con)
check("connect: быстрее 10 с", rep["connect.seconds"] < 10, rep["connect.seconds"])
check("status.connected", body("status.connected").get("state") == "CORE_STATE_CONNECTED", "")
check("listening.connected: порт mixed слушается", f"127.0.0.1:{mixed}" in rep["listening.connected"], rep["listening.connected"])
check("fetch http://example.com/ = 200", rep["fetch http://example.com/"] == 200, rep["fetch http://example.com/"])
https_ok = [u for u in ("https://www.google.com/generate_204", "https://ya.ru/") if rep["fetch " + u] in (200, 204)]
check("fetch https: хотя бы один из двух прошёл", len(https_ok) >= 1, [rep["fetch https://www.google.com/generate_204"], rep["fetch https://ya.ru/"]])
check("upstream видел example.com:80", "example.com:80" in rep["upstream saw"], rep["upstream saw"])
check("runtime-config.saved = 200", rep["runtime-config.saved"] == 200, rep["runtime-config.saved"])
cfg_file = os.path.join(os.path.dirname(os.path.abspath(report_path)), "runtime-config.json")
cfg = json.load(open(cfg_file, encoding="utf-8"))
mix = [i for i in cfg.get("inbounds", []) if i.get("type") == "mixed"]
check("runtime-config: inbound mixed на 127.0.0.1:порт", len(mix) == 1 and mix[0].get("listen") == "127.0.0.1" and mix[0].get("listen_port") == mixed, mix)
check("runtime-config: нет порта 2080", "2080" not in json.dumps(cfg), "")
fin = body("disconnect").get("finalStats", {})
check("disconnect: итоговая статистика сессии", fin.get("final") is True and int(fin.get("session", {}).get("downlinkTotal", 0)) > 0, fin)
check("status.after-disconnect: не подключено", body("status.after-disconnect").get("state") in (None, "CORE_STATE_IDLE"), body("status.after-disconnect"))
check("listening.after-disconnect: порт mixed закрыт", f"127.0.0.1:{mixed}" not in rep["listening.after-disconnect"], rep["listening.after-disconnect"])
check("reconnect", body("reconnect").get("status", {}).get("state") == "CORE_STATE_CONNECTED", "")
check("fetch after reconnect = 200", rep["fetch after reconnect"] == 200, rep["fetch after reconnect"])
dbl = rep["double-connect"]
check("double-connect: 400 failed_precondition", dbl[0] == 400 and "failed_precondition" in str(dbl[1]), dbl)
check("status.after-double: по-прежнему подключено", body("status.after-double").get("state") == "CORE_STATE_CONNECTED", "")
ex = rep["exit on stdin EOF"]
check("выход при закрытии stdin: код 0 быстрее 10 с", isinstance(ex, dict) and ex.get("code") == 0 and ex.get("seconds", 99) < 10, ex)
print(f"A07-A: провалов {len(bad)}")
sys.exit(1 if bad else 0)
```

## Скрипт части Б (`ci_smoke.sh`)

```bash
set -euo pipefail
CORE="${LAVRAY_CORE_EXE_UNIX:?задайте путь к lavray-core.exe в формате Git Bash}"
WORK="$(mktemp -d)"
DATA="$WORK/data"; mkdir -p "$DATA"
TOKEN="ci-test-token-0123456789abcdef0123"
# stdin обязан оставаться открытым: закрытие = смерть оболочки, ядро штатно выходит.
(echo "$TOKEN"; sleep 40) | "$CORE" serve --listen-socket 127.0.0.1:0 --data "$DATA" > "$WORK/core.log" 2>&1 &
CORE_PID=$!
READY=""
for i in $(seq 1 80); do
  READY=$(grep -o "LAVRAY_CORE_READY tcp://[0-9.]*:[0-9]*" "$WORK/core.log" | head -1 || true)
  if [ -n "$READY" ]; then break; fi
  sleep 0.25
done
if [ -z "$READY" ]; then echo "core did not become ready"; cat "$WORK/core.log"; exit 1; fi
PORT="${READY##*:}"
echo "core listening on port $PORT"
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/healthz")
NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/lavray.v1.CoreService/GetStatus")
BADAUTH=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer wrong" "http://127.0.0.1:$PORT/lavray.v1.CoreService/GetStatus")
STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{}" "http://127.0.0.1:$PORT/lavray.v1.CoreService/GetStatus")
echo "healthz=$HEALTH no-auth=$NOAUTH bad-auth=$BADAUTH"
echo "status=$STATUS"
kill $CORE_PID 2>/dev/null || true
test "$HEALTH" = "200"
test "$NOAUTH" = "401"
test "$BADAUTH" = "401"
echo "$STATUS" | grep -q "coreVersion"
echo "CI-SMOKE-OK"
```

## Скрипт части В (`a07_extra.py`)

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A07 (часть Б): custom-поля (T-08B), соединения и трафик (T-79) на настоящем ядре, loopback.

Запуск: python -I a07_extra.py <путь к lavray-core.exe> <каталог результатов>
Код выхода: 0 - все проверки PASS, 1 - есть FAIL. Итог: <каталог>/a07-extra-result.json.
"""
import http.server
import json
import os
import secrets
import select
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

sys.stdout.reconfigure(encoding="utf-8")
EXE, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
DATA = os.path.join(OUT, "data")
os.makedirs(DATA, exist_ok=True)
RESULTS = []


def check(cid, ok, detail="", warn=False):
    """warn=True: наблюдение, при провале печатается WARN и итог файла не меняется."""
    RESULTS.append({"id": cid, "pass": bool(ok), "warn": bool(warn and not ok), "detail": str(detail)[:300]})
    label = "PASS " if ok else ("WARN " if warn else "FAIL ")
    print(label + cid + ((" :: " + str(detail)[:200]) if not ok else ""), flush=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


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
            if atyp == 1:
                host = socket.inet_ntoa(c.recv(4))
            elif atyp == 3:
                host = c.recv(c.recv(1)[0]).decode()
            else:
                host = socket.inet_ntop(socket.AF_INET6, c.recv(16))
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
        except Exception:  # noqa: BLE001 - вспомогательный сервер
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


def lan_ip():
    """Адрес основного сетевого интерфейса (не loopback): ядро учитывает только такие соединения."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))  # пакеты не уходят: UDP connect только выбирает маршрут
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


def main():
    up = Socks5(("127.0.0.1", 0), Socks5Handler)
    threading.Thread(target=up.serve_forever, daemon=True).start()
    origin = http.server.ThreadingHTTPServer(("0.0.0.0", 0), Origin)
    threading.Thread(target=origin.serve_forever, daemon=True).start()
    origin_port = origin.server_address[1]
    mixed = free_port()
    tok = secrets.token_urlsafe(32)
    core = subprocess.Popen([EXE, "serve", "--listen-socket", "127.0.0.1:0", "--data", DATA], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, "core-stderr.log"), "wb"))
    core.stdin.write((tok + "\n").encode())
    core.stdin.flush()
    ready = core.stdout.readline().decode().strip()
    base = "http://" + ready.split()[1].replace("tcp://", "")

    def rpc(svc, method, body):
        req = urllib.request.Request(f"{base}/lavray.v1.{svc}/{method}", data=json.dumps(body).encode(),
                                     headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw

    try:
        rpc("SettingsService", "SetSettings", {"values": {"inbound.port": {"intValue": str(mixed)}}})
        rpc("SettingsService", "SetSettings", {"values": {"connect.health_check": {"boolValue": False}}})
        _, groups = rpc("ProfileService", "ListGroups", {})
        gid = groups["groups"][0]["id"]
        rpc("ProfileService", "ImportContent", {"content": f"socks://127.0.0.1:{up.server_address[1]}#a07-extra",
                                                "intent": "INTENT_AS_LINKS", "targetGroupId": gid})
        _, plist = rpc("ProfileService", "ListProfiles", {})
        pid = plist["profiles"][0]["id"]
        check("setup.profile", bool(pid), pid)

        # ---- T-08B: подтверждение custom-полей привязано к хэшу ----
        st, prof = rpc("ProfileService", "GetProfile", {"id": pid})
        check("custom.profile.not_confirmed", st == 200 and not prof.get("customFieldsConfirmed"), prof.get("customFieldsConfirmed"))
        st, resp = rpc("ProfileService", "PreviewCustomFields", {"profileId": pid})
        check("custom.preview.without_fields.failed_precondition", st == 400 and resp.get("code") == "failed_precondition", (st, resp))
        edited = dict(prof)
        edited["customOutboundJson"] = '{"connect_timeout": "7s"}'
        edited["customFieldsConfirmed"] = True  # клиент пытается подтвердить сам: ядро обязано проигнорировать
        st, up_resp = rpc("ProfileService", "UpdateProfile", {"profile": edited})
        check("custom.update.client_flag_ignored", st == 200 and not up_resp["profile"].get("customFieldsConfirmed"),
              up_resp.get("profile", {}).get("customFieldsConfirmed") if isinstance(up_resp, dict) else up_resp)
        st, pv = rpc("ProfileService", "PreviewCustomFields", {"profileId": pid})
        h = pv.get("customHash", "") if isinstance(pv, dict) else ""
        check("custom.preview.hash_64hex", st == 200 and len(h) == 64 and all(c in "0123456789abcdef" for c in h), (st, h))
        check("custom.preview.diff_and_keys", st == 200 and "connect_timeout" in pv.get("diff", "") and pv.get("touchedKeys"), pv.get("touchedKeys"))
        st, resp = rpc("ProfileService", "ConfirmCustomFields", {"profileId": pid, "customHash": "xyz"})
        check("custom.confirm.bad_hash.invalid_argument", st == 400 and resp.get("code") == "invalid_argument", (st, resp))
        st, resp = rpc("ProfileService", "ConfirmCustomFields", {"profileId": pid, "customHash": "0" * 64})
        check("custom.confirm.stale_hash.failed_precondition", st == 400 and resp.get("code") == "failed_precondition", (st, resp))
        st, resp = rpc("ProfileService", "ConfirmCustomFields", {"profileId": "999999", "customHash": h})
        check("custom.confirm.unknown_profile.not_found", st == 404, (st, resp))
        st, resp = rpc("ProfileService", "ConfirmCustomFields", {"profileId": pid, "customHash": h})
        check("custom.confirm.ok", st == 200 and resp.get("customFieldsConfirmed") is True, (st, resp))
        # переименование подтверждение сохраняет, правка JSON снимает
        st, cur = rpc("ProfileService", "GetProfile", {"id": pid})
        renamed = dict(cur)
        renamed["name"] = "a07-extra-renamed"
        st, r1 = rpc("ProfileService", "UpdateProfile", {"profile": renamed})
        check("custom.rename_keeps_confirmation", st == 200 and r1["profile"].get("customFieldsConfirmed") is True, r1)
        changed = dict(renamed)
        changed["customOutboundJson"] = '{"connect_timeout": "9s"}'
        st, r2 = rpc("ProfileService", "UpdateProfile", {"profile": changed})
        check("custom.edit_revokes_confirmation", st == 200 and not r2["profile"].get("customFieldsConfirmed"), r2)
        restored = dict(r2["profile"])
        restored["customOutboundJson"] = ""
        restored["customFieldsConfirmed"] = False
        rpc("ProfileService", "UpdateProfile", {"profile": restored})

        # ---- T-79: соединения и трафик на настоящем ядре ----
        st, cn = rpc("CoreService", "Connect", {"profileId": pid, "mode": "CONNECT_MODE_SYSTEM_PROXY"})
        check("conn.connect", st == 200 and cn["status"]["state"] == "CORE_STATE_CONNECTED", (st, str(cn)[:150]))
        st, lc = rpc("ConnectionService", "ListConnections", {})
        check("conn.list.empty_is_not_error", st == 200, (st, lc))
        ip = lan_ip()
        if not ip or ip.startswith("127."):
            check("conn.lan_ip_available", False, "нет адреса вне loopback: часть T-79 пропущена (BLOCKED)")
            return finish(core)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": f"http://127.0.0.1:{mixed}"}))
        total = 0
        for _ in range(3):
            with opener.open(f"http://{ip}:{origin_port}/", timeout=20) as r:
                total += len(r.read())
        check("conn.fetch.through_mixed", total == 60000, total)
        time.sleep(1.5)
        st, lc = rpc("ConnectionService", "ListConnections", {"destinationFilter": str(origin_port)})
        conns = lc.get("connections", []) if isinstance(lc, dict) else []
        check("conn.list.has_origin", st == 200 and len(conns) >= 1, (st, len(conns)))
        if conns:
            c0 = conns[0]
            check("conn.list.bytes_and_network", int(c0.get("downloadBytes", 0)) >= 20000 and c0.get("network") == "tcp",
                  {k: c0.get(k) for k in ("downloadBytes", "uploadBytes", "network", "outbound", "status")})
        st, resp = rpc("ConnectionService", "CloseConnection", {"id": "not-a-uuid"})
        check("conn.close.not_uuid.invalid_argument", st == 400 and resp.get("code") == "invalid_argument", (st, resp))
        st, resp = rpc("ConnectionService", "CloseConnection", {"id": str(uuid.uuid4())})
        check("conn.close.unknown.not_found", st == 404, (st, resp))
        st, tt = rpc("StatsService", "GetTrafficTotals", {"profileIds": [pid]})
        check("stats.totals.ok", st == 200, (st, tt))
        st, dc = rpc("CoreService", "Disconnect", {})
        sess = (dc.get("finalStats") or {}).get("session") if isinstance(dc, dict) else None
        check("conn.disconnect.final_stats", st == 200 and sess and int(sess.get("downlinkTotal", 0)) > 0, sess)
        st, hist = rpc("ConnectionService", "ListConnections", {})
        check("conn.list.after_disconnect_ok", st == 200, (st, str(hist)[:100]))
        st, summ = rpc("StatsService", "GetTrafficSummary", {"groupId": gid})
        g0 = (summ.get("groups") or [{}])[0] if isinstance(summ, dict) else {}
        check("stats.summary.session_counted", st == 200 and int(g0.get("sessionCount", 0)) >= 1 and int(g0.get("downlinkBytes", 0)) > 0, g0)
        st, resp = rpc("StatsService", "GetTrafficSummary", {"sinceMs": "-1"})
        check("stats.summary.negative_since.invalid_argument", st == 400 and resp.get("code") == "invalid_argument", (st, resp))
        def log_lines():
            _, tl = rpc("LogService", "GetTail", {"lines": 2000})
            return tl.get("lines", []) if isinstance(tl, dict) else []

        # (а) собственные сообщения LAVRay (источник не "singbox": трекер, учёт, статистика, соединения) не содержат адрес назначения
        own = [l.get("message", "") for l in log_lines() if l.get("source") != "singbox"]
        leak = [m for m in own if f":{origin_port}" in m or ip in m]
        check("log.own_messages_have_no_destinations", not leak, leak[:2])
        # (б) строки sing-box «inbound connection to <адрес>» при log.level=info (по умолчанию) ожидаемы, как в NekoBox
        sb_info = [l.get("message", "") for l in log_lines() if l.get("source") == "singbox"]
        check("log.singbox_inbound_lines_expected_at_info",
              any("inbound connection to" in m and f":{origin_port}" in m for m in sb_info),
              "при info строк sing-box с адресом не нашлось (допустимо)", warn=True)
        # log.level=warn + переподключение: таких строк быть не должно
        t1 = int(time.time() * 1000)
        st, resp = rpc("SettingsService", "SetSettings", {"values": {"log.level": {"stringValue": "warn"}}})
        check("log.level_warn.accepted", st == 200, (st, resp))
        st, cn = rpc("CoreService", "Connect", {"profileId": pid, "mode": "CONNECT_MODE_SYSTEM_PROXY"})
        check("log.level_warn.reconnect", st == 200 and cn["status"]["state"] == "CORE_STATE_CONNECTED", (st, str(cn)[:150]))
        for _ in range(2):
            with opener.open(f"http://{ip}:{origin_port}/", timeout=20) as r:
                r.read()
        time.sleep(1.5)
        sb_warn = [l.get("message", "") for l in log_lines() if l.get("source") == "singbox" and int(l.get("tsMs", 0)) >= t1]
        check("log.level_warn.no_connection_lines",
              not any("inbound connection to" in m or "outbound connection to" in m or f":{origin_port}" in m for m in sb_warn), sb_warn[:2])
        own2 = [l.get("message", "") for l in log_lines() if l.get("source") != "singbox" and int(l.get("tsMs", 0)) >= t1]
        check("log.level_warn.own_messages_have_no_destinations", not any(f":{origin_port}" in m or ip in m for m in own2), own2[:2])
        rpc("CoreService", "Disconnect", {})
        rpc("SettingsService", "SetSettings", {"values": {"log.level": {"stringValue": "info"}}})
    finally:
        pass
    return finish(core)


def finish(core):
    try:
        core.stdin.close()
        core.wait(timeout=20)
    except Exception:  # noqa: BLE001
        core.kill()
    failed = [r for r in RESULTS if not r["pass"] and not r["warn"]]
    warns = [r for r in RESULTS if r["warn"]]
    with open(os.path.join(OUT, "a07-extra-result.json"), "w", encoding="utf-8") as f:
        json.dump({"total": len(RESULTS), "failed": len(failed), "warnings": len(warns), "checks": RESULTS}, f, ensure_ascii=False, indent=1)
    print(f"A07-B: проверок {len(RESULTS)}, провалов {len(failed)}, наблюдений WARN {len(warns)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```
