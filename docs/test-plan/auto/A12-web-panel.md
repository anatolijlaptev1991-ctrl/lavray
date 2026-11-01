# A12. Веб-панель ядра (`--web-bind`): вход, CSRF, Origin, блокировка, сессии, TLS, заголовки, Playwright

| Поле | Значение |
|---|---|
| ID | A12 |
| Слой | авто |
| Время | 10–12 минут (из них около 35 секунд — ожидание пауз блокировки; сборка с интерфейсом около 3 минут; Playwright +5 минут) |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–6; сборка ядра с тегом `with_webui` (шаги 1–3 этого файла). Выполняется в группе P |
| Опасность | нет: веб-слушатель на `127.0.0.1` со случайным портом; проверки открытия порта наружу (`--web-allow-remote`) — отдельный необязательный раздел 5, на тестовом ПК |

`<TAG>` — тег выпуска под тестом, по умолчанию `v0.9.0` (`LAVRAY_REF` в `env.ps1`). Код веб-панели и шлюза (T-76) влит в `main` (на момент написания - `9b26be6`); если тега ещё нет, файл выполняется на коммите из `LAVRAY_REF`.

## Цель

Проверить веб-режим ядра (T-76, Ф7), как он описан в плане: отдельный слушатель `--web-bind` со своим шлюзом; правила адреса (`--web-allow-remote`, запрет `0.0.0.0` по умолчанию); первичная настройка администратора один раз; вход паролем; cookie сессии `lavray_session` с `HttpOnly; SameSite=Strict; Path=/` (и `Secure` по TLS); CSRF-заголовок `X-Lavray-CSRF`; сверка `Origin` и `Host`; блокировка перебора (5 неудач — паузы 1–16 с, 10 неудач — блок на 15 минут, по учётной записи, не по адресу); до 64 сессий на пользователя; простой 12 ч и предел 7 суток; смена пароля отзывает остальные сессии; самоподписанный сертификат ECDSA P-256 и отпечаток SHA-256; защитные заголовки; защита статики от обхода пути; Bearer-токен ядра по-прежнему работает для headless; без `--web-bind` панель выключена. Заодно: `GatewayService` на десктопе отвечает `INVALID_ARGUMENT`. Playwright-сценарий `web-e2e` (вход → список серверов → выход) выполняется в разделе 6.

Что здесь не проверяется: применение правил `nft` и watchdog шлюза (нужен Linux с `nft`, это задания CI `nft-check` и Go-тесты шлюза: `TestApplierRollbackOnWatchdogTrip`, `TestGatewayStatusAndPolicies`, `TestPolicyMACValidation`, `TestTProxyInboundBuilt`), пакеты OpenWrt (вне репозитория), старый хэш `pbkdf2$…` (Go-тесты `TestArgon2idVerifiesLegacyPBKDF2`, `TestLegacyRehashedOnLogin`), простой и абсолютный срок сессии по часам (Go-тест `TestSessionIdleAndAbsoluteTTL`).

## Предусловия

- Go (версия из `core/go.mod`), Node 24, Git, Python 3.12, Git Bash (для `scripts/build-webui.sh` и скрипта Playwright).
- Сеть: `registry.npmjs.org` (шаг 2), для раздела 6 — загрузка Chromium Playwright (около 150 МБ; это скачивание браузера из каталога Microsoft Playwright, отмечайте в отчёте).
- Порт 8787 свободен (раздел 6).

## Безопасность

Ядро слушает только loopback. Пароль администратора теста — тестовое значение из скрипта; настоящих паролей не вводить. Раздел 5 открывает порт на адресе интерфейса: на ПК с брандмауэром Windows может появиться окно «Разрешить доступ»; отвечайте «Отмена» (проверка делает запрос с самого ПК и без разрешения). Каталог данных теста — `C:\lavray-test\tmp\A12\run\data`, в него записываются `web-tls.pem` (ключ сертификата, права владельца) и, для не-loopback, `web-setup-code`.

## Шаги

1. Рабочая копия и сборка интерфейса. `scripts/build-webui.sh` собирает `ui/dist` и копирует его в `core/internal/web/dist`, откуда тег `with_webui` встраивает панель в бинарник.

   ```powershell
   . C:\lavray-test\env.ps1
   $wt = Join-Path $env:LAVRAY_TP_ROOT 'wt\A12'
   git -C $env:LAVRAY_SRC worktree add --detach $wt $env:LAVRAY_REF
   Set-Location $wt
   bash scripts/build-webui.sh
   "build-webui exit=$LASTEXITCODE"
   Test-Path (Join-Path $wt 'core\internal\web\dist\index.html')
   ```

   Ожидается: `build-webui exit=0`, `True`. Если `scripts/build-webui.sh` нет в выбранном коммите, файл выполнить нельзя: `BLOCKED` (T-76 не влит).

2. Сборка ядра с интерфейсом. `GOFLAGS=-mod=mod` перепишет `core/go.mod` в рабочей копии (как в A03); это допустимо.

   ```powershell
   Set-Location (Join-Path $wt 'core')
   $env:CGO_ENABLED = '0'; $env:GOFLAGS = '-mod=mod'; $env:GOPRIVATE = 'github.com/anatolijlaptev1991-ctrl/*'
   $tags = (Get-Content BUILD_TAGS -Raw).Trim() + ',with_webui'
   New-Item -ItemType Directory -Force -Path C:\lavray-test\tmp\A12 | Out-Null
   $exe = 'C:\lavray-test\tmp\A12\lavray-core-web.exe'
   go build -tags $tags -trimpath -ldflags '-s -w' -o $exe ./cmd/lavray-core/
   "build exit=$LASTEXITCODE"
   (go version -m $exe | Select-String -SimpleMatch "with_webui") -ne $null
   Remove-Item Env:GOFLAGS, Env:GOPRIVATE
   ```

   Ожидается: `build exit=0`, последняя строка `True` (тег записан в бинарнике).

3. Сохраните скрипт из раздела «Скрипт `a12_web.py`» как `C:\lavray-test\tmp\A12\a12_web.py` и запустите. Скрипт сам запускает пять ядер (отказы флагов, панель без TLS, панель с TLS, повторный запуск, панель выключена):

   ```powershell
   Set-Location C:\lavray-test
   python -I C:\lavray-test\tmp\A12\a12_web.py $exe C:\lavray-test\tmp\A12\run 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A12\run.txt | Select-Object -Last 8
   "a12 exit=$LASTEXITCODE"
   $res = Get-Content C:\lavray-test\tmp\A12\run\a12-result.json -Raw | ConvertFrom-Json
   "проверок: $($res.total), провалов: $($res.failed)"
   $res.checks | Where-Object { -not $_.pass } | Select-Object id, detail | Format-Table -AutoSize -Wrap
   ```

   Ожидается: `a12 exit=0`, `провалов: 0`. Эталон на `main` `9b26be6` (и на `feat/T-76-web`, `622a10a`): 98 проверок. Каталог `C:\lavray-test\results\A12` создайте заранее (`New-Item -ItemType Directory -Force C:\lavray-test\results\A12`).

4. Что и по каким кодам проверяет скрипт:

   | Часть | Проверки | Ожидаемые значения |
   |---|---|---|
   | 1. Флаги | запуск **отвергается** (код выхода не 0, причина в stderr): `--web-bind 0.0.0.0:0`, `192.0.2.1:0`, `:0`, `[::]:0` без `--web-allow-remote`; имя хоста `example.com:80`; порт 99999; адрес без порта; `--web-allow-remote` или `--web-tls` без `--web-bind`; `--platform freebsd`; занятый порт | в тексте `--web-allow-remote`, «имена хостов», «порт», `host:port`, `--web-bind` |
   | 2. Панель без TLS | `/healthz` = 200 `ok`; `/` отдаёт встроенный интерфейс; заголовки `Content-Security-Policy: default-src 'self'…`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy: same-origin`, без `Strict-Transport-Security`; на RPC `Cache-Control: no-store`; обход пути (`/../../`, `%2e%2e`, `\`) не отдаёт файлы; нет листинга каталога; GET на RPC → 405 `Allow: POST` | `200`, `405` |
   | 2. Статус и вход | `GetWebModeStatus` до входа: `webModeEnabled`, `firstRunSetupRequired`, `sessionTtlMinutes = 720`, `sessionAbsoluteTtlMinutes = 10080`, `setupCodeRequired = false` на loopback; счётчика сессий в ответе нет; RPC без cookie → `401 unauthenticated`; тело запроса входа > 8 КиБ отвергается | `401`, `>= 400` |
   | 2. Первый администратор | пароль короче 10 символов и имя с пробелом → `400 invalid_argument`; чужой `Origin` → `403`; успех → `200`, cookie `lavray_session` с `HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`, без `Secure` по HTTP; в ответе `csrfToken`; повторная настройка → `400 failed_precondition` | см. описание |
   | 2. CSRF и Origin | с cookie: без `Origin` → `403`, без `X-Lavray-CSRF` → `403`, неверный токен → `403`, чужой и «похожий» `Origin` (`127.0.0.1.evil.example`) → `403`; полный запрос → `200`; `WhoAmI` без CSRF → `200` и возвращает CSRF-токен; неверный `Authorization` не заменяется cookie → `401` | `403 permission_denied` |
   | 2. Bearer | токен ядра работает без cookie, CSRF и Origin; неверный, «голый» (без `Bearer `) и чужой → `401`; `WhoAmI` по Bearer = пользователь `token` | `200`, `401` |
   | 2. Вход | неверный пароль и несуществующее имя дают `401` и одинаковый текст; имя без учёта регистра; чужой `Origin` → `403` | `401 unauthenticated` |
   | 2. Сессии | список двух сессий, одна `current`; отзыв чужой → `200`, её cookie → `401`; отзыв неизвестной → `404`; `RenewSession` перевыпускает cookie; по Bearer → `400 failed_precondition`; 65-я сессия вытесняет самую старую | `404 not_found` |
   | 2. Пароль | неверный старый и слабый новый → `400 invalid_argument`; успех отзывает остальные сессии; по Bearer → `400 failed_precondition`; старый пароль отвергнут, новый принят | `revokedOtherSessions >= 1` |
   | 2. Выход | cookie стирается (`Max-Age=0/-1`), сессия мертва | `200`, `401` |
   | 2. Блокировка | 5 неудач подряд; после 5-й пауза: `429 resource_exhausted` и `Retry-After >= 1`; затем неудачи с паузами 1, 2, 4, 8, 16 с; на 10-й — блок: `429`, `Retry-After` 800–900 с; имя с другим регистром и пробелом блокируется так же; **другая учётная запись (`admin`) входит** | `429` |
   | 3. TLS | `--web-tls`: строка готовности `https://…`; отпечаток в `GetWebModeStatus` равен SHA-256 сертификата в формате `AA:BB:…`; TLS 1.2 или 1.3; ключ ECDSA P-256; файл `web-tls.pem` в каталоге данных; cookie с `Secure`; нет HSTS; после перезапуска отпечаток **не меняется**, администратор сохранён | совпадение |
   | 4. Без панели | без `--web-bind`: `WebSessionService` → `501 unimplemented`, строки `LAVRAY_WEB_READY` нет; `GatewayService` (`GetGatewayStatus`, `ListDevicePolicies`) на десктопе → `400 invalid_argument` с текстом про `--platform openwrt` | `501`, `400` |

5. Необязательно (флаг `LAVRAY_ALLOW_REMOTE_BIND=1`): открытие панели не на loopback. Сначала снимите файл кода: при `--web-allow-remote` и отсутствии администратора ядро требует **код первичной настройки** (файл `web-setup-code` в каталоге данных с правами владельца, 10 символов из алфавита без `0`, `O`, `1`, `I`, `L`), иначе первый, кто зашёл по сети, стал бы администратором.

   ```powershell
   if ($env:LAVRAY_ALLOW_REMOTE_BIND -ne '1') { 'SKIPPED: LAVRAY_ALLOW_REMOTE_BIND не равна 1'; return }
   $d = 'C:\lavray-test\tmp\A12\remote'
   New-Item -ItemType Directory -Force -Path $d | Out-Null
   $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
   $psi = New-Object System.Diagnostics.ProcessStartInfo
   $psi.FileName = $exe; $psi.Arguments = "serve --listen-socket 127.0.0.1:0 --data $d --web-bind ${ip}:0 --web-allow-remote"
   $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.UseShellExecute = $false
   $p = [System.Diagnostics.Process]::Start($psi)
   $p.StandardInput.WriteLine('a12-remote-token-0123456789abcdef0123'); $p.StandardInput.Flush()
   $lines = 1..2 | ForEach-Object { $p.StandardOutput.ReadLine() }
   $lines
   $web = ($lines | Where-Object { $_ -like 'LAVRAY_WEB_READY*' }).Split(' ')[1]
   Test-Path (Join-Path $d 'web-setup-code')
   $st = Invoke-RestMethod "$web/lavray.v1.WebSessionService/GetWebModeStatus" -Method Post -Body '{}' -ContentType 'application/json'
   "setupCodeRequired: $($st.setupCodeRequired)"
   try { Invoke-RestMethod "$web/lavray.v1.WebSessionService/SetupFirstAdmin" -Method Post -Body '{"username":"admin","password":"correct-horse-battery-1","setupCode":"AAAAAAAAAA"}' -ContentType 'application/json' } catch { $_.Exception.Response.StatusCode.value__ }
   $code = (Get-Content (Join-Path $d 'web-setup-code') -Raw).Trim()
   $body = '{"username":"admin","password":"correct-horse-battery-1","setupCode":"' + $code + '"}'
   (Invoke-WebRequest "$web/lavray.v1.WebSessionService/SetupFirstAdmin" -Method Post -Body $body -ContentType 'application/json').StatusCode
   Test-Path (Join-Path $d 'web-setup-code')
   $p.StandardInput.Close(); $p.WaitForExit(20000) | Out-Null
   Remove-Item -Recurse -Force $d
   ```

   Ожидается: строки готовности `LAVRAY_CORE_READY …` и `LAVRAY_WEB_READY http://<адрес>:<порт>`; `True` (файл кода есть); `setupCodeRequired: True`; неверный код → `403` (`permission_denied`); верный → `200`; после создания администратора `Test-Path` печатает `False` (код погашен, файл удалён); процесс завершился. Предупреждение журнала о панели без TLS («пароль и сессия идут открытым текстом») записано в журнал ядра (`GetTail`).

6. Playwright `web-e2e` (задание CI `web-e2e`): настоящий Chromium против настоящего ядра с `--web-bind 127.0.0.1:8787` и встроенным интерфейсом. Сценарии из `ui/e2e/web-login.spec.ts`: «вход → список серверов → выход» и «неверный пароль не пускает».

   ```powershell
   Set-Location (Join-Path $wt 'ui')
   npx playwright install chromium
   "playwright install exit=$LASTEXITCODE"
   $env:LAVRAY_CORE_BIN = $exe.Replace('\', '/')
   npx playwright test 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A12\playwright.txt | Select-Object -Last 12
   "playwright exit=$LASTEXITCODE"
   Remove-Item Env:LAVRAY_CORE_BIN
   ```

   Ожидается: `playwright exit=0`, строки вида `2 passed`. Скрипт `ui/e2e/start-core.sh` запускает ядро через `bash` (на Windows нужен Git Bash в `PATH`) из файла, на который указывает `LAVRAY_CORE_BIN`: это ядро из шага 2 (в нём есть и `with_webui`, и sing-box). Сценарии идут по порядку на одном ядре (первый создаёт администратора), поэтому повторный запуск без перезапуска ядра не нужен; `retries` отключены намеренно. При сбое сохраните каталоги `ui\playwright-report` и `ui\test-results` (трассы) в `results\A12\`. Если установка Chromium невозможна (нет сети, антивирус), раздел 6 получает `BLOCKED`.

## Критерии PASS/FAIL

| № | Критерий | Шаги |
|---|---|---|
| К1 | Сборка с `with_webui` прошла, тег записан в бинарнике | 1–2 |
| К2 | Скрипт: 0 провалов | 3 |
| К3 | Панель не открывается наружу без `--web-allow-remote`; занятый порт и неверный адрес отказывают запуску | часть 1 |
| К4 | Cookie сессии `HttpOnly; SameSite=Strict; Path=/` (и `Secure` по TLS), CSRF и Origin обязательны для изменяющих запросов с cookie | часть 2 и 3 |
| К5 | Блокировка по учётной записи: пауза после 5-й неудачи, блок 15 минут на 10-й, другая запись не затронута | часть 2 |
| К6 | Отпечаток TLS равен сертификату и стабилен между запусками | часть 3 |
| К7 | Bearer-токен ядра работает как раньше; без `--web-bind` панели нет | часть 2 и 4 |
| К8 | (при `LAVRAY_ALLOW_REMOTE_BIND=1`) код первичной настройки требуется и гасится | 5 |
| К9 | Playwright: 2 теста пройдены | 6 |

## Что собрать

`results\A12\run.txt`, `a12-result.json` (копия), `playwright.txt` и при сбое отчёт Playwright, отпечаток сертификата из шага 3 (он публичен). Файл `web-tls.pem` содержит закрытый ключ: **не копировать**.

## Откат / уборка

```powershell
Get-Process lavray-core, lavray-core-web -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\lavray-test\*' } | Stop-Process -Force
Remove-Item Env:CGO_ENABLED, Env:LAVRAY_CORE_BIN -ErrorAction SilentlyContinue
Set-Location C:\lavray-test
git -C $env:LAVRAY_SRC worktree remove --force $wt
git -C $env:LAVRAY_SRC worktree prune
Remove-Item -Recurse -Force C:\lavray-test\tmp\A12
Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue
```

Ожидается: порт 8787 свободен, каталогов нет. Системного отката нет.

## Отчёт

`results/A12.md` по `templates/REPORT.md`: шаги 1–6, К1–К9, число проверок. Провал К3 или К4 (панель открыта наружу, CSRF/Origin не проверяются) — `critical`; К5, К6 — `major`; К9 — `major`.

## Скрипт `a12_web.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A12: веб-панель ядра (--web-bind) на loopback: правила адреса, первый администратор, вход, cookie, CSRF, Origin,
блокировка по учётной записи, сессии, TLS и отпечаток, защитные заголовки, статика, Bearer.

Запуск: python -I a12_web.py <lavray-core.exe с тегом with_webui> <каталог результатов>
Код выхода: 0 - все проверки PASS, 1 - есть FAIL. Итог: <каталог>/a12-result.json.
Без тега with_webui корень отдаёт страницу «веб-панель не встроена»: проверки статики тогда FAIL с пояснением.
"""
import hashlib
import http.client
import json
import os
import secrets
import socket
import ssl
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
EXE, OUT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(OUT, exist_ok=True)
RESULTS = []
PW = "correct-horse-battery-1"
PW2 = "second-password-xyz-22"


def check(cid, ok, detail=""):
    RESULTS.append({"id": cid, "pass": bool(ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else "FAIL ") + cid + ("" if ok else " :: " + str(detail)[:220]), flush=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Proc:
    """Ядро с веб-слушателем; token — основной токен ядра (Bearer)."""

    def __init__(self, data, args):
        self.token = secrets.token_urlsafe(32)
        self.p = subprocess.Popen([EXE, "serve", "--listen-socket", "127.0.0.1:0", "--data", data, *args], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.p.stdin.write((self.token + "\n").encode())
        self.p.stdin.flush()
        self.ready, self.web = "", ""
        deadline = time.time() + 20
        expect_web = "--web-bind" in args
        while time.time() < deadline and not (self.ready and (self.web or not expect_web)):
            line = self.p.stdout.readline().decode().strip()
            if not line:
                break
            if line.startswith("LAVRAY_CORE_READY"):
                self.ready = line.split()[1]
            if line.startswith("LAVRAY_WEB_READY"):
                self.web = line.split()[1]

    def stop(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=20)
        except Exception:  # noqa: BLE001
            self.p.kill()

    def stderr_text(self):
        try:
            return self.p.stderr.read().decode(errors="replace")
        except Exception:  # noqa: BLE001
            return ""


def run_rejected(args, data):
    """Запуск с флагами, которые должны быть отвергнуты: возвращает (код выхода, stderr)."""
    p = subprocess.Popen([EXE, "serve", "--listen-socket", "127.0.0.1:0", "--data", data, *args], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        p.stdin.write((secrets.token_urlsafe(32) + "\n").encode())
        p.stdin.flush()
        code = p.wait(timeout=15)
    except subprocess.TimeoutExpired:
        p.kill()
        return None, ""
    return code, p.stderr.read().decode(errors="replace")


class Web:
    def __init__(self, url):
        self.tls = url.startswith("https://")
        self.host, self.port = url.split("//")[1].split(":")
        self.port = int(self.port)

    def call(self, method, path, body=None, headers=None, cookie=None, raw=None):
        h = {"Content-Type": "application/json"}
        h.update(headers or {})
        if cookie:
            h["Cookie"] = "lavray_session=" + cookie
        if self.tls:
            conn = http.client.HTTPSConnection(self.host, self.port, timeout=30, context=ssl._create_unverified_context())  # noqa: SLF001
        else:
            conn = http.client.HTTPConnection(self.host, self.port, timeout=30)
        data = raw if raw is not None else (json.dumps(body if body is not None else {}).encode() if method == "POST" else None)
        conn.request(method, path, body=data, headers=h)
        r = conn.getresponse()
        payload = r.read()
        hdrs = {k.lower(): v for k, v in r.getheaders()}
        cookies = [v for k, v in r.getheaders() if k.lower() == "set-cookie"]
        conn.close()
        try:
            parsed = json.loads(payload)
        except ValueError:
            parsed = payload
        return r.status, hdrs, parsed, cookies

    def rpc(self, svc, m, body=None, **kw):
        return self.call("POST", f"/lavray.v1.{svc}/{m}", body, **kw)

    def origin(self):
        return {"Origin": f"{'https' if self.tls else 'http'}://{self.host}:{self.port}"}

    def session(self, user, pw, **kw):
        st, hd, b, ck = self.rpc("WebSessionService", "Login", {"username": user, "password": pw}, headers=self.origin(), **kw)
        token = ""
        for c in ck:
            if c.startswith("lavray_session="):
                token = c.split(";")[0].split("=", 1)[1]
        return st, b, token, ck


def code(b):
    return b.get("code") if isinstance(b, dict) else None


def cookie_token(cookies):
    for c in cookies:
        if c.startswith("lavray_session="):
            return c.split(";")[0].split("=", 1)[1]
    return ""


def part1_flags(data):
    """1. Правила адреса и флагов (запуск должен быть отвергнут до открытия порта)."""
    cases = [
        ("all_interfaces_needs_allow_remote", ["--web-bind", "0.0.0.0:0"], "--web-allow-remote"),
        ("lan_ip_needs_allow_remote", ["--web-bind", "192.0.2.1:0"], "--web-allow-remote"),
        ("empty_host_needs_allow_remote", ["--web-bind", ":0"], "--web-allow-remote"),
        ("ipv6_any_needs_allow_remote", ["--web-bind", "[::]:0"], "--web-allow-remote"),
        ("hostname_rejected", ["--web-bind", "example.com:80"], "имена хостов"),
        ("bad_port_rejected", ["--web-bind", "127.0.0.1:99999"], "порт"),
        ("no_port_rejected", ["--web-bind", "127.0.0.1"], "host:port"),
        ("allow_remote_without_bind", ["--web-allow-remote"], "--web-bind"),
        ("tls_without_bind", ["--web-tls"], "--web-bind"),
        ("unknown_platform", ["--platform", "freebsd"], "--platform"),
    ]
    for cid, args, needle in cases:
        rc, err = run_rejected(args, os.path.join(data, "rej"))
        check("1.flags." + cid, rc not in (None, 0) and needle in err, (rc, err[:120]))
    busy = socket.socket()
    busy.bind(("127.0.0.1", 0))
    busy.listen(1)
    rc, err = run_rejected(["--web-bind", f"127.0.0.1:{busy.getsockname()[1]}"], os.path.join(data, "rej2"))
    busy.close()
    check("1.flags.busy_port_refuses_start", rc not in (None, 0), (rc, err[:120]))


def part2_plain(data):
    """2. Панель на loopback без TLS."""
    pr = Proc(data, ["--web-bind", "127.0.0.1:0"])
    check("2.ready_line", pr.web.startswith("http://127.0.0.1:"), pr.web)
    w = Web(pr.web)
    try:
        st, hd, b, _ = w.call("GET", "/healthz")
        check("2.healthz", st == 200 and b == b"ok", (st, b))
        st, hd, b, _ = w.call("GET", "/")
        html = b if isinstance(b, bytes) else json.dumps(b).encode()
        check("2.root.serves_embedded_ui", st == 200 and b"web panel is not embedded" not in html and b"id=\"root\"" in html, (st, html[:120]))
        for name, want in (("content-security-policy", "default-src 'self'"), ("x-frame-options", "DENY"), ("x-content-type-options", "nosniff"),
                           ("referrer-policy", "no-referrer"), ("cross-origin-opener-policy", "same-origin"), ("cross-origin-resource-policy", "same-origin")):
            check("2.headers." + name, want in hd.get(name, ""), hd.get(name))
        check("2.headers.no_hsts", "strict-transport-security" not in hd, hd.get("strict-transport-security"))
        st, hd2, _, _ = w.rpc("WebSessionService", "GetWebModeStatus")
        check("2.headers.on_rpc_too", hd2.get("x-frame-options") == "DENY" and hd2.get("cache-control") == "no-store", (hd2.get("x-frame-options"), hd2.get("cache-control")))
        for cid, path in (("dotdot", "/../../../../Windows/win.ini"), ("encoded", "/%2e%2e/%2e%2e/%2e%2e/Windows/win.ini"), ("assets_dotdot", "/assets/../../../go.mod"),
                          ("backslash", "/..%5c..%5cWindows%5cwin.ini")):
            st, _, b, _ = w.call("GET", path)
            body = b if isinstance(b, bytes) else json.dumps(b).encode()
            check("2.static.traversal." + cid, b"[fonts]" not in body and b"module github.com" not in body and b"[extensions]" not in body, (st, body[:60]))
        st, _, b, _ = w.call("GET", "/assets/")
        body = b if isinstance(b, bytes) else b""
        check("2.static.no_directory_listing", b"<pre>" not in body and not body.startswith(b"<a href"), (st, body[:80]))
        st, hd, b, _ = w.call("GET", "/lavray.v1.CoreService/GetStatus")
        check("2.rpc.get_method_405_allow_post", st == 405 and hd.get("allow") == "POST", (st, hd.get("allow")))
        # статус до входа
        st, _, b, _ = w.rpc("WebSessionService", "GetWebModeStatus")
        check("2.status.public_fields", st == 200 and b.get("webModeEnabled") and b.get("firstRunSetupRequired") and b.get("sessionTtlMinutes") == 720
              and b.get("sessionAbsoluteTtlMinutes") == 10080 and not b.get("tlsEnabled") and not b.get("setupCodeRequired"), b)
        check("2.status.does_not_leak_sessions", "activeSessions" not in b, b)
        # RPC без входа
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles")
        check("2.rpc.no_cookie_401", st == 401 and code(b) == "unauthenticated", (st, b))
        st, _, b, _ = w.rpc("WebSessionService", "ListSessions")
        check("2.rpc.sessions_need_login", st == 401, (st, b))
        # Bearer
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", headers={"Authorization": "Bearer " + pr.token})
        check("2.bearer.works_without_cookie_csrf_origin", st == 200, (st, b))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", headers={"Authorization": "Bearer wrong-token"})
        check("2.bearer.wrong_401", st == 401, (st, b))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", headers={"Authorization": pr.token})
        check("2.bearer.bare_token_without_scheme_401", st == 401, (st, b))
        st, _, b, _ = w.rpc("WebSessionService", "WhoAmI", headers={"Authorization": "Bearer " + pr.token})
        check("2.bearer.whoami_is_token", st == 200 and b.get("username") == "token", (st, b))
        # лимит тела до входа
        st, _, b, _ = w.rpc("WebSessionService", "Login", raw=json.dumps({"username": "a", "password": "x" * 20000}).encode(), headers=w.origin())
        check("2.public.body_limit_8kib", st != 200 and st >= 400, st)
        # первичная настройка
        for cid, body, want in (("weak_password", {"username": "admin", "password": "short"}, "invalid_argument"),
                                ("username_with_spaces", {"username": " admin", "password": PW}, "invalid_argument")):
            st, _, b, _ = w.rpc("WebSessionService", "SetupFirstAdmin", body, headers=w.origin())
            check("2.setup." + cid, st == 400 and code(b) == want, (st, b))
        st, _, b, _ = w.rpc("WebSessionService", "SetupFirstAdmin", {"username": "admin", "password": PW}, headers={"Origin": "http://evil.example"})
        check("2.setup.foreign_origin_403", st == 403, (st, b))
        st, hd, b, cks = w.rpc("WebSessionService", "SetupFirstAdmin", {"username": "admin", "password": PW}, headers=w.origin())
        token = cookie_token(cks)
        csrf = b.get("csrfToken", "") if isinstance(b, dict) else ""
        ck = next((c for c in cks if c.startswith("lavray_session=")), "")
        check("2.setup.creates_admin_and_session", st == 200 and token and csrf and b.get("username") == "admin", (st, b))
        check("2.cookie.hardened_attributes", "HttpOnly" in ck and "SameSite=Strict" in ck and "Path=/" in ck and "Secure" not in ck and "Max-Age=43200" in ck, ck)
        st, _, b, _ = w.rpc("WebSessionService", "SetupFirstAdmin", {"username": "other", "password": PW}, headers=w.origin())
        check("2.setup.second_time.failed_precondition", st == 400 and code(b) == "failed_precondition", (st, b))
        # cookie + CSRF + Origin
        H = {**w.origin(), "X-Lavray-CSRF": csrf}
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", cookie=token)
        check("2.csrf.missing_origin_403", st == 403 and code(b) == "permission_denied", (st, b))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", cookie=token, headers=w.origin())
        check("2.csrf.missing_token_403", st == 403, (st, b))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", cookie=token, headers={**w.origin(), "X-Lavray-CSRF": "wrong"})
        check("2.csrf.wrong_token_403", st == 403, (st, b))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", cookie=token, headers={"Origin": "http://evil.example", "X-Lavray-CSRF": csrf})
        check("2.origin.foreign_403", st == 403, (st, b))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", cookie=token, headers={"Origin": f"http://127.0.0.1.evil.example:{w.port}", "X-Lavray-CSRF": csrf})
        check("2.origin.lookalike_host_403", st == 403, (st, b))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", cookie=token, headers=H)
        check("2.csrf.full_request_ok", st == 200, (st, b))
        st, _, b, _ = w.rpc("WebSessionService", "WhoAmI", cookie=token, headers=w.origin())
        check("2.whoami.without_csrf_returns_csrf_after_reload", st == 200 and b.get("csrfToken") == csrf, (st, b))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", cookie=token, headers={**H, "Authorization": "Bearer wrong"})
        check("2.bearer.wrong_ignores_valid_cookie", st == 401, (st, b))
        # вход: общий текст ошибки
        st1, b1, _, _ = w.session("admin", "wrong-password-1")
        st2, b2, _, _ = w.session("no-such-user", "wrong-password-1")
        check("2.login.wrong_password_401_same_text_for_unknown_user", st1 == 401 and st2 == 401 and b1.get("message") == b2.get("message"), (b1, b2))
        st, b, token2, ck2 = w.session("ADMIN", PW)
        check("2.login.ok_second_session", st == 200 and token2 and token2 != token, (st, b))
        csrf2 = b.get("csrfToken", "") if isinstance(b, dict) else ""
        st, _, b, _ = w.rpc("WebSessionService", "Login", {"username": "admin", "password": PW}, headers={"Origin": "http://evil.example"})
        check("2.login.foreign_origin_403", st == 403, (st, b))
        # сессии
        H2 = {**w.origin(), "X-Lavray-CSRF": csrf2}
        st, _, ls, _ = w.rpc("WebSessionService", "ListSessions", cookie=token2, headers=H2)
        sess = ls.get("sessions", []) if st == 200 else []
        cur = [s for s in sess if s.get("current")]
        check("2.sessions.list_two_one_current", st == 200 and len(sess) == 2 and len(cur) == 1, (st, ls))
        other = [s for s in sess if not s.get("current")][0]["sessionId"] if len(sess) == 2 else ""
        st, _, b, _ = w.rpc("WebSessionService", "RevokeSession", {"sessionId": "no-such-session"}, cookie=token2, headers=H2)
        check("2.sessions.revoke_unknown_404", st == 404, (st, b))
        st, _, b, _ = w.rpc("WebSessionService", "RevokeSession", {"sessionId": other}, cookie=token2, headers=H2)
        check("2.sessions.revoke_other", st == 200, (st, b))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", cookie=token, headers=H)
        check("2.sessions.revoked_cookie_401", st == 401, (st, b))
        st, hd, b, cks = w.rpc("WebSessionService", "RenewSession", cookie=token2, headers=H2)
        check("2.sessions.renew_reissues_cookie", st == 200 and cookie_token(cks) == token2, (st, cks))
        st, _, b, _ = w.rpc("WebSessionService", "RenewSession", headers={"Authorization": "Bearer " + pr.token})
        check("2.sessions.renew_with_bearer_failed_precondition", st == 400 and code(b) == "failed_precondition", (st, b))
        # смена пароля отзывает остальные сессии
        st, b3, token3, _ = w.session("admin", PW)
        H3 = {**w.origin(), "X-Lavray-CSRF": b3.get("csrfToken", "")}
        for cid, body in (("wrong_old", {"oldPassword": "nope-nope-nope", "newPassword": PW2}), ("weak_new", {"oldPassword": PW, "newPassword": "short"})):
            st, _, b, _ = w.rpc("WebSessionService", "ChangePassword", body, cookie=token3, headers=H3)
            check("2.password.change_" + cid + ".invalid_argument", st == 400 and code(b) == "invalid_argument", (st, b))
        st, _, b, _ = w.rpc("WebSessionService", "ChangePassword", {"oldPassword": PW, "newPassword": PW2}, cookie=token3, headers=H3)
        check("2.password.change_revokes_others", st == 200 and int(b.get("revokedOtherSessions", 0)) >= 1, (st, b))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", cookie=token2, headers=H2)
        check("2.password.other_session_dead_after_change", st == 401, (st, b))
        st, _, b, _ = w.rpc("WebSessionService", "ChangePassword", {"oldPassword": PW, "newPassword": PW2}, headers={"Authorization": "Bearer " + pr.token})
        check("2.password.change_with_bearer_failed_precondition", st == 400 and code(b) == "failed_precondition", (st, b))
        st, _, _, _ = w.session("admin", PW)
        st2, _, token4, _ = w.session("admin", PW2)
        check("2.password.old_rejected_new_accepted", st == 401 and st2 == 200 and token4, (st, st2))
        # выход
        st, b4, token5, _ = w.session("admin", PW2)
        H5 = {**w.origin(), "X-Lavray-CSRF": b4.get("csrfToken", "")}
        st, hd, b, cks = w.rpc("WebSessionService", "Logout", cookie=token5, headers=H5)
        check("2.logout.clears_cookie", st == 200 and any("lavray_session=" in c and ("Max-Age=0" in c or "Max-Age=-1" in c or "expires" in c.lower()) for c in cks), (st, cks))
        st, _, b, _ = w.rpc("ProfileService", "ListProfiles", cookie=token5, headers=H5)
        check("2.logout.session_dead", st == 401, (st, b))
        # вытеснение: 64 сессии на пользователя
        first = w.session("admin", PW2)[2]
        for _ in range(64):
            w.session("admin", PW2)
        st, _, b, _ = w.rpc("WebSessionService", "WhoAmI", cookie=first, headers=w.origin())
        check("2.sessions.65th_evicts_oldest", st == 401, (st, b))
        # агентский токен на веб-порту не принимается
        st, _, b, _ = w.rpc("CoreService", "GetStatus", headers={"Authorization": "Bearer " + secrets.token_urlsafe(32)})
        check("2.bearer.other_token_401", st == 401, (st, b))
        # блокировка по учётной записи: 5 неудач - пауза, 10 - блок на 15 минут; другие записи не страдают
        t0 = time.time()
        for i in range(5):
            st, b, _, _ = w.session("nobody", f"wrong-password-{i}x")
            check(f"2.lockout.failure_{i + 1}_401", st == 401, (st, b))
        st, hd, b, _ = w.rpc("WebSessionService", "Login", {"username": "nobody", "password": "wrong-password-again"}, headers=w.origin())
        check("2.lockout.after_5th_pause_429_retry_after", st == 429 and code(b) == "resource_exhausted" and int(hd.get("retry-after", 0)) >= 1, (st, hd.get("retry-after"), b))
        waits = [1, 2, 4, 8, 16]
        for i, wait in enumerate(waits):
            time.sleep(wait + 0.3)
            st, b, _, _ = w.session("nobody", f"wrong-password-{i + 5}y")
            check(f"2.lockout.failure_{i + 6}_after_pause", st == 401, (st, b))
        st, hd, b, _ = w.rpc("WebSessionService", "Login", {"username": "nobody", "password": "wrong-password-last"}, headers=w.origin())
        retry = int(hd.get("retry-after", 0))
        check("2.lockout.10th_failure_blocks_15_minutes", st == 429 and 800 <= retry <= 900, (st, retry))
        st, _, b, _ = w.rpc("WebSessionService", "Login", {"username": "NOBODY ", "password": "x"}, headers=w.origin())
        check("2.lockout.name_normalized_still_blocked", st == 429, (st, b))
        st, _, token6, _ = w.session("admin", PW2)
        check("2.lockout.per_account_admin_still_allowed", st == 200 and token6, st)
        check("2.lockout.duration_s", True, f"{time.time() - t0:.0f} с")
    finally:
        pr.stop()
    return pr


def part3_tls(data):
    """3. --web-tls: HTTPS, отпечаток, Secure-cookie, стабильность сертификата между запусками."""
    pr = Proc(data, ["--web-bind", "127.0.0.1:0", "--web-tls"])
    check("3.tls.ready_line_https", pr.web.startswith("https://127.0.0.1:"), pr.web)
    w = Web(pr.web)
    fp1 = ""
    try:
        st, hd, b, _ = w.rpc("WebSessionService", "GetWebModeStatus")
        fp1 = b.get("tlsFingerprintSha256", "") if isinstance(b, dict) else ""
        ctx = ssl._create_unverified_context()  # noqa: SLF001
        with socket.create_connection((w.host, w.port), timeout=10) as s, ctx.wrap_socket(s, server_hostname=w.host) as t:
            der = t.getpeercert(binary_form=True)
            version = t.version()
        real = ":".join(f"{x:02X}" for x in hashlib.sha256(der).digest())
        check("3.tls.status_fingerprint_equals_certificate_sha256", st == 200 and b.get("tlsEnabled") is True and fp1 == real, (fp1, real))
        check("3.tls.protocol_1_2_or_newer", version in ("TLSv1.2", "TLSv1.3"), version)
        check("3.tls.key_is_ecdsa_p256", bytes.fromhex("2a8648ce3d030107") in der, "OID prime256v1 не найден")
        check("3.tls.no_hsts", "strict-transport-security" not in hd, hd.get("strict-transport-security"))
        pem = os.path.join(data, "web-tls.pem")
        check("3.tls.pem_file_in_data_dir", os.path.isfile(pem), pem)
        st, hd, b, cks = w.rpc("WebSessionService", "SetupFirstAdmin", {"username": "admin", "password": PW}, headers=w.origin())
        ck = next((c for c in cks if c.startswith("lavray_session=")), "")
        check("3.tls.cookie_is_secure", st == 200 and "Secure" in ck and "HttpOnly" in ck and "SameSite=Strict" in ck, ck)
    finally:
        pr.stop()
    pr2 = Proc(data, ["--web-bind", "127.0.0.1:0", "--web-tls"])
    try:
        w2 = Web(pr2.web)
        st, _, b, _ = w2.rpc("WebSessionService", "GetWebModeStatus")
        check("3.tls.fingerprint_stable_after_restart", st == 200 and b.get("tlsFingerprintSha256") == fp1 and fp1, (b.get("tlsFingerprintSha256"), fp1))
        check("3.tls.admin_survives_restart", st == 200 and b.get("firstRunSetupRequired") in (None, False), b)
    finally:
        pr2.stop()


def part4_no_web(data):
    """4. Без --web-bind панель выключена: WebSessionService не реализован, порта нет."""
    import urllib.request
    import urllib.error
    pr = Proc(data, [])
    try:
        base = "http://" + pr.ready.replace("tcp://", "")
        req = urllib.request.Request(base + "/lavray.v1.WebSessionService/GetWebModeStatus", data=b"{}", headers={"Authorization": "Bearer " + pr.token, "Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=10)
            st, body = 200, ""
        except urllib.error.HTTPError as e:
            st, body = e.code, e.read().decode()
        check("4.no_web_bind.unimplemented", st == 501 and "unimplemented" in body, (st, body[:80]))
        check("4.no_web_bind.no_web_ready_line", pr.web == "", pr.web)
        for m in ("GetGatewayStatus", "ListDevicePolicies"):
            req = urllib.request.Request(base + f"/lavray.v1.GatewayService/{m}", data=b"{}", headers={"Authorization": "Bearer " + pr.token, "Content-Type": "application/json"})
            try:
                urllib.request.urlopen(req, timeout=10)
                st, body = 200, ""
            except urllib.error.HTTPError as e:
                st, body = e.code, e.read().decode()
            check(f"4.desktop.gateway.{m}.invalid_argument", st == 400 and "invalid_argument" in body and "--platform openwrt" in body, (st, body[:100]))
    finally:
        pr.stop()


def main():
    base = os.path.join(OUT, "data")
    for sub in ("rej", "rej2", "plain", "tls", "off"):
        os.makedirs(os.path.join(base, sub), exist_ok=True)
    for fn, sub in ((part1_flags, ""), (part2_plain, "plain"), (part3_tls, "tls"), (part4_no_web, "off")):
        try:
            fn(os.path.join(base, sub) if sub else base)
        except Exception as e:  # noqa: BLE001
            import traceback
            check(f"{fn.__name__}.exception", False, repr(e) + " @ " + traceback.format_exc().strip().splitlines()[-3].strip())
    failed = [r for r in RESULTS if not r["pass"]]
    with open(os.path.join(OUT, "a12-result.json"), "w", encoding="utf-8") as f:
        json.dump({"total": len(RESULTS), "failed": len(failed), "checks": RESULTS}, f, ensure_ascii=False, indent=1)
    print(f"A12: проверок {len(RESULTS)}, провалов {len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```
