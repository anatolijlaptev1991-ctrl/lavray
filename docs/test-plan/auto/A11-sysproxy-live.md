# A11. Системный прокси вживую: LAN, VPN-подключение Windows (RAS), WPAD, аварийное восстановление

| Поле | Значение |
|---|---|
| ID | A11 |
| Слой | авто (окно запускается, но кликов нет: подключением управляет MCP, окно следует за ядром) |
| Время | 20–30 минут, +5 минут часть Д |
| Зависимости | A06 (ZIP релиза распакован в `portable\0.9.0`), `01-ENVIRONMENT.md`, разделы 3–8. Выполняется **последовательно**: после A04, перед A10 (группа S в `00-README.md`) |
| Опасность | **прокси, реестр**. Часть Д (необязательная): **TUN** (сеть ПК пропадёт на время до 30 секунд) |

> **Предупреждение. Файл меняет системный прокси Windows, раздел реестра `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`, настройки всех VPN-подключений Windows и создаёт фиктивное VPN-подключение. Запускать только на тестовом ПК, не на ПК с рабочим VPN. Страж из `01-ENVIRONMENT.md`, раздел 3, обязателен: без `TESTPC_OK` файл завершается итогом `BLOCKED`.**

## Цель

Проверить на живой системе всё, что делает T-82 (остаток, Ф2) с прокси ОС в режиме «Системный прокси»:

1. прокси ставится в реестр для LAN (`ProxyEnable`, `ProxyServer`, `ProxyOverride`; `AutoConfigURL` убирается на время сессии);
2. то же прокси ставится в параметры подключения LAN (`DefaultConnectionSettings`) и в **каждую** запись RAS/VPN (двоичное значение с именем записи в разделе `Connections`);
3. «Автоматическое определение параметров» (WPAD) снимается на время сессии и возвращается после;
4. при отключении всё возвращается как было, а правка пользователя, сделанная во время сессии, сохраняется (трёхстороннее слияние);
5. падение ядра снимает прокси; падение оболочки оставляет снимок, и следующий запуск возвращает настройки;
6. крестик окна при выключенном «Сворачивать в трей при закрытии» закрывает программу и снимает прокси;
7. настройка `tun.kill_switch` (kill switch) читается, пишется и принимается сборщиком конфига; в части Д с настоящим TUN `strict_route` включён.

Покрывает: T-82 (прокси LAN/RAS/WPAD, снимок, откат после сбоя, `three_way`), T-03 (снятие прокси при смерти ядра), доступ агентов MCP (`connect` из MCP приводит к установке прокси окном), живую проверку Ф2 п. 1, 7 и строку «kill switch» требований. Соответствующие юнит-тесты на подставках — файл A04; настоящий WinINET на выдуманной записи — A04, шаги 7–8.

Что файл **не** проверяет: рисование окна и трея (M06), диалог «Перезапустить от администратора» (M03), реальные VPN-протоколы Windows (запись создаётся только для проверки прокси, подключаться к ней не нужно и невозможно).

## Предусловия

- Тестовый ПК подтверждён (`Test-TestPc` = `True`: маркер `C:\lavray-test\TESTPC_OK` есть, создан на этом ПК и не старше 30 суток), ZIP релиза 0.9.0 распакован (`$env:LAVRAY_PORTABLE\LAVRay.exe`, `binaries\lavray-core.exe`), Python 3.12, PowerShell 7 с модулем `VpnClient` (есть в Windows 10/11).
- Права обычного пользователя достаточны для частей А–Г. Для части Д — PowerShell от администратора и `LAVRAY_ALLOW_TUN=1`.
- Процессов `LAVRay`, `lavray-core` нет. Порт 2080 не используется: порт входящего подключения выбирается случайно.
- В настройках Windows желательно включено «Определять параметры автоматически» (Параметры → Сеть и Интернет → Прокси): по умолчанию это так. Если выключено, шаги про возврат WPAD получают `SKIPPED` (не `FAIL`).
- Сеть нужна только для необязательного шага 3.9.

## Безопасность и принцип изоляции

- Данные программы не трогаются: перед запуском процессов `APPDATA` в сессии PowerShell подменяется на `C:\lavray-test\tmp\A11\appdata`. Оболочка берёт каталог данных из переменной `APPDATA` (`shell/src/main.rs`, функция `data_dir`), ядро получает его флагом `--data`. Снимок прокси, `ui-state.json`, `agent-endpoint.json` и база лежат там, а не в профиле пользователя. **Подмена действует только в этой сессии: все команды файла выполняются в одном окне PowerShell; в конце (откат) переменная возвращается.**
- Реестр прокси общий для пользователя и подмене не поддаётся: реальные значения `HKCU` меняются. Поэтому есть резервная копия (шаг 0.3) и откат с проверкой.
- Фиктивное VPN-подключение `LavrayTestVpn` создаётся в телефонной книге пользователя (`Add-VpnConnection` без `-AllUserConnection`) и удаляется в откате. Подключаться к нему нельзя: адрес `vpn.test.invalid` не существует.
- Убиваются только процессы, чей путь лежит в `$env:LAVRAY_PORTABLE`.

## Библиотека и помощники

Создайте каталог `C:\lavray-test\tmp\A11` и сохраните в нём файлы из разделов «Скрипты» в конце файла: `a11_upstream.py`, `a11_seed.py`, `a11_mcp.py`, `a11_killswitch.py`, `a11_tun.py`. Библиотеку PowerShell сохраните как `C:\lavray-test\tmp\A11\a11-lib.ps1`:

```powershell
# a11-lib.ps1: чтение состояния прокси Windows и помощники проверки (только чтение реестра).
$script:IS  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$script:ISC = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings\Connections'
$script:Fails = New-Object System.Collections.Generic.List[string]

function N($x) { if ($null -eq $x) { '' } else { "$x" } }

function Get-SysProxy {
  $p = Get-ItemProperty -Path $script:IS
  [pscustomobject]@{
    ProxyEnable   = $(if ($null -ne $p.ProxyEnable) { [int]$p.ProxyEnable } else { $null })
    ProxyServer   = $p.ProxyServer
    ProxyOverride = $p.ProxyOverride
    AutoConfigURL = $p.AutoConfigURL
  }
}

# Двоичное значение Connections\<имя>: DWORD 0x46, DWORD счётчик, DWORD флаги (1 прямое, 2 прокси,
# 4 PAC, 8 автоопределение), затем три строки с длиной DWORD: прокси, обход, адрес PAC.
function ConvertFrom-InetBlob {
  param([byte[]]$Bytes)
  if ($null -eq $Bytes -or $Bytes.Length -lt 16) { return $null }
  $flags = [BitConverter]::ToInt32($Bytes, 8)
  $o = 12
  $parts = @()
  foreach ($i in 0..2) {
    if ($o + 4 -gt $Bytes.Length) { $parts += ''; continue }
    $n = [BitConverter]::ToInt32($Bytes, $o); $o += 4
    if ($n -lt 0 -or $o + $n -gt $Bytes.Length) { $parts += ''; continue }
    $parts += [Text.Encoding]::ASCII.GetString($Bytes, $o, $n); $o += $n
  }
  [pscustomobject]@{
    Flags = $flags; Direct = [bool]($flags -band 1); Proxy = [bool]($flags -band 2)
    Pac = [bool]($flags -band 4); AutoDetect = [bool]($flags -band 8)
    Server = $parts[0]; Bypass = $parts[1]; PacUrl = $parts[2]
  }
}

# Name: 'DefaultConnectionSettings' (LAN) или имя записи RAS. Нет значения - $null.
function Get-InetConn {
  param([string]$Name = 'DefaultConnectionSettings')
  $item = Get-ItemProperty -Path $script:ISC -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $null }
  $prop = $item.PSObject.Properties[$Name]
  if ($null -eq $prop) { return $null }
  ConvertFrom-InetBlob -Bytes ([byte[]]$prop.Value)
}

function Wait-Until {
  param([scriptblock]$Condition, [int]$TimeoutSec = 20, [int]$PollMs = 500)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    if (& $Condition) { return [math]::Max(0.1, [math]::Round($sw.Elapsed.TotalSeconds, 1)) }
    Start-Sleep -Milliseconds $PollMs
  }
  return $false
}

# Что видит приложение, читающее настройки WinINET: свежий процесс, чтобы не было кэша.
function Get-WinInetEffective {
  param([string]$Url = 'http://example.com/')
  $cmd = "([System.Net.WebRequest]::GetSystemWebProxy()).GetProxy([uri]'$Url').AbsoluteUri"
  ((& pwsh -NoProfile -Command $cmd) | Out-String).Trim()
}

# Строка обхода, которую пишет программа (shell/src/sysproxy/values.rs, константа BYPASS).
function Get-ExpectedBypass {
  'localhost;127.*;10.*;' + ((16..31 | ForEach-Object { "172.$_.*" }) -join ';') + ';192.168.*;<local>'
}

function Test-Check {
  param([string]$Id, [bool]$Ok, $Detail = '')
  if ($Ok) { "PASS $Id" } else { "FAIL $Id :: $Detail"; $script:Fails.Add($Id) }
}

# Один вызов инструмента MCP; результат - объект с isError, text, structured.
function Invoke-A11Mcp {
  param([string]$Tool, [string[]]$Pairs = @())
  $out = & python -I (Join-Path $script:T 'a11_mcp.py') $script:Core $script:DataDir $Tool @Pairs
  $out | ConvertFrom-Json
}

# Сравнение LAN с исходным состоянием $script:B / $script:BLan после отката.
function Test-LanRestored {
  param([string]$Prefix)
  $now = Get-SysProxy
  Test-Check "$Prefix lan.ProxyEnable как до теста" ((N $now.ProxyEnable) -eq (N $script:B.ProxyEnable) -or ((N $now.ProxyEnable) -in '', '0' -and (N $script:B.ProxyEnable) -in '', '0')) (N $now.ProxyEnable)
  Test-Check "$Prefix lan.ProxyServer как до теста" ((N $now.ProxyServer) -eq (N $script:B.ProxyServer)) (N $now.ProxyServer)
  Test-Check "$Prefix lan.AutoConfigURL как до теста" ((N $now.AutoConfigURL) -eq (N $script:B.AutoConfigURL)) (N $now.AutoConfigURL)
  $lan = Get-InetConn
  if ($null -ne $lan -and $null -ne $script:BLan) {
    Test-Check "$Prefix LAN-блоб: прокси выключен" (-not $lan.Proxy) "Proxy=$($lan.Proxy) Server=$($lan.Server)"
    Test-Check "$Prefix LAN-блоб: автоопределение как до теста" ($lan.AutoDetect -eq $script:BLan.AutoDetect) "было $($script:BLan.AutoDetect), стало $($lan.AutoDetect)"
  }
}
```

Проверка библиотеки без обращения к системе (разбор синтетического блоба, должен напечатать `Flags=3 Server=127.0.0.1:2080`):

```powershell
. C:\lavray-test\tmp\A11\a11-lib.ps1
$srv = [Text.Encoding]::ASCII.GetBytes('127.0.0.1:2080'); $byp = [Text.Encoding]::ASCII.GetBytes('<local>')
$ms = New-Object IO.MemoryStream
foreach ($v in 70, 7, 3) { $ms.Write([BitConverter]::GetBytes([int]$v), 0, 4) }
$ms.Write([BitConverter]::GetBytes([int]$srv.Length), 0, 4); $ms.Write($srv, 0, $srv.Length)
$ms.Write([BitConverter]::GetBytes([int]$byp.Length), 0, 4); $ms.Write($byp, 0, $byp.Length)
$ms.Write([BitConverter]::GetBytes([int]0), 0, 4)
$b = ConvertFrom-InetBlob -Bytes $ms.ToArray()
"Flags=$($b.Flags) Server=$($b.Server) Proxy=$($b.Proxy) AutoDetect=$($b.AutoDetect)"
```

## Шаги

### Часть 0. Подготовка

**0.1 Страж, окружение, процессы.**

```powershell
. C:\lavray-test\env.ps1
if (-not (Test-TestPc)) { 'BLOCKED: нет маркера TESTPC_OK (или он создан на другом ПК, или старше 30 суток)'; return }
$T = 'C:\lavray-test\tmp\A11'
New-Item -ItemType Directory -Force -Path $T, "$T\up", C:\lavray-test\results\A11 | Out-Null
. "$T\a11-lib.ps1"
$Core = $env:LAVRAY_CORE_EXE
$ShellExe = Join-Path $env:LAVRAY_PORTABLE 'LAVRay.exe'
$SavedAppData = $env:APPDATA
"оболочка: " + (Test-Path $ShellExe) + "; ядро: " + (Test-Path $Core)
"процессы LAVRay/lavray-core: " + [bool](Get-Process LAVRay, lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$($env:LAVRAY_PORTABLE)\*" })
Get-Module -ListAvailable VpnClient | Select-Object -First 1 Name, Version
```

Ожидается: маркер найден; `оболочка: True; ядро: True`; `процессы ...: False`; модуль `VpnClient` есть. Иначе `BLOCKED`.

**0.2 Помощники на диск.** Сохраните пять Python-файлов из раздела «Скрипты» в `$T` и проверьте синтаксис:

```powershell
foreach ($f in 'a11_upstream.py', 'a11_seed.py', 'a11_mcp.py', 'a11_killswitch.py', 'a11_tun.py') {
  python -I -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" (Join-Path $T $f)
  '{0}: код {1}' -f $f, $LASTEXITCODE
}
```

Ожидается: у всех `код 0`.

**0.3 Резервная копия раздела реестра (только чтение раздела).**

```powershell
reg export "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" "$T\before.reg" /y
"reg export код $LASTEXITCODE; размер: " + (Get-Item "$T\before.reg").Length
```

Ожидается: код `0`, размер больше нуля.

### Часть 1. Исходное состояние («до»)

**1.1 Снимок LAN.**

```powershell
$B = Get-SysProxy
$BLan = Get-InetConn
$B | Format-List
$BLan | Format-List
$B | ConvertTo-Json | Set-Content "$T\before-lan.json" -Encoding utf8
"автоопределение (WPAD) до теста: " + $(if ($BLan) { $BLan.AutoDetect } else { '(блоба нет)' })
```

Ожидается: `ProxyEnable` пуст или `0`, `ProxyServer` пуст. Иначе `BLOCKED` (прокси уже включён: ПК не подходит для теста). Запишите значение WPAD.

**1.2 Фиктивное VPN-подключение.**

```powershell
Add-VpnConnection -Name 'LavrayTestVpn' -ServerAddress 'vpn.test.invalid' -TunnelType Sstp -Force -PassThru | Select-Object Name, ServerAddress, TunnelType
(Get-VpnConnection -Name 'LavrayTestVpn').Name
$BRas = Get-InetConn 'LavrayTestVpn'
"параметры прокси записи до теста: " + $(if ($BRas) { "флаги=$($BRas.Flags) автоопределение=$($BRas.AutoDetect)" } else { '(блоба нет, значения WinINET по умолчанию)' })
```

Ожидается: печатается запись `LavrayTestVpn` с адресом `vpn.test.invalid`, имя читается обратно. Если `Add-VpnConnection` завершился ошибкой (нет модуля, групповая политика), часть шагов про RAS помечается `SKIPPED` с причиной, остальное выполняется.

**1.3 Что видит WinINET до теста.**

```powershell
$BEff = Get-WinInetEffective
$BEff
```

Ожидается: `http://example.com/` (прокси не задан: адрес возвращается как есть).

### Часть 2. Данные, запуск окна

**2.1 Локальный SOCKS5-апстрим и свободные порты.**

```powershell
$up = Start-Process -FilePath python -ArgumentList '-I', "$T\a11_upstream.py", "$T\up" -WindowStyle Hidden -PassThru
[void](Wait-Until { Test-Path "$T\up\upstream.json" } 15)
$UpPort = (Get-Content "$T\up\upstream.json" -Raw | ConvertFrom-Json).port
$Mixed = [int](python -I -c "import socket; s = socket.socket(); s.bind(('127.0.0.1', 0)); print(s.getsockname()[1])")
"апстрим: $UpPort; порт входа: $Mixed"
Get-NetTCPConnection -State Listen -LocalPort $Mixed -ErrorAction SilentlyContinue
```

Ожидается: два числа не равны 2080, порт `$Mixed` свободен (последняя команда ничего не печатает).

**2.2 Подмена каталога данных и подготовка.**

```powershell
$AppDataRoot = "$T\appdata"
$DataDir = Join-Path $AppDataRoot 'LAVRay'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$env:APPDATA = $AppDataRoot
$seed = python -I "$T\a11_seed.py" $Core $DataDir $UpPort $Mixed
"seed код $LASTEXITCODE : $seed"
$ProfileId = ($seed | ConvertFrom-Json).profile_id
```

Ожидается: `seed код 0`, JSON `{"profile_id": "1", "accepted": ["agent.mode", "connect.health_check", "inbound.port"]}`. Скрипт запустил ядро на отдельном каталоге данных, записал порт входа, режим агентов `control`, выключил проверку связи, импортировал профиль `socks://127.0.0.1:<апстрим>#a11-upstream` и закрыл ядро.

**2.3 Состояние интерфейса: онбординг пройден, русский язык, «Сворачивать в трей при закрытии» выключено, режим «Системный прокси» включён, выбран тестовый сервер.** Ключи и формат — `shell/src/ui_state/keys.rs` (список `ALLOWED_KEYS`), файл читают и оболочка, и интерфейс.

```powershell
$ui = [ordered]@{
  'lavray.onboarded'   = '1'
  'lavray.lang'        = 'ru'
  'lavray.closeToTray' = '0'
  'lavray.modes'       = '{"sysProxy":true,"tunMode":false}'
  'lavray.server'      = [string]$ProfileId
}
$ui | ConvertTo-Json | Set-Content (Join-Path $DataDir 'ui-state.json') -Encoding utf8
Get-Content (Join-Path $DataDir 'ui-state.json')
@"
`$T = '$T'; `$Mixed = $Mixed; `$UpPort = $UpPort; `$ProfileId = '$ProfileId'
`$DataDir = '$DataDir'; `$Core = '$Core'; `$ShellExe = '$ShellExe'; `$SavedAppData = '$SavedAppData'
"@ | Set-Content "$T\ctx.ps1" -Encoding utf8
```

Ожидается: выведен JSON с пятью ключами. Файл `ctx.ps1` нужен, если сессия оборвётся: `. $T\ctx.ps1; . $T\a11-lib.ps1; $env:APPDATA = "$T\appdata"` восстанавливает контекст (переменные `$B`, `$BLan`, `$BRas` восстановите из `before-lan.json` и повторным чтением, пока в системе ничего не включено).

**2.4 Запуск окна LAVRay из ZIP.** Окно видимое, без `--tray`: ничего кликать не нужно, управление идёт через MCP.

```powershell
$app = Start-Process -FilePath $ShellExe -WorkingDirectory $env:LAVRAY_PORTABLE -PassThru
$t1 = Wait-Until { Test-Path (Join-Path $DataDir 'agent-endpoint.json') } 90
"файл доступа агентов появился через: $t1 с"
$ep = Get-Content (Join-Path $DataDir 'agent-endpoint.json') -Raw | ConvertFrom-Json
"mode=$($ep.mode); url=$($ep.url); токен: $(($ep.token).Length) символов"
```

Ожидается: файл появился за 90 с (эталон — единицы секунд), `mode=control`, `url` вида `tcp://127.0.0.1:<порт>`, токен не короче 32 символов. Значение токена не печатать и не сохранять.

**2.5 Файл доступа защищён** (`docs/MCP.md`: доступ только у текущего пользователя и SYSTEM, наследование отключено).

```powershell
$acl = Get-Acl (Join-Path $DataDir 'agent-endpoint.json')
$acl.AreAccessRulesProtected
$acl.Access | Select-Object -ExpandProperty IdentityReference | ForEach-Object Value | Sort-Object -Unique
```

Ожидается: `True` (наследование выключено); в списке только учётная запись текущего пользователя (`<ПК>\<пользователь>`) и `NT AUTHORITY\SYSTEM`. Любая другая запись (`BUILTIN\Users`, `Everyone`, `Администраторы`) — `FAIL`, дефект `critical`.

**2.6 Окно не вмешивалось в систему само по себе.**

```powershell
$now = Get-SysProxy
Test-Check 'ничего не включено до подключения' ((N $now.ProxyEnable) -in '', '0') (N $now.ProxyEnable)
Test-Check 'WinINET без прокси' ((Get-WinInetEffective) -eq $BEff) (Get-WinInetEffective)
```

Ожидается: две строки `PASS`.

### Часть 3. Подключение из MCP и состояние «во время»

**3.1 Сервер виден агенту.**

```powershell
$srv = Invoke-A11Mcp 'list_servers'
$srv.text
Test-Check 'list_servers: один сервер с ожидаемым id' (($srv.structured.servers).Count -eq 1 -and "$($srv.structured.servers[0].id)" -eq $ProfileId) $srv.text
```

**3.2 Подключение.** Режим берётся из настроек приложения (системный прокси); прокси ставит окно.

```powershell
$c = Invoke-A11Mcp 'connect' @("server_id=$ProfileId")
$c.text
Test-Check 'connect: подключено в режиме системного прокси' ($c.structured.connected -eq $true -and $c.structured.connection_mode -eq 'system_proxy') $c.text
Test-Check 'connect: текст про прокси окна' ($c.text -like '*Системный прокси Windows применит окно LAVRay*') $c.text
```

**3.3 Прокси появился в реестре за разумное время.**

```powershell
$sec = Wait-Until { (Get-SysProxy).ProxyEnable -eq 1 } 30
Test-Check 'ProxyEnable стал 1 в течение 20 с' ($sec -ne $false -and $sec -le 20) "ждали: $sec"
"время до включения: $sec с"
```

**3.4 Значения LAN в реестре.**

```powershell
$d = Get-SysProxy
$d | Format-List
Test-Check 'ProxyServer = 127.0.0.1:порт' ($d.ProxyServer -eq "127.0.0.1:$Mixed") $d.ProxyServer
Test-Check 'ProxyOverride = список обхода программы' ($d.ProxyOverride -ceq (Get-ExpectedBypass)) $d.ProxyOverride
Test-Check 'AutoConfigURL удалён на время сессии' ([string]::IsNullOrEmpty($d.AutoConfigURL)) $d.AutoConfigURL
```

Ожидается: три `PASS`. (Список обхода — локальные адреса и частные сети; он совпадает с константой `BYPASS` в `shell/src/sysproxy/values.rs`.)

**3.5 Параметры подключения LAN (`DefaultConnectionSettings`).**

```powershell
$lan = Get-InetConn
$lan | Format-List
Test-Check 'LAN-блоб: прокси включён' ($lan.Proxy -and $lan.Direct) "Flags=$($lan.Flags)"
Test-Check 'LAN-блоб: тот же адрес' ($lan.Server -eq "127.0.0.1:$Mixed") $lan.Server
Test-Check 'LAN-блоб: автоопределение снято' (-not $lan.AutoDetect) "AutoDetect=$($lan.AutoDetect)"
```

Ожидается: три `PASS`. Если WPAD до теста был выключен, третья проверка проходит и так.

**3.6 Параметры VPN-подключения (RAS).**

```powershell
$ras = Get-InetConn 'LavrayTestVpn'
$ras | Format-List
Test-Check 'RAS-блоб существует' ($null -ne $ras) 'значения Connections\LavrayTestVpn нет'
if ($ras) {
  Test-Check 'RAS-блоб: прокси включён, прямое есть' ($ras.Proxy -and $ras.Direct) "Flags=$($ras.Flags)"
  Test-Check 'RAS-блоб: тот же адрес' ($ras.Server -eq "127.0.0.1:$Mixed") $ras.Server
  Test-Check 'RAS-блоб: список обхода программы' ($ras.Bypass -ceq (Get-ExpectedBypass)) $ras.Bypass
  Test-Check 'RAS-блоб: автоопределение снято' (-not $ras.AutoDetect) "AutoDetect=$($ras.AutoDetect)"
}
```

Ожидается: пять `PASS`. Если запись не создана (шаг 1.2 `SKIPPED`), этот шаг `SKIPPED`.

**3.7 Что видит приложение, читающее настройки WinINET.**

```powershell
$eff = Get-WinInetEffective
$eff
Test-Check 'WinINET отдаёт прокси программы' ($eff -eq "http://127.0.0.1:$Mixed/") $eff
```

**3.8 Снимок для отката лежит рядом с данными.**

```powershell
$snapPath = Join-Path $DataDir 'sysproxy.snapshot.json'
Test-Check 'файл снимка существует' (Test-Path $snapPath) $snapPath
$snap = Get-Content $snapPath -Raw | ConvertFrom-Json
Test-Check 'снимок: версия формата 3, ОС windows' ($snap.original.version -eq 3 -and $snap.original.os -eq 'windows') "$($snap.original.version) $($snap.original.os)"
Test-Check 'снимок: есть блок applied (трёхсторонний откат)' ($null -ne $snap.applied) 'applied пуст'
Test-Check 'снимок: записан WPAD' ($null -ne $snap.original.data.PSObject.Properties['wpad']) 'нет поля wpad'
if ($BLan) { Test-Check 'снимок: WPAD равен исходному' (($snap.original.data.wpad) -eq $BLan.AutoDetect) "$($snap.original.data.wpad)" }
if ($ras) { Test-Check 'снимок: запись RAS есть' ($null -ne $snap.original.data.ras.PSObject.Properties['LavrayTestVpn']) 'нет ras.LavrayTestVpn' }
$snap.original.data.proxy | ConvertTo-Json -Depth 4
```

Ожидается: `PASS` на каждую строку; последняя команда печатает исходные `ProxyEnable` и `ProxyServer` как `null` или как значения `{type, data}`. Содержимое снимка в отчёт не вставлять целиком: достаточно имён полей.

**3.9 (необязательно, нужен интернет) Реальный запрос через системный прокси.**

```powershell
$code = pwsh -NoProfile -Command "(Invoke-WebRequest -Uri http://example.com/ -UseBasicParsing -TimeoutSec 25).StatusCode"
"код ответа: $code"
Start-Sleep -Seconds 1
$seen = Get-Content "$T\up\seen.txt" -ErrorAction SilentlyContinue
"апстрим видел example.com:80: " + [bool]($seen -contains 'example.com:80')
```

Ожидается: `код ответа: 200`, апстрим видел `example.com:80`. Без интернета — `WARN` (не `FAIL`), остальное не зависит.

### Часть 4. Правка пользователя во время сессии (трёхстороннее слияние)

**4.1 Пользователь меняет список обхода.**

```powershell
Set-ItemProperty -Path $script:IS -Name ProxyOverride -Value 'user-changed.example'
(Get-SysProxy).ProxyOverride
```

**4.2 Отключение из MCP, возврат остальных настроек.**

```powershell
$dc = Invoke-A11Mcp 'disconnect'
$dc.text
$sec = Wait-Until { (N (Get-SysProxy).ProxyEnable) -in '', '0' } 30
Test-Check 'ProxyEnable вернулся за 20 с' ($sec -ne $false -and $sec -le 20) "ждали: $sec"
$now = Get-SysProxy
Test-Check 'ProxyServer вернулся к исходному' ((N $now.ProxyServer) -eq (N $B.ProxyServer)) (N $now.ProxyServer)
Test-Check 'правка пользователя сохранена: ProxyOverride' ($now.ProxyOverride -ceq 'user-changed.example') (N $now.ProxyOverride)
Test-Check 'AutoConfigURL как до теста' ((N $now.AutoConfigURL) -eq (N $B.AutoConfigURL)) (N $now.AutoConfigURL)
```

Ожидается: четыре `PASS`. Правило: значение возвращается к исходному, только если сейчас оно наше; изменённое пользователем остаётся (заметки к выпуску 0.4.0; `shell/src/sysproxy/merge.rs`, функция `three_way`).

**4.3 Остальные подключения и снимок.**

```powershell
$lan = Get-InetConn
if ($BLan) { Test-Check 'LAN-блоб: прокси снят' (-not $lan.Proxy) "Server=$($lan.Server)" ; Test-Check 'LAN-блоб: WPAD как до теста' ($lan.AutoDetect -eq $BLan.AutoDetect) "было $($BLan.AutoDetect), стало $($lan.AutoDetect)" }
$ras = Get-InetConn 'LavrayTestVpn'
if ($ras) {
  Test-Check 'RAS-блоб: прокси снят' (-not $ras.Proxy) "Server=$($ras.Server)"
  if ($BRas) { Test-Check 'RAS-блоб: WPAD как до теста' ($ras.AutoDetect -eq $BRas.AutoDetect) "было $($BRas.AutoDetect), стало $($ras.AutoDetect)" }
}
Test-Check 'WinINET снова без прокси' ((Get-WinInetEffective) -eq $BEff) (Get-WinInetEffective)
Test-Check 'файл снимка удалён' (-not (Test-Path (Join-Path $DataDir 'sysproxy.snapshot.json'))) 'снимок остался'
```

Если до теста WPAD был выключен (`$BLan.AutoDetect = False`), проверка про WPAD проходит тривиально; в отчёте отметьте `SKIPPED (WPAD не был включён)` для содержательной части.

**4.4 Вернуть правку пользователя (чтобы дальше сравнивать с исходным).**

```powershell
if (N $B.ProxyOverride) { Set-ItemProperty -Path $script:IS -Name ProxyOverride -Value $B.ProxyOverride } else { Remove-ItemProperty -Path $script:IS -Name ProxyOverride -ErrorAction SilentlyContinue }
Test-LanRestored 'после части 4:'
```

### Часть 5. Падение ядра

**5.1 Подключиться снова (проверяет, что окно умеет ставить прокси повторно).**

```powershell
[void](Invoke-A11Mcp 'connect' @("server_id=$ProfileId"))
$sec = Wait-Until { (Get-SysProxy).ProxyEnable -eq 1 } 30
Test-Check 'повторное подключение ставит прокси' ($sec -ne $false -and $sec -le 20) "ждали: $sec"
$epOld = Get-Content (Join-Path $DataDir 'agent-endpoint.json') -Raw | ConvertFrom-Json
```

**5.2 Убить ядро (только то, что запущено из ZIP).**

```powershell
$coreProc = Get-Process lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$($env:LAVRAY_PORTABLE)\*" }
"найдено процессов ядра: $(@($coreProc).Count)"
$coreProc | Stop-Process -Force
$sec = Wait-Until { (N (Get-SysProxy).ProxyEnable) -in '', '0' } 30
Test-Check 'ядро убито: прокси снят за 20 с' ($sec -ne $false -and $sec -le 20) "ждали: $sec"
Test-Check 'ядро убито: снимок удалён' (-not (Test-Path (Join-Path $DataDir 'sysproxy.snapshot.json'))) 'снимок остался'
Test-LanRestored 'после падения ядра:'
```

Ожидается: один процесс ядра найден и убит; прокси снят за 20 с (оболочка при смерти ядра возвращает снимок: `shell/src/main.rs`, функция `core_down`); LAN и RAS вернулись.

**5.3 Оболочка перезапустила ядро и обновила файл доступа.**

```powershell
$sec = Wait-Until { (Test-Path (Join-Path $DataDir 'agent-endpoint.json')) -and ((Get-Content (Join-Path $DataDir 'agent-endpoint.json') -Raw | ConvertFrom-Json).url -ne $epOld.url) } 60
Test-Check 'новое ядро: новый адрес в файле доступа' ($sec -ne $false) "ждали: $sec"
Test-Check 'оболочка жива' ([bool](Get-Process -Id $app.Id -ErrorAction SilentlyContinue)) 'процесс LAVRay завершился'
```

**5.4 После падения ядра прокси ставится снова.**

```powershell
$c = Invoke-A11Mcp 'connect' @("server_id=$ProfileId")
$c.text
$sec = Wait-Until { (Get-SysProxy).ProxyEnable -eq 1 } 30
Test-Check 'после перезапуска ядра прокси ставится снова' ($sec -ne $false -and $sec -le 20) "ждали: $sec"
```

Если эта проверка падает при успешной 3.3 и 5.1, окно считает прокси «уже применённым» после падения ядра: дефект `major` (пользователь подключён, а прокси не стоит).

### Часть 6. Падение оболочки и аварийное восстановление

**6.1 Убить процесс оболочки в состоянии «подключено».**

```powershell
Stop-Process -Id $app.Id -Force
$sec = Wait-Until { -not (Get-Process lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$($env:LAVRAY_PORTABLE)\*" }) } 20
Test-Check 'ядро ушло вместе с оболочкой за 20 с' ($sec -ne $false) 'ядро осталось сиротой'
```

**6.2 Прокси остался, снимок на диске.**

```powershell
$now = Get-SysProxy
Test-Check 'после убийства оболочки прокси остался (ожидаемо)' ($now.ProxyEnable -eq 1 -and $now.ProxyServer -eq "127.0.0.1:$Mixed") "$($now.ProxyEnable) $($now.ProxyServer)"
Test-Check 'снимок остался на диске' (Test-Path (Join-Path $DataDir 'sysproxy.snapshot.json')) 'снимка нет'
Test-Check 'устаревший файл доступа остался (его удалит следующий запуск)' (Test-Path (Join-Path $DataDir 'agent-endpoint.json')) 'файла нет'
```

**6.3 Повторный запуск возвращает настройки до запуска ядра** (`shell/src/main.rs`: `recover_if_needed` при старте).

```powershell
$app = Start-Process -FilePath $ShellExe -WorkingDirectory $env:LAVRAY_PORTABLE -PassThru
$sec = Wait-Until { (N (Get-SysProxy).ProxyEnable) -in '', '0' } 40
Test-Check 'следующий запуск вернул прокси за 40 с' ($sec -ne $false) "ждали: $sec"
Test-Check 'снимок удалён после восстановления' (-not (Test-Path (Join-Path $DataDir 'sysproxy.snapshot.json'))) 'снимок остался'
Test-LanRestored 'после аварийного восстановления:'
$ras = Get-InetConn 'LavrayTestVpn'
if ($ras) { Test-Check 'RAS-блоб после восстановления: прокси снят' (-not $ras.Proxy) "Server=$($ras.Server)" }
$sec = Wait-Until { Test-Path (Join-Path $DataDir 'agent-endpoint.json') } 90
Test-Check 'новое ядро поднялось, файл доступа обновлён' ($sec -ne $false) "ждали: $sec"
```

### Часть 7. Корректный выход крестиком

**7.1 Подключиться, затем закрыть окно.** В `ui-state.json` стоит `lavray.closeToTray = 0`: крестик закрывает программу целиком, как «Выход» в трее.

```powershell
[void](Invoke-A11Mcp 'connect' @("server_id=$ProfileId"))
$sec = Wait-Until { (Get-SysProxy).ProxyEnable -eq 1 } 30
Test-Check 'перед выходом прокси стоит' ($sec -ne $false) "ждали: $sec"
$app.Refresh()
"окно найдено: " + ($app.MainWindowHandle -ne 0)
$sent = $app.CloseMainWindow()
"CloseMainWindow: $sent"
$exited = $app.WaitForExit(30000)
Test-Check 'крестик закрыл программу за 30 с' $exited 'процесс жив (окно спрятано в трей?)'
```

Если `окно найдено: False`, окно ещё не создалось или скрыто: повторите через 10 с; при повторной неудаче `BLOCKED` для 7.1 (выполните проверку в M06, п. «Сворачивать в трей при закрытии»).

**7.2 После выхода всё чисто.**

```powershell
$sec = Wait-Until { (N (Get-SysProxy).ProxyEnable) -in '', '0' } 20
Test-Check 'прокси снят при выходе' ($sec -ne $false) "ждали: $sec"
Test-Check 'ядро не осталось' (-not (Get-Process lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$($env:LAVRAY_PORTABLE)\*" })) 'процесс ядра жив'
Test-Check 'файл доступа агентов удалён' (-not (Test-Path (Join-Path $DataDir 'agent-endpoint.json'))) 'файл остался'
Test-Check 'снимок удалён' (-not (Test-Path (Join-Path $DataDir 'sysproxy.snapshot.json'))) 'снимок остался'
Test-LanRestored 'после выхода:'
```

### Часть Г. Настройка kill switch без TUN

```powershell
python -I "$T\a11_killswitch.py" $Core "$T\ks" 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A11\killswitch.txt
"kill switch код $LASTEXITCODE"
```

Ожидается: шесть строк `PASS`, `A11-Г: провалов 0`, код `0`. Скрипт проверяет, что настройка `tun.kill_switch` описана, по умолчанию выключена, включается, читается обратно, что подключение в режиме TUN с `validate_only` собирает конфиг, не запуская TUN, и что настройка выключается. Фактическое действие настройки на этой версии: она принудительно включает `strict_route` у TUN (`core/internal/cfgbuild/inbounds.go`); «полная блокировка трафика при падении туннеля» в этой версии не реализована (так сказано в описании настройки: строка `tun.kill.d` словаря), её нужно проверять в версиях 0.8.0 и позже.

### Часть Д (необязательная). Настоящий TUN с kill switch

Выполняется, только если задана `LAVRAY_ALLOW_TUN=1`, PowerShell запущен от администратора и владелец согласен потерять сеть на ПК до 30 секунд. Иначе итог части — `SKIPPED`.

```powershell
if ($env:LAVRAY_ALLOW_TUN -ne '1') { 'SKIPPED: LAVRAY_ALLOW_TUN не равна 1'; return }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { 'SKIPPED: нужен PowerShell от администратора'; return }
python -I "$T\a11_tun.py" $Core "$T\tun" $UpPort 2>&1 | Tee-Object -FilePath C:\lavray-test\results\A11\tun.txt
"tun код $LASTEXITCODE"
```

Ожидается: строки `PASS` для: адаптера до подключения нет; `CONNECTED`; адаптер `lavray-tun` появился; в конфиге один inbound `tun` с `interface_name = lavray-tun`, `strict_route = true`, `auto_route = true`; `Disconnect` выполнен; адаптера после отключения нет. Строка `BLOCKED connect TUN` с текстом ошибки означает, что прав не хватило (ядро запущено без повышения) или TUN не поднялся: приложите текст.

## Критерии PASS/FAIL

Итог файла `PASS`, если ни одна проверка `Test-Check` не напечатала `FAIL` (список `$script:Fails` пуст), а шаги с жёсткими условиями выполнены:

| № | Критерий | Где |
|---|---|---|
| К1 | Файл доступа агентов: только пользователь и SYSTEM, наследование выключено | 2.5 |
| К2 | После `connect` из MCP прокси включён за 20 с; `ProxyServer`, `ProxyOverride`, `AutoConfigURL` как в таблице 3.4 | 3.3–3.4 |
| К3 | LAN-блоб и RAS-блоб содержат прокси программы, WPAD снят | 3.5–3.6 |
| К4 | WinINET отдаёт `http://127.0.0.1:<порт>/` | 3.7 |
| К5 | Снимок: версия 3, `windows`, `applied`, `wpad`, запись RAS | 3.8 |
| К6 | После `disconnect` всё равно исходному; правка пользователя сохранена | 4.2–4.3 |
| К7 | Падение ядра: прокси снят за 20 с; новое ядро поднялось; прокси ставится снова | 5.2–5.4 |
| К8 | Падение оболочки: прокси остаётся, следующий запуск возвращает настройки за 40 с | 6.2–6.3 |
| К9 | Выход крестиком: процесс завершён за 30 с, прокси снят, файл доступа удалён | 7.1–7.2 |
| К10 | Kill switch: шесть проверок части Г | Г |
| К11 | Откат: реестр совпадает с исходным | раздел «Откат» |

`WARN` (только 3.9) и `SKIPPED` (WPAD не был включён, нет модуля `VpnClient`, часть Д без флага) не делают итог `FAIL`, но фиксируются; итог при наличии `SKIPPED` в обязательных пунктах — `PARTIAL`.

## Что собрать

В `results\A11\`: вывод каждого шага с проверками (`Start-Transcript -Path C:\lavray-test\results\A11\transcript.txt` в начале сессии), `before-lan.json`, `killswitch.txt`, `tun.txt` (если выполнялась), имена полей снимка (не значения), скриншот окна LAVRay по желанию. **Не** сохранять: `agent-endpoint.json`, значения токенов, `ui-state.json` целиком не нужен.

## Откат / уборка

Выполняется всегда, в том числе при остановке посреди теста. Все команды в одной сессии PowerShell, где подменялся `APPDATA`.

```powershell
# 1. Процессы (только из ZIP) и апстрим
Get-Process LAVRay, lavray-core -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$($env:LAVRAY_PORTABLE)\*" } | Stop-Process -Force
if ($up) { Stop-Process -Id $up.Id -Force -ErrorAction SilentlyContinue }
# 2. Вернуть переменную окружения
$env:APPDATA = $SavedAppData
# 3. Реестр: если значения не совпали с исходными, импортировать резервную копию и убрать лишнее
$n = Get-SysProxy
$same = ((N $n.ProxyServer) -eq (N $B.ProxyServer)) -and ((N $n.ProxyOverride) -eq (N $B.ProxyOverride)) -and ((N $n.AutoConfigURL) -eq (N $B.AutoConfigURL)) -and ((N $n.ProxyEnable) -in '', '0')
"реестр совпадает с исходным: $same"
if (-not $same) { reg import "$T\before.reg"; "reg import код $LASTEXITCODE" }
# 4. Фиктивное VPN-подключение и его значение в реестре
Remove-VpnConnection -Name 'LavrayTestVpn' -Force -PassThru -ErrorAction SilentlyContinue | Out-Null
Remove-ItemProperty -Path $script:ISC -Name 'LavrayTestVpn' -ErrorAction SilentlyContinue
"VPN-запись удалена: " + (-not [bool](Get-VpnConnection -Name 'LavrayTestVpn' -ErrorAction SilentlyContinue))
"значение Connections\LavrayTestVpn удалено: " + ($null -eq (Get-InetConn 'LavrayTestVpn'))
# 5. Адаптер TUN, если часть Д оставила его
"адаптер lavray-tun отсутствует: " + (-not [bool](Get-NetAdapter -Name 'lavray-tun' -ErrorAction SilentlyContinue))
# 6. Итоговое сравнение LAN и WinINET
$finalBlob = Get-InetConn
"WinINET без прокси: " + ((Get-WinInetEffective) -eq $BEff)
if ($BLan -and $finalBlob) { "LAN-блоб: WPAD как до теста: " + ($finalBlob.AutoDetect -eq $BLan.AutoDetect) + "; прокси снят: " + (-not $finalBlob.Proxy) }
# 7. Временные данные
Remove-Item -Recurse -Force $T -ErrorAction SilentlyContinue
"каталог теста удалён: " + (-not (Test-Path $T))
```

Ожидается: `реестр совпадает с исходным: True` (после `reg import` повторите проверку и запишите результат), `VPN-запись удалена: True`, `значение ... удалено: True`, `адаптер lavray-tun отсутствует: True`, `WinINET без прокси: True`, строка про LAN-блоб с `True`/`True`, `каталог теста удалён: True`. `reg import` возвращает значения, но не удаляет добавленные значения: поэтому шаг 4 удаляет значение `LavrayTestVpn` явно. Если после отката `WinINET без прокси: False`, откатите снимок виртуальной машины и пометьте `critical`.

После уборки перед следующим файлом создайте новую сессию PowerShell (чтобы `APPDATA` и функции библиотеки не остались).

## Отчёт

`results/A11.md` по `templates/REPORT.md`: статус каждого шага части 0–7, Г, Д; значения К1–К11; время до включения прокси (шаги 3.3, 4.2, 5.2, 6.3); наблюдение про WPAD (был ли включён); итог отката. Серьёзность: не вернулся прокси или WPAD после любого сценария — `critical` (пользователь остаётся с чужим прокси); файл доступа с лишними правами — `critical`; прокси не ставится после падения ядра (5.4) — `major`; остальное — `major`/`minor`.

## Скрипты

### `a11_upstream.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A11: крошечный SOCKS5-сервер на loopback («сервер-апстрим» для тестового профиля).

Запуск: python -I a11_upstream.py <каталог>   (работает, пока его не остановят)
Пишет <каталог>/upstream.json {"port": N, "pid": P} и дописывает адреса назначения в <каталог>/seen.txt.
"""
import json
import os
import select
import socket
import socketserver
import sys

out = os.path.abspath(sys.argv[1])
os.makedirs(out, exist_ok=True)
seen = os.path.join(out, "seen.txt")


class Srv(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class H(socketserver.BaseRequestHandler):
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
            with open(seen, "a", encoding="utf-8") as f:
                f.write(f"{host}:{port}\n")
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


srv = Srv(("127.0.0.1", 0), H)
with open(os.path.join(out, "upstream.json"), "w", encoding="utf-8") as f:
    json.dump({"port": srv.server_address[1], "pid": os.getpid()}, f)
srv.serve_forever()
```

### `a11_seed.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A11: подготовка каталога данных ядра до первого запуска окна.

Запуск: python -I a11_seed.py <lavray-core.exe> <каталог данных> <порт апстрима> <порт mixed>
Ядро запускается на loopback, получает настройки (порт входящего подключения, доступ агентов
«control», проверка связи выключена), импортирует профиль socks://127.0.0.1:<апстрим> и
закрывается. Печатает JSON {"profile_id": ..., "accepted": [...]}.
"""
import json
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
exe, data, up_port, mixed = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]), sys.argv[3], sys.argv[4]
os.makedirs(data, exist_ok=True)
tok = secrets.token_urlsafe(32)
core = subprocess.Popen([exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", data],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
core.stdin.write((tok + "\n").encode())
core.stdin.flush()
ready = core.stdout.readline().decode().strip()
base = "http://" + ready.split()[1].replace("tcp://", "")


def rpc(svc, method, body):
    req = urllib.request.Request(f"{base}/lavray.v1.{svc}/{method}", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{svc}/{method}: HTTP {e.code} {e.read().decode(errors='replace')[:200]}")


try:
    acc = rpc("SettingsService", "SetSettings", {"values": {
        "inbound.port": {"intValue": mixed},
        "agent.mode": {"stringValue": "control"},
        "connect.health_check": {"boolValue": False},
    }}).get("acceptedKeys", [])
    gid = rpc("ProfileService", "ListGroups", {})["groups"][0]["id"]
    rpc("ProfileService", "ImportContent", {"content": f"socks://127.0.0.1:{up_port}#a11-upstream",
                                            "intent": "INTENT_AS_LINKS", "targetGroupId": gid})
    pid = rpc("ProfileService", "ListProfiles", {})["profiles"][0]["id"]
    print(json.dumps({"profile_id": pid, "accepted": acc}))
finally:
    core.stdin.close()
    core.wait(timeout=20)
```

### `a11_mcp.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A11: один вызов инструмента MCP через `lavray-core mcp`.

Запуск: python -I a11_mcp.py <lavray-core.exe> <каталог данных> <инструмент> [имя=значение ...]
Значение разбирается как JSON (server_id=1 даёт число), иначе остаётся строкой.
Печатает JSON {"isError":..., "text":..., "structured":...}; код выхода 0 при isError=false, иначе 3.
"""
import json
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
exe, data, tool = sys.argv[1], sys.argv[2], sys.argv[3]
args = {}
for pair in sys.argv[4:]:
    key, _, raw = pair.partition("=")
    try:
        args[key] = json.loads(raw)
    except ValueError:
        args[key] = raw
msgs = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize",
     "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "a11", "version": "1"}}},
    {"jsonrpc": "2.0", "method": "notifications/initialized"},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool, "arguments": args}},
]
p = subprocess.run([exe, "mcp", "--data", data], input="\n".join(json.dumps(m) for m in msgs) + "\n",
                   capture_output=True, text=True, encoding="utf-8", timeout=120)
reply = [json.loads(l) for l in p.stdout.splitlines() if l.strip()]
res = next((r for r in reply if r.get("id") == 2), {})
if "result" not in res:
    print(json.dumps({"isError": True, "text": json.dumps(res.get("error", res), ensure_ascii=False), "structured": None}, ensure_ascii=False))
    sys.exit(3)
r = res["result"]
print(json.dumps({"isError": r.get("isError", False), "text": r["content"][0]["text"], "structured": r.get("structuredContent")}, ensure_ascii=False))
sys.exit(3 if r.get("isError") else 0)
```

### `a11_killswitch.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A11, часть Г: настройка kill switch (tun.kill_switch) без запуска TUN.

Запуск: python -I a11_killswitch.py <lavray-core.exe> <каталог для данных>
TUN не создаётся: подключение в режиме TUN идёт с validate_only (конфиг собирается и проверяется, инстанс не стартует).
"""
import json
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
exe, data = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(data, exist_ok=True)
tok = secrets.token_urlsafe(32)
core = subprocess.Popen([exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", data],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
core.stdin.write((tok + "\n").encode())
core.stdin.flush()
base = "http://" + core.stdout.readline().decode().split()[1].replace("tcp://", "")
bad = []


def rpc(svc, method, body):
    req = urllib.request.Request(f"{base}/lavray.v1.{svc}/{method}", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def check(cid, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + cid + ("" if ok else " :: " + str(detail)[:200]))
    if not ok:
        bad.append(cid)


def value(key):
    st, r = rpc("SettingsService", "GetSettings", {"keys": [key]})
    return st, (r.get("values", {}).get(key, {}) if isinstance(r, dict) else {})


try:
    st, desc = rpc("SettingsService", "DescribeSettings", {})
    check("describe: tun.kill_switch описана", st == 200 and "tun.kill_switch" in json.dumps(desc), st)
    st, v = value("tun.kill_switch")
    check("по умолчанию выключен", st == 200 and not json.dumps(v).count("true"), v)
    st, r = rpc("SettingsService", "SetSettings", {"values": {"tun.kill_switch": {"boolValue": True}}})
    check("включение принято", st == 200 and "tun.kill_switch" in r.get("acceptedKeys", []), r)
    st, v = value("tun.kill_switch")
    check("значение true читается обратно", st == 200 and json.dumps(v).count("true") == 1, v)
    gid = rpc("ProfileService", "ListGroups", {})[1]["groups"][0]["id"]
    rpc("ProfileService", "ImportContent", {"content": "socks://127.0.0.1:9#a11-ks", "intent": "INTENT_AS_LINKS", "targetGroupId": gid})
    pid = rpc("ProfileService", "ListProfiles", {})[1]["profiles"][0]["id"]
    st, r = rpc("CoreService", "Connect", {"profileId": pid, "mode": "CONNECT_MODE_TUN", "validateOnly": True})
    warns = " ".join(r.get("warnings", [])) if isinstance(r, dict) else ""
    check("TUN validate_only: конфиг собран, инстанс не запущен", st == 200 and "validate_only" in warns
          and r.get("status", {}).get("state") in (None, "CORE_STATE_IDLE"), (st, str(r)[:200]))
    st, r = rpc("SettingsService", "SetSettings", {"values": {"tun.kill_switch": {"boolValue": False}}})
    st, v = value("tun.kill_switch")
    check("выключение читается обратно", st == 200 and json.dumps(v).count("true") == 0, v)
finally:
    core.stdin.close()
    core.wait(timeout=20)
print(f"A11-Г: провалов {len(bad)}")
sys.exit(1 if bad else 0)
```

### `a11_tun.py`

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A11, часть Д (необязательная): настоящий TUN с kill switch. Только администратор, только тестовый ПК.

Запуск: python -I a11_tun.py <lavray-core.exe> <каталог для данных> <порт апстрима>
ВНИМАНИЕ: пока TUN поднят (до ~30 с), весь трафик ПК идёт в туннель, а апстрим (loopback) ничего никуда
не передаёт: сеть на ПК пропадает. Блок finally всегда выполняет Disconnect и закрывает ядро.
"""
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
exe, data, up_port = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]), sys.argv[3]
os.makedirs(data, exist_ok=True)
tok = secrets.token_urlsafe(32)
core = subprocess.Popen([exe, "serve", "--listen-socket", "127.0.0.1:0", "--data", data],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
core.stdin.write((tok + "\n").encode())
core.stdin.flush()
base = "http://" + core.stdout.readline().decode().split()[1].replace("tcp://", "")
bad = []


def rpc(svc, method, body, timeout=90):
    req = urllib.request.Request(f"{base}/lavray.v1.{svc}/{method}", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def check(cid, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + cid + ("" if ok else " :: " + str(detail)[:200]), flush=True)
    if not ok:
        bad.append(cid)


def adapter_present():
    cmd = "if (Get-NetAdapter -Name lavray-tun -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }"
    return subprocess.run(["pwsh", "-NoProfile", "-Command", cmd], capture_output=True, text=True).stdout.strip() == "yes"


connected = False
try:
    rpc("SettingsService", "SetSettings", {"values": {"tun.kill_switch": {"boolValue": True},
                                                      "connect.health_check": {"boolValue": False}}})
    gid = rpc("ProfileService", "ListGroups", {})[1]["groups"][0]["id"]
    rpc("ProfileService", "ImportContent", {"content": f"socks://127.0.0.1:{up_port}#a11-tun",
                                            "intent": "INTENT_AS_LINKS", "targetGroupId": gid})
    pid = rpc("ProfileService", "ListProfiles", {})[1]["profiles"][0]["id"]
    check("до подключения адаптера lavray-tun нет", not adapter_present(), "адаптер уже есть")
    t0 = time.time()
    st, r = rpc("CoreService", "Connect", {"profileId": pid, "mode": "CONNECT_MODE_TUN"})
    if st != 200:
        print("BLOCKED connect TUN:", str(r)[:300])
        bad.append("connect-tun")
    else:
        connected = True
        check("Connect TUN: состояние CONNECTED", r["status"]["state"] == "CORE_STATE_CONNECTED", r)
        time.sleep(3)
        check("адаптер lavray-tun появился", adapter_present(), "")
        st, cfg = rpc("CoreService", "GetRuntimeConfig", {})
        conf = json.loads(cfg.get("singBoxJson", "{}")) if isinstance(cfg, dict) else {}
        tun = [i for i in conf.get("inbounds", []) if i.get("type") == "tun"]
        check("в конфиге один inbound tun", len(tun) == 1, conf.get("inbounds"))
        if tun:
            check("tun: interface_name = lavray-tun", tun[0].get("interface_name") == "lavray-tun", tun[0])
            check("tun: strict_route = true (kill switch)", tun[0].get("strict_route") is True, tun[0])
            check("tun: auto_route = true", tun[0].get("auto_route") is True, tun[0])
finally:
    if connected:
        st, r = rpc("CoreService", "Disconnect", {}, timeout=60)
        check("Disconnect выполнен", st == 200, (st, str(r)[:100]))
    core.stdin.close()
    core.wait(timeout=30)
    time.sleep(3)
    check("после отключения адаптера lavray-tun нет", not adapter_present(), "адаптер остался")
print(f"A11-Д: провалов {len(bad)} (время с подключения: {time.time() - t0:.0f} с)" if connected else f"A11-Д: провалов {len(bad)}")
sys.exit(1 if bad else 0)
```
