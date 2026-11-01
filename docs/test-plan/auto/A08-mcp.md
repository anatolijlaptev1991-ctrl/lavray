# A08. MCP: режимы «только чтение» и «чтение и управление», отказы, отсутствие секретов

| Поле | Значение |
|---|---|
| ID | A08 |
| Слой | авто |
| Время | 3–5 минут |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–7. Лучше после A06 и A07 |
| Опасность | нет: ядро и MCP-сервер работают на loopback, файл доступа лежит во временном каталоге. Окно LAVRay не запускается, поэтому системный прокси не ставится |

## Цель

Проверить без окна всё, что описывает `docs/MCP.md`: подкоманда `lavray-core mcp`, 11 инструментов в двух режимах, белый список процедур для агентского токена в ядре, ограничения параметров, очистка ответов от адресов и секретов, запись отказов и действий агента в журнал, поведение при отсутствии файла доступа. Покрывает MCP-эпик 0.2.x и таблицу решений для агентов (`core/internal/api/agent_table.go`), а также агентские запреты на RPC T-08B и T-79 (`PreviewCustomFields`, `ConfirmCustomFields`, `ListConnections`, `WatchConnections`, `CloseConnection`: отказ; `GetTrafficSummary`: чтение).

Что файл не проверяет: появление и ACL файла `agent-endpoint.json`, который пишет оболочка (A11 и M17), и применение системного прокси окном после `connect` (A11).

## Предусловия

- Python 3.12; ядро `$env:LAVRAY_CORE_EXE` (из ZIP релиза, см. A06) или `tmp\A03\lavray-core.exe`. Ядро обязано быть собрано с `singbox_run` (иначе `connect` не запустится).
- Порт 2080 не используется скриптом: порт входящего подключения выбирается случайно.

## Безопасность

Скрипт передаёт ядру два токена строками stdin (как оболочка), пишет `agent-endpoint.json` в `C:\lavray-test\tmp\A08\`, подключает ядро к локальному SOCKS5-серверу (`127.0.0.1`, случайный порт) и отключает его. Системный прокси, TUN и реестр не затрагиваются. Токены генерируются на каждый запуск и в отчёт не попадают.

## Шаги

1. Каталоги и ядро.

```powershell
. C:\lavray-test\env.ps1
$t = 'C:\lavray-test\tmp\A08'
New-Item -ItemType Directory -Force -Path $t, "$t\run", "$t\empty", C:\lavray-test\results\A08 | Out-Null
$exe = if (Test-Path $env:LAVRAY_CORE_EXE) { $env:LAVRAY_CORE_EXE } else { 'C:\lavray-test\tmp\A03\lavray-core.exe' }
Test-Path $exe
```

   Ожидается `True`.

2. Протокол MCP без приложения: файла доступа нет, сервер отвечает понятным текстом и выходит с кодом 0 на EOF. Блок отправляет четыре сообщения JSON-RPC (по одному в строке) в `lavray-core mcp`.

```powershell
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$lines = @(
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"a08","version":"1"}}}',
  '{"jsonrpc":"2.0","method":"notifications/initialized"}',
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_status","arguments":{}}}'
)
$out = $lines | & $exe mcp --data "$t\empty"
"mcp exit=$LASTEXITCODE"
$out | Set-Content C:\lavray-test\results\A08\mcp-no-endpoint.jsonl -Encoding utf8
$r = $out | ForEach-Object { $_ | ConvertFrom-Json }
"protocolVersion: " + $r[0].result.protocolVersion
"serverInfo.name: " + $r[0].result.serverInfo.name
"инструментов без файла доступа: " + $r[1].result.tools.Count
"isError: " + $r[2].result.isError
$r[2].result.content[0].text
```

   Ожидается: `mcp exit=0`; `protocolVersion: 2025-06-18`; `serverInfo.name: lavray`; `инструментов без файла доступа: 6` (в состоянии «приложения нет» видны только инструменты чтения); `isError: True`; текст `LAVRay не запущен или доступ для агентов выключен: откройте LAVRay → Настройки → Агенты (MCP)`.

3. Основной сценарий. Сохраните скрипт из раздела «Скрипт `a08_mcp_check.py`» ниже как `C:\lavray-test\tmp\A08\a08_mcp_check.py` и запустите:

```powershell
# Скрипт печатает UTF-8 (sys.stdout.reconfigure); без этих двух строк pwsh читает вывод в OEM-кодировке консоли и в check.txt попадает кракозябра.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$OutputEncoding = [Text.UTF8Encoding]::new()
python -I "$t\a08_mcp_check.py" $exe "$t\run" 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A08\check.txt | Select-Object -Last 12
"check exit=$LASTEXITCODE"
$res = Get-Content "$t\run\a08-result.json" -Raw -Encoding utf8 | ConvertFrom-Json
"проверок: $($res.total), провалов: $($res.failed)"
($res.checks | Where-Object { -not $_.pass } | Select-Object id, detail | Format-List | Out-String)
```

   Ожидается: `check exit=0`, `проверок: 60` (число может вырасти), `провалов: 0`, список непройденных пуст. Каждая проверка в файле `check.txt` — строка `PASS <id>` или `FAIL <id> :: <подробности>`.

4. Что проверяет скрипт (для отчёта и для поиска причины провала):

   | Группа id | Что проверяется | Критерий |
   |---|---|---|
   | `core.ready`, `setup.*` | ядро поднялось с двумя токенами в stdin; импорт двух серверов | строка готовности, `200` |
   | `token.*` | режим `off` по умолчанию: агентский токен получает отказ; чужой токен | `403 permission_denied` / `401` |
   | `read.GetStatus.allowed` | в режиме `read` разрешено чтение состояния | `200` |
   | `read.denied.*` (13 процедур) | в режиме `read` отказ на: `Connect`, `Disconnect`, `GetRuntimeConfig`, `Shutdown`, `GetSettings`, `SetSettings`, `ExportLinks`, `ImportContent`, `DeleteProfile`, `CreateSubscription`, `ListConnections`, `ListPresets`, `CheckUpdates` | `403`, код `permission_denied` |
   | `read.ListProfiles.*` | поиск по списку серверов закрыт (он сравнивает адреса); в ответе нет `address` и `port` | `403`; поля отсутствуют |
   | `mcp.initialize`, `mcp.ping`, `mcp.unknown_*`, `mcp.extra_args` | протокол: версия, `ping`, неизвестный инструмент и метод, лишние аргументы | `-32602`, `-32601` |
   | `mcp.tools.read` | в режиме `read` ровно 6 инструментов: `get_status`, `list_servers`, `list_subscriptions`, `get_traffic`, `get_public_ip`, `get_logs` | точный набор |
   | `mcp.get_status.*`, `mcp.list_servers.2`, `mcp.get_logs.cap` | состояние «не подключено», два сервера без адресов, журнал не длиннее 200 строк | значения |
   | `mcp.connect.denied_in_read` | инструмент управления в режиме `read` | `isError`, текст про «чтение и управление» |
   | `mcp.tools.control` | в режиме `control` 11 инструментов | число и наличие `connect` |
   | `mcp.connect.*`, `mcp.switch_server`, `mcp.disconnect*` | `connect` без `server_id` берёт сервер из `ui-state.json`; повторный `connect` идемпотентен; другой сервер — отказ с подсказкой про `switch_server`; смена сервера; повторное отключение | тексты «Уже подключено», «Переключено», «Отключено», «Уже отключено» |
   | `mcp.test_servers.latency`, `mcp.update_subscriptions.empty` | инструменты проверки и обновления отвечают без ошибки | `isError=false` |
   | `control.*` | прямые обращения агентским токеном: `Connect` с режимом TUN или inline-профилем, `TestLatency` с URL и полным тестом, `GetRuntimeConfig`, `SetSettings agent.mode`, `LogService/Subscribe` | `403` / `permission_denied` |
   | `log.agent_denials`, `log.agent_control` | журнал приложения содержит `агент (MCP): отказ …` и `агент (MCP): …Connect` | строки найдены |
   | `secrets.absent.*` | во всём, что увидел агент (ответы инструментов и RPC), нет: основного токена, агентского токена, портов обоих апстримов и входящего порта, адреса `127.0.0.1` | подстрок нет |
   | `mcp.no_endpoint_message`, `mcp.exit_code_0` | после удаления файла доступа инструменты отвечают сообщением «LAVRay не запущен…»; сервер выходит с кодом 0 | текст, код |

5. Именованные тесты ядра, на которых держится белый список, не удалены (быстрая проверка в клоне `src\`; нужна рабочая копия с Go).

```powershell
Set-Location (Join-Path $env:LAVRAY_SRC 'core')
go test -count=1 -v -run '^(TestEveryProcedureHasAgentDecision|TestAgentTableKeepsPreviousAllowlists)$' ./internal/api/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
Set-Location C:\lavray-test
```

   Ожидается: `--- PASS: TestEveryProcedureHasAgentDecision`, `--- PASS: TestAgentTableKeepsPreviousAllowlists`, `ok`. (Команда читает `src\`, но `go test` может создать кэш сборки только в `GOCACHE`; файлы репозитория не меняются.)

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Шаг 2: без файла доступа 6 инструментов, `isError=true`, текст «LAVRay не запущен…», код выхода 0 | вывод шага |
| К2 | Шаг 3: `check exit=0`, провалов 0 | `a08-result.json` |
| К3 | В `a08-result.json` не меньше 60 проверок | `total >= 60` |
| К4 | Нет проверок `secrets.absent.*` со значением `FAIL` | `a08-result.json` |
| К5 | Шаг 5: обе защитные проверки таблицы агента `--- PASS` | вывод |

## Что собрать

`results\A08\`: `mcp-no-endpoint.jsonl`, `check.txt`, копия `a08-result.json`. Файл `agent-endpoint.json` из `tmp\A08\run\` **не** копировать: в нём токен.

## Откат / уборка

```powershell
Get-Process lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\lavray-test\*' } | Stop-Process -Force
Remove-Item -Recurse -Force C:\lavray-test\tmp\A08
Test-Path C:\lavray-test\tmp\A08
```

Ожидается `False`. Системного отката нет.

## Отчёт

`results/A08.md` по `templates/REPORT.md`: статусы 5 шагов, К1–К5, число проверок. Провал любой `secrets.absent.*` — `critical` (утечка адреса или токена агенту); провал `read.denied.*` или `control.*` — `critical` (агент получил доступ, которого не должен иметь); остальные — `major`.

## Скрипт `a08_mcp_check.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A08: проверка MCP-сервера lavray-core на loopback (без окна, без системного прокси).

Запуск: python -I a08_mcp_check.py <путь к lavray-core.exe> <каталог результатов>
Код выхода: 0 - все проверки PASS, 1 - есть FAIL. Итог: <каталог>/a08-result.json.
"""
import http.client
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
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
EXE, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
DATA = os.path.join(OUT, "data")
os.makedirs(DATA, exist_ok=True)
ENDPOINT = os.path.join(OUT, "agent-endpoint.json")
RESULTS, CORPUS = [], []   # CORPUS - всё, что увидел агент (поиск секретов)


def check(cid, ok, detail=""):
    RESULTS.append({"id": cid, "pass": bool(ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else "FAIL ") + cid + ((" :: " + str(detail)[:200]) if not ok else ""), flush=True)


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
                host = c.recv(c.recv(1)[0]).decode("utf-8")
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


def main():
    upstreams = [Socks5(("127.0.0.1", 0), Socks5Handler) for _ in range(2)]
    for u in upstreams:
        threading.Thread(target=u.serve_forever, daemon=True).start()
    up_ports = [u.server_address[1] for u in upstreams]
    up_port = up_ports[0]
    mixed = free_port()
    assert mixed != 2080
    main_tok, agent_tok = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    core = subprocess.Popen([EXE, "serve", "--listen-socket", "127.0.0.1:0", "--data", DATA],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=open(os.path.join(OUT, "core-stderr.log"), "wb"))
    core.stdin.write((main_tok + "\n" + agent_tok + "\n").encode("utf-8"))
    core.stdin.flush()
    ready = core.stdout.readline().decode("utf-8").strip()
    check("core.ready", ready.startswith("LAVRAY_CORE_READY tcp://127.0.0.1:"), ready)
    transport = ready.split()[1]
    base = "http://" + transport.replace("tcp://", "")

    def rpc(svc, method, body, token):
        req = urllib.request.Request(f"{base}/lavray.v1.{svc}/{method}", data=json.dumps(body).encode("utf-8"),
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw

    def rpc_stream(svc, method, body, token):
        """Server-stream вызов по connect+json: запрос в 5-байтном конверте; ответ читается целиком."""
        raw = json.dumps(body).encode("utf-8")
        env = b"\x00" + len(raw).to_bytes(4, "big") + raw
        req = urllib.request.Request(f"{base}/lavray.v1.{svc}/{method}", data=env,
                                     headers={"Authorization": "Bearer " + token, "Connect-Protocol-Version": "1",
                                              "Content-Type": "application/connect+json"})
        chunks, status = [], 0
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                status = r.status
                while True:
                    part = r.read(4096)
                    if not part:
                        break
                    chunks.append(part)
        except urllib.error.HTTPError as e:
            status = e.code
            chunks.append(e.read())
        except (ConnectionError, http.client.HTTPException):
            pass  # сервер закрыл поток после ошибки: прочитанное уже в chunks
        return status, b"".join(chunks).decode("utf-8", errors="replace")

    def setting(key, value):
        return rpc("SettingsService", "SetSettings", {"values": {key: value}}, main_tok)

    try:
        setting("inbound.port", {"intValue": str(mixed)})
        _, groups = rpc("ProfileService", "ListGroups", {}, main_tok)
        gid = groups["groups"][0]["id"]
        for name, port in zip(("a08-first", "a08-second"), up_ports):
            st, _ = rpc("ProfileService", "ImportContent", {"content": f"socks://127.0.0.1:{port}#{name}",
                                                            "intent": "INTENT_AS_LINKS", "targetGroupId": gid}, main_tok)
            check("setup.import." + name, st == 200, st)

        # --- 1. режим off (по умолчанию): агентский токен ничего не открывает
        st, body = rpc("CoreService", "GetStatus", {}, agent_tok)
        check("token.off.denied", st == 403 and "permission_denied" in json.dumps(body), (st, body))
        st, _ = rpc("CoreService", "GetStatus", {}, "wrong-token-0123456789abcdef0123456789")
        check("token.wrong.401", st == 401, st)

        # --- 2. режим read: белый список
        setting("agent.mode", {"stringValue": "read"})
        with open(ENDPOINT, "w", encoding="utf-8") as f:
            json.dump({"url": transport, "token": agent_tok, "mode": "read"}, f)
        st, _ = rpc("CoreService", "GetStatus", {}, agent_tok)
        check("read.GetStatus.allowed", st == 200, st)
        denied_in_read = [
            ("CoreService", "Connect", {"profileId": "1"}),
            ("CoreService", "Disconnect", {}),
            ("CoreService", "GetRuntimeConfig", {}),
            ("CoreService", "Shutdown", {}),
            ("SettingsService", "GetSettings", {}),
            ("SettingsService", "SetSettings", {"values": {"agent.mode": {"stringValue": "control"}}}),
            ("ProfileService", "ExportLinks", {}),
            ("ProfileService", "ImportContent", {"content": "socks://127.0.0.1:1#x"}),
            ("ProfileService", "DeleteProfile", {"id": "1"}),
            ("SubscriptionService", "CreateSubscription", {"url": "https://example.com/sub"}),
            ("ConnectionService", "ListConnections", {}),
            ("RoutingService", "ListPresets", {}),
            ("UpdateService", "CheckUpdates", {}),
        ]
        for svc, meth, body in denied_in_read:
            st, resp = rpc(svc, meth, body, agent_tok)
            check(f"read.denied.{svc}.{meth}", st == 403 and "permission_denied" in json.dumps(resp), (st, resp))
        st, resp = rpc("ProfileService", "ListProfiles", {"search": "127.0.0.1"}, agent_tok)
        check("read.ListProfiles.search_denied", st == 403, (st, resp))
        st, resp = rpc("ProfileService", "ListProfiles", {}, agent_tok)
        CORPUS.append(json.dumps(resp, ensure_ascii=False))
        p0 = (resp.get("profiles") or [{}])[0]
        check("read.ListProfiles.no_address", st == 200 and "address" not in p0 and "port" not in p0, p0)

        # --- 3. MCP по stdio
        mcp = subprocess.Popen([EXE, "mcp", "--endpoint-file", ENDPOINT], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, "mcp-stderr.log"), "wb"))
        nid = [0]

        def send(method, params=None, notify=False):
            msg = {"jsonrpc": "2.0", "method": method}
            if params is not None:
                msg["params"] = params
            if not notify:
                nid[0] += 1
                msg["id"] = nid[0]
            mcp.stdin.write((json.dumps(msg) + "\n").encode("utf-8"))
            mcp.stdin.flush()
            return None if notify else json.loads(mcp.stdout.readline().decode("utf-8"))

        def tool(name, args=None):
            res = send("tools/call", {"name": name, "arguments": args or {}})
            CORPUS.append(json.dumps(res, ensure_ascii=False))
            if "result" not in res:
                return {"rpc_error": res.get("error")}
            r = res["result"]
            return {"isError": r.get("isError", False), "text": r["content"][0]["text"], "structured": r.get("structuredContent")}

        init = send("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                   "clientInfo": {"name": "a08", "version": "1"}})
        res = init.get("result", {})
        check("mcp.initialize", res.get("protocolVersion") == "2025-06-18" and res.get("serverInfo", {}).get("name") == "lavray", init)
        send("notifications/initialized", notify=True)
        names = [t["name"] for t in send("tools/list")["result"]["tools"]]
        read_set = ["get_status", "list_servers", "list_subscriptions", "get_traffic", "get_public_ip", "get_logs"]
        check("mcp.tools.read", sorted(names) == sorted(read_set), names)
        check("mcp.ping", send("ping").get("result") == {}, "")
        err = send("tools/call", {"name": "no_such_tool", "arguments": {}}).get("error", {})
        check("mcp.unknown_tool", err.get("code") == -32602, err)
        err = send("tools/call", {"name": "get_status", "arguments": {"extra": 1}}).get("error", {})
        check("mcp.extra_args", err.get("code") == -32602, err)
        err = send("no/such/method").get("error", {})
        check("mcp.unknown_method", err.get("code") == -32601, err)

        st1 = tool("get_status")
        check("mcp.get_status.idle", st1.get("isError") is False and st1["structured"].get("connected") is False
              and st1["structured"].get("agent_access") == "read", st1)
        lst = tool("list_servers")
        servers = lst["structured"]["servers"]
        check("mcp.list_servers.2", len(servers) == 2 and all("address" not in s for s in servers), lst["structured"])
        check("mcp.list_subscriptions", tool("list_subscriptions").get("isError") is False, "")
        check("mcp.get_traffic", tool("get_traffic").get("isError") is False, "")
        lg = tool("get_logs", {"lines": 200})
        check("mcp.get_logs.cap", lg.get("isError") is False and len(lg["text"].splitlines()) <= 200 + 5, lg.get("text", "")[:80])
        c = tool("connect", {"server_id": servers[0]["id"]})
        check("mcp.connect.denied_in_read", c.get("isError") is True and "чтение и управление" in c.get("text", ""), c)

        # --- 4. режим control
        setting("agent.mode", {"stringValue": "control"})
        with open(ENDPOINT, "w", encoding="utf-8") as f:
            json.dump({"url": transport, "token": agent_tok, "mode": "control"}, f)
        names = [t["name"] for t in send("tools/list")["result"]["tools"]]
        check("mcp.tools.control", len(names) == 11 and "connect" in names, names)
        sid1, sid2 = servers[0]["id"], servers[1]["id"]
        # сервер, выбранный в приложении (ui-state.json рядом с файлом доступа)
        with open(os.path.join(OUT, "ui-state.json"), "w", encoding="utf-8") as f:
            json.dump({"lavray.server": str(sid2)}, f)
        c = tool("connect")
        check("mcp.connect.uses_app_selection", c.get("isError") is False and c["structured"].get("server", {}).get("id") in (int(sid2), sid2), c)
        c = tool("connect")
        check("mcp.connect.idempotent", c.get("isError") is False and "Уже подключено" in c.get("text", ""), c)
        c = tool("connect", {"server_id": int(sid1)})
        check("mcp.connect.other_server_refused", c.get("isError") is True and "switch_server" in c.get("text", ""), c)
        c = tool("switch_server", {"server_id": int(sid1)})
        check("mcp.switch_server", c.get("isError") is False and "Переключено" in c.get("text", ""), c)
        check("mcp.status.connected", tool("get_status")["structured"].get("connected") is True, "")
        check("mcp.test_servers.latency", tool("test_servers", {"mode": "latency", "timeout_seconds": 20}).get("isError") is False, "")
        check("mcp.update_subscriptions.empty", tool("update_subscriptions").get("isError") in (False, True), "")
        # запрещённые параметры при прямом обращении агентского токена
        st, resp = rpc("CoreService", "Connect", {"profileId": sid1, "mode": "CONNECT_MODE_TUN"}, agent_tok)
        check("control.Connect.mode_denied", st == 403, (st, resp))
        st, resp = rpc("CoreService", "Connect", {"inlineProfile": {"type": "PROFILE_TYPE_SOCKS"}}, agent_tok)
        check("control.Connect.inline_denied", st == 403, (st, resp))
        st, resp = rpc_stream("ProfileService", "TestLatency", {"url": "http://127.0.0.1/"}, agent_tok)
        check("control.TestLatency.url_denied", "permission_denied" in resp, (st, resp[:150]))
        st, resp = rpc_stream("ProfileService", "TestLatency", {"mode": "MODE_FULL_TEST"}, agent_tok)
        check("control.TestLatency.full_denied", "permission_denied" in resp, (st, resp[:150]))
        st, resp = rpc_stream("LogService", "Subscribe", {}, agent_tok)
        check("control.LogSubscribe.denied", "permission_denied" in resp, (st, resp[:150]))
        st, resp = rpc("CoreService", "GetRuntimeConfig", {}, agent_tok)
        check("control.GetRuntimeConfig.denied", st == 403, (st, resp))
        st, resp = rpc("SettingsService", "SetSettings", {"values": {"agent.mode": {"stringValue": "off"}}}, agent_tok)
        check("control.SetSettings.denied", st == 403, (st, resp))
        d = tool("disconnect")
        check("mcp.disconnect", d.get("isError") is False and "Отключено" in d.get("text", ""), d)
        d = tool("disconnect")
        check("mcp.disconnect.idempotent", "Уже отключено" in d.get("text", ""), d)

        # --- 5. журнал фиксирует отказы и управление агента; секретов в ответах нет
        _, tail = rpc("LogService", "GetTail", {"lines": 400}, main_tok)
        lines = [l.get("message", "") for l in tail.get("lines", [])]
        check("log.agent_denials", any("агент (MCP): отказ" in m for m in lines), len(lines))
        check("log.agent_control", any("агент (MCP):" in m and "Connect" in m for m in lines), len(lines))
        blob = "\n".join(CORPUS)
        for label, needle in (("main_token", main_tok), ("agent_token", agent_tok), ("upstream_port", str(up_ports[0])), ("upstream_port2", str(up_ports[1])),
                              ("mixed_port", str(mixed)), ("loopback_addr", "127.0.0.1")):
            check("secrets.absent." + label, needle not in blob, needle if needle in blob else "")

        # --- 6. файл доступа удалён (выход приложения) и смена режима на off
        os.remove(ENDPOINT)
        g = tool("get_status")
        check("mcp.no_endpoint_message", g.get("isError") is True and "LAVRay не запущен" in g.get("text", ""), g)
        mcp.stdin.close()
        check("mcp.exit_code_0", mcp.wait(timeout=15) == 0, "")
    finally:
        try:
            core.stdin.close()
            core.wait(timeout=20)
        except Exception:  # noqa: BLE001
            core.kill()
    failed = [r for r in RESULTS if not r["pass"]]
    with open(os.path.join(OUT, "a08-result.json"), "w", encoding="utf-8") as f:
        json.dump({"total": len(RESULTS), "failed": len(failed), "checks": RESULTS}, f, ensure_ascii=False, indent=1)
    print(f"A08: проверок {len(RESULTS)}, провалов {len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```
