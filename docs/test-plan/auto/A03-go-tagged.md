# A03. Go: тесты с настоящим sing-box (теги `core/BUILD_TAGS`)

| Поле | Значение |
|---|---|
| ID | A03 |
| Слой | авто |
| Время | 6–10 минут (первая сборка форка sing-box с нуля — до 5 минут) |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–6. Файл A02 желателен до A03 (тогда кэш модулей уже тёплый), но не обязателен |
| Опасность | нет: только loopback и временные каталоги. `go.mod` и `go.sum` меняются, но только в собственной рабочей копии `wt\A03` |

## Цель

Выполнить то, что делает задание `core-run` CI: собрать ядро с настоящим раннером sing-box, убедиться, что в бинарнике записаны ровно теги из `core/BUILD_TAGS`, и прогнать сквозные тесты пакетов `internal/inst` и `internal/api`, которые поднимают живой sing-box. Здесь проверяются туннель (T-01), REALITY/uTLS (T-02), протоколы VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC (E2E), учёт соединений и трафика T-79 на настоящем ядре, проверка связи после подключения (0.2.1), занятый порт входящего подключения, а также golden-эталоны, которые проверяет сам sing-box (`singbox_check`).

Теги берутся из файла `core/BUILD_TAGS` (на `97624d6`: `singbox_run,with_quic,with_gvisor,with_utls`). Копировать список в команды нельзя: он читается из файла.

## Предусловия

- Go, Git (см. `01-ENVIRONMENT.md`, раздел 5), сеть: скачивание форка `github.com/anatolijlaptev1991-ctrl/sing-box` (публичный репозиторий) и его зависимостей.
- Тесты не используют TUN и не требуют прав администратора.
- `-race` не используется (`CGO_ENABLED=0`).

## Безопасность

Тесты слушают `127.0.0.1` на случайных портах. Системный прокси, TUN, реестр, порт 2080 не затрагиваются. **`GOFLAGS=-mod=mod` переписывает `core/go.mod` и может переписать `core/go.sum`** (на `97624d6` модуль `golang.org/x/sys` перемещается из косвенных зависимостей в прямые). Поэтому файл работает только в `wt\A03` и в конце возвращает эти файлы командой из раздела «Откат». Переменные окружения `GOPRIVATE`, `GOFLAGS`, `CGO_ENABLED` задаются только в сессии этого файла.

## Шаги

1. Рабочая копия и окружение.

```powershell
. C:\lavray-test\env.ps1
$wt = Join-Path $env:LAVRAY_TP_ROOT 'wt\A03'
git -C $env:LAVRAY_SRC worktree add --detach $wt $env:LAVRAY_REF
Set-Location (Join-Path $wt 'core')
$env:GOPRIVATE = 'github.com/anatolijlaptev1991-ctrl/*'
$env:GOFLAGS = '-mod=mod'
$env:CGO_ENABLED = '0'
$tags = (Get-Content BUILD_TAGS -Raw).Trim()
"tags=$tags"
```

   Ожидается: `tags=singbox_run,with_quic,with_gvisor,with_utls` (порядок и состав берутся из файла; пустой список — `FAIL`).

2. Закреплённая версия форка из `go.mod` (в команде её не зашивать).

```powershell
$m = Select-String -Path go.mod -Pattern '^replace github\.com/sagernet/sing-box => (\S+) (\S+)$'
$forkModule = $m.Matches[0].Groups[1].Value
$forkVersion = $m.Matches[0].Groups[2].Value
"$forkModule@$forkVersion"
```

   Ожидается на `97624d6`: `github.com/anatolijlaptev1991-ctrl/sing-box@v1.14.2-0.20261031133806-35f3fd09bcf9`. Если строки `replace` нет, `Matches[0]` падает: это `FAIL` (форк не закреплён).

3. Подтянуть форк и привести `go.mod` в порядок (как в CI; `go get` может вернуть ненулевой код, CI это допускает).

```powershell
go get "$forkModule@$forkVersion"
"get exit=$LASTEXITCODE (допустим любой)"
go mod tidy
"tidy exit=$LASTEXITCODE"
git diff --stat -- go.mod go.sum
```

   Ожидается: `tidy exit=0`. Вывод `git diff --stat` сохраните в отчёт: расхождения небольшие (единицы строк `go.mod`, при необходимости строки `go.sum`). Крупное изменение (десятки строк, новые прямые зависимости) — запишите как `minor`: `go.mod` в репозитории не tidy.

4. Сборка ядра с настоящим раннером, как в релизном workflow.

```powershell
New-Item -ItemType Directory -Force -Path C:\lavray-test\tmp\A03 | Out-Null
$exe = 'C:\lavray-test\tmp\A03\lavray-core.exe'
go build -tags $tags -trimpath -ldflags '-s -w' -o $exe ./cmd/lavray-core/
"build exit=$LASTEXITCODE"
(Get-Item $exe).Length
```

   Ожидается: `build exit=0`, размер файла от 40 до 80 МБ (на эталоне 54 317 056 байт). Размер меньше 35 МБ означает, что sing-box не вошёл в сборку (`NopRunner`): `FAIL`.

5. В бинарнике записаны теги, форк закреплён, сборка без cgo.

```powershell
$info = (go version -m $exe) -join "`n"
$info | Select-String -SimpleMatch "-tags=$tags" -Quiet
$info | Select-String -SimpleMatch "=> github.com/anatolijlaptev1991-ctrl/sing-box" -Quiet
$info | Select-String -SimpleMatch "CGO_ENABLED=0" -Quiet
$info | Select-String -SimpleMatch "-trimpath=true" -Quiet
($info -split "`n")[0]
```

   Ожидается: четыре `True`; первая строка — `...lavray-core.exe: go1.27.0` (версия не ниже указанной в `go.mod`). Строку `vcs.modified=true` в этой локальной сборке игнорируйте (она вызвана правкой `go.mod` на шаге 3); для ассета релиза ожидается `vcs.modified=false`, это проверяет A06.

6. Тесты с тегами: `internal/inst` и `internal/api`. Именно эта команда стоит в CI.

```powershell
go test -tags $tags ./internal/inst/ ./internal/api/ -count=1 -timeout 300s 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A03-go-test-tagged.txt
"tagged exit=$LASTEXITCODE"
```

   Ожидается: `tagged exit=0` и две строки `ok` (эталон: `inst` около 8 с, `api` около 43 с). Любая строка `FAIL` или `panic` — `FAIL`.

7. Число тестов с тегами не уменьшилось (без тегов эти пакеты содержат 20 и 181 тестов, см. A02).

```powershell
foreach ($p in 'internal/inst','internal/api') {
  $n = (go test -tags $tags -list '^(Test|Fuzz)' "./$p/" 2>&1 | Select-String -Pattern '^(Test|Fuzz)').Count
  '{0,-14} {1}' -f $p, $n
}
```

   Ожидается не меньше эталона: `internal/inst` 53, `internal/api` 194.

8. Ключевые сквозные тесты не пропущены и проходят (защита от «зелёный, потому что пропущен»).

```powershell
go test -tags $tags -count=1 -v -run '^(TestE2EVMessWebSocketTLSALPNh2|TestE2EVlessGRPCTLSALPNh2|TestE2EVlessRealityVision|TestE2ETrojanTLS|TestE2EShadowsocks|TestE2EHysteria2|TestE2ETUIC|TestSingBoxRunnerStartsUTLSProfiles|TestSingBoxRunnerDialProxy|TestSingBoxRunnerReportsBusyPortAsAddrInUse|TestSingBoxRunnerStopIsSafeToRepeat|TestTrafficManagerAvailableViaPlatformWriter|TestCloseConnectionClosesRealSocket|TestRunnerTrafficNilAfterStop|TestRunnerRestartClearsHistory|TestTestInstanceCreatesNoCacheFile|TestTrafficSourceRace)$' ./internal/inst/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
go test -tags $tags -count=1 -v -run '^(TestRealRunnerConnectionsAndStats|TestHealthCheckRealRunnerWorkingServer|TestHealthCheckRealRunnerDeadServer|TestConnectBusyInboundPortRealRunner)$' ./internal/api/ 2>&1 | Select-String -Pattern '^(--- |ok|FAIL)'
```

   Ожидается: 17 строк `--- PASS` в первой команде и 4 во второй, ни одной `--- SKIP` и `--- FAIL`. Если какого-то имени нет в выводе — тест переименован или удалён: запишите как отклонение и сверьтесь с `go test -tags $tags -list . ./internal/inst/`.

9. Golden-эталоны проверяет настоящий sing-box (`box.New` + `Close` на каждом конфиге; шаг `sing-box check golden` в CI).

```powershell
go test -tags "singbox_check,$tags" ./internal/cfgbuild/ -run TestGoldenSingBoxCheck -count=1 -timeout 300s -v 2>&1 |
  Tee-Object -FilePath C:\lavray-test\results\A03-golden.txt | Select-String -Pattern '^(--- |ok|FAIL)'
(Select-String -Path C:\lavray-test\results\A03-golden.txt -Pattern '^\s*--- PASS' ).Count
Select-String -Path C:\lavray-test\results\A03-golden.txt -Pattern 'is not included in this build' -Quiet
```

   Ожидается: `ok`, число строк `--- PASS` не меньше 30 (эталон 38: родительский тест и 37 эталонов), последняя команда печатает `False`. Фраза `is not included in this build` означает, что тег (`with_quic`, `with_utls` …) не попал в сборку и проверка молча урезана: это `FAIL`.

10. Запуск собранного ядра: стартует, отвечает, выходит при закрытии stdin (то же делает «smoke» CI; подробный сценарий — файл A07).

```powershell
$tok = 'a03-test-token-0123456789abcdef0123'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = 'serve --listen-socket 127.0.0.1:0 --data C:\lavray-test\tmp\A03\data'
$psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.UseShellExecute = $false
$p = [System.Diagnostics.Process]::Start($psi)
$p.StandardInput.WriteLine($tok); $p.StandardInput.Flush()
$ready = $p.StandardOutput.ReadLine()
$ready
$port = ($ready -split ':')[-1]
(Invoke-WebRequest "http://127.0.0.1:$port/healthz" -UseBasicParsing).StatusCode
try { Invoke-WebRequest "http://127.0.0.1:$port/lavray.v1.CoreService/GetStatus" -Method Post -Body '{}' -ContentType 'application/json' -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }
$r = Invoke-RestMethod "http://127.0.0.1:$port/lavray.v1.CoreService/GetStatus" -Method Post -Body '{}' -ContentType 'application/json' -Headers @{ Authorization = "Bearer $tok" }
$r.coreVersion
$p.StandardInput.Close()
$p.WaitForExit(20000)
$p.ExitCode
```

    Ожидается по строкам вывода: `LAVRAY_CORE_READY tcp://127.0.0.1:<порт>`; `200`; `401`; `0.9.0` (версия ядра равна версии продукта; ядро здесь собрано командой без `-X ...version.Version`, поэтому печатается константа `core/internal/version/version.go`: если там осталась `0.4.0`, это дефект `major` «константа версии не поднята к выпуску», та же причина, что в A06, шаг 16); `True` (процесс вышел за 20 с после закрытия stdin); `0`.

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Шаг 1–2: теги прочитаны из файла, форк закреплён `replace`-ом | непустые значения |
| К2 | Шаг 3: `go mod tidy` вернул 0 | `tidy exit=0` |
| К3 | Шаг 4: ядро собрано, размер 40–80 МБ | `build exit=0`, размер |
| К4 | Шаг 5: теги, форк, `CGO_ENABLED=0`, `-trimpath=true` записаны в бинарник | четыре `True` |
| К5 | Шаг 6: `go test -tags … ./internal/inst/ ./internal/api/` вернул 0 | `tagged exit=0`, 2 строки `ok` |
| К6 | Шаг 7: тестов с тегами не меньше 53 и 194 | числа |
| К7 | Шаг 8: 17 + 4 ключевых теста `--- PASS`, без `SKIP` | вывод |
| К8 | Шаг 9: golden-проверка `ok`, не менее 30 `--- PASS`, фразы `is not included in this build` нет | вывод |
| К9 | Шаг 10: ядро отвечает 200/401, версия `0.9.0`, выходит с кодом 0 за 20 с после EOF | значения |

## Что собрать

`results\A03-go-test-tagged.txt`, `results\A03-golden.txt`, вывод `git diff --stat` шага 3, вывод `go version -m` шага 5 (целиком), версии `go version`.

## Откат / уборка

```powershell
Get-Process -Name lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'C:\lavray-test\tmp\A03\*' } | Stop-Process -Force
Remove-Item Env:GOPRIVATE, Env:GOFLAGS -ErrorAction SilentlyContinue
Set-Location C:\lavray-test
git -C $wt checkout -- core/go.mod core/go.sum
git -C $wt status --short
git -C $env:LAVRAY_SRC worktree remove --force $wt
git -C $env:LAVRAY_SRC worktree prune
Remove-Item -Recurse -Force C:\lavray-test\tmp\A03
```

Ожидается: `status --short` пуст перед удалением рабочей копии (шаг `checkout` вернул файлы), каталога `wt\A03` и `tmp\A03` больше нет. `src\` не затронут: проверьте `git -C $env:LAVRAY_SRC status --short` (пусто).

## Отчёт

`results/A03.md` по `templates/REPORT.md`: статусы шагов 1–10, К1–К9, вывод `git diff --stat`, время сборки и тестов. Провал К5 или К8 — `major` (в CI блокирует слияние), К4 — `major` (выпуск без sing-box), К9 — `major`.
