# 01. Окружение тестового ПК

Выполняет оркестратор один раз до запуска файлов `auto/` и `manual/`. Субагенты читают только свой файл и этот документ (разделы 3, 4 и 10), поэтому переменные, каталоги и правила именования ниже обязательны для всех.

Команды в блоках `powershell` выполняются в PowerShell 7 (`pwsh`), в блоках `bash` — в Git Bash. Корень **фиксирован: `C:\lavray-test`**. Пути в файлах плана (в блоках `powershell`, `bash` и в скриптах) записаны буквально, страж, шаблоны очистки (`Path -like 'C:\lavray-test\*'`) и проверка маркера привязаны к тому же каталогу, поэтому другой корень выбирать нельзя. Переменная `LAVRAY_TP_ROOT` в `env.ps1` — константа, из которой собраны остальные пути; переопределять её не нужно.

## 1. Что нужно от тестового ПК

| Требование | Значение | Почему |
|---|---|---|
| ОС | Windows 10 22H2 или Windows 11, x64 | Единственная поддерживаемая платформа текущего выпуска |
| Тип машины | Виртуальная машина со снимком «до тестов» или отдельный ПК без личных данных | Файлы A04, A10, A11, M01, M03, M06, M08 меняют системный прокси, реестр, установленные программы; снимок — самый быстрый откат |
| Диск | не менее 30 ГБ свободно | Rust-сборка оболочки (`shell/target`) занимает 6–10 ГБ, `node_modules` около 0,5 ГБ, модули Go около 2 ГБ |
| Память | не менее 8 ГБ | Сборка оболочки и параллельные субагенты |
| Сеть | исходящий доступ к `github.com`, `proxy.golang.org`, `registry.npmjs.org`, `static.rust-lang.org`, `index.crates.io` | Установка инструментов и зависимостей |
| Пользователь | обычная учётная запись; возможность запустить PowerShell «от имени администратора» | A10 ставит программу в `C:\Program Files`; часть D файла A11 и M03 включают TUN |
| WebView2 Runtime | установлен (в Windows 11 есть) | Без него окно LAVRay не открывается; проверка: `Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -Name pv` |
| Время | синхронизировано | REALITY и VMess не подключаются при расхождении часов более чем на пару минут (см. строку `chk.time.err` словаря) |
| Антивирус | без исключений для проверки | Сборки не подписаны; если антивирус удалил или заблокировал файл, это результат прогона (`BLOCKED` в A06 или M01), а не повод отключать защиту |

Тестовый ПК не должен быть ПК, где владелец пользуется работающим VPN (NekoBox, TUN, свой системный прокси). Это проверяет страж из раздела 3.

## 2. Договорённости об именах (для всех файлов)

```text
C:\lavray-test\
  env.ps1            переменные окружения (создаёт оркестратор, раздел 4)
  guard.ps1          страж «тестовый ПК» (раздел 3)
  TESTPC_OK          маркер: страж пройден и владелец подтвердил (создаёт guard.ps1)
  plan\              клон ветки main с документами docs\test-plan (план исправляется после выхода тега; код на main равен v0.9.3)
  src\               клон продукта, переключённый на тег v0.9.3, ТОЛЬКО ЧТЕНИЕ
  wt\<ID>\           рабочая копия (git worktree) для файла <ID>; создаёт сам файл
  assets\0.9.3\      скачанные ассеты релиза под тестом (семь файлов, раздел 7)
  assets\0.3.0\      ассеты предыдущего релиза (для проверки обновления в A10, M01)
  portable\0.9.3\    распакованный ZIP (LAVRay.exe и binaries\lavray-core.exe)
  baseline\          снимки состояния системы до тестов (раздел 8)
  tmp\<ID>\          временные данные файла <ID>
  results\           отчёты <ID>.md и вложения <ID>\ ; итоговая SUMMARY.md
```

Правила для всех:

1. Продукт под тестом не правится. `src\` не изменяется; всё, что собирает или меняет файлы репозитория (`go mod tidy`, `buf generate`, `npm ci`, `cargo`), делается в своей рабочей копии `wt\<ID>`.
2. Ничего из `C:\lavray-test` не коммитится и не публикуется. В отчётах нет секретов: ссылки подписок, токены и содержимое `agent-endpoint.json` заменяются на `***`.
3. Порты: файлы используют случайные свободные loopback-порты (`127.0.0.1:0` или функция выбора свободного порта). Порт 2080 не занимается никогда. Диапазон `47950–47999` зарезервирован за A07 (`--mixed-port`).
4. Один исполнитель на файл. Два исполнителя не работают в одном каталоге `wt\<ID>` или `tmp\<ID>`.

## 3. Страж «тестовый ПК»

Страж защищает ПК владельца от ошибки: он отказывается ставить маркер, если видит признаки рабочего VPN. Маркер `TESTPC_OK` нужен каждому файлу с опасностью `прокси`, `TUN`, `реестр`, `установка` или `данные приложения` — **и автоматическим, и ручным**. Файл проверяет его первой командой (`Test-TestPc` из `env.ps1`, раздел 4): маркер существует, создан на **этом** ПК (поле `machine` равно имени компьютера) и не старше 30 суток. Без маркера (или с маркером, перенесённым с другого ПК) файл завершается итогом `BLOCKED`, ни один шаг не выполняется.

Подтверждение даёт только владелец: переменная окружения `LAVRAY_TESTPC_CONFIRMED=YES-DISPOSABLE` задаётся им в окне, откуда запущен ZCode (или в промпте из `00-README.md`). Оркестратор не имеет права задавать её сам, даже если страж ничего не нашёл.

Создайте файл `C:\lavray-test\guard.ps1` с таким содержимым:

```powershell
# guard.ps1: проверка «это тестовый ПК». Код выхода 0 - маркер создан, 1 - отказ.
$ErrorActionPreference = 'Stop'
$root = 'C:\lavray-test'
$marker = Join-Path $root 'TESTPC_OK'
$problems = New-Object System.Collections.Generic.List[string]

if ($env:LAVRAY_TESTPC_CONFIRMED -ne 'YES-DISPOSABLE') {
  $problems.Add('владелец не подтвердил: переменная LAVRAY_TESTPC_CONFIRMED не равна YES-DISPOSABLE')
}

$vpnProcs = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -match '^(nekobox|nekoray|nekobox_core|v2rayN|clash|mihomo|sing-box|xray|wireguard|openvpn|LAVRay|lavray-core)' }
if ($vpnProcs) {
  $problems.Add('запущены процессы VPN или LAVRay: ' + (($vpnProcs | Select-Object -ExpandProperty ProcessName -Unique) -join ', '))
}

$adapters = Get-NetAdapter -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'neko|tun|wintun|wireguard|lavray' -or $_.InterfaceDescription -match 'Wintun|WireGuard|TAP' }
if ($adapters) {
  $problems.Add('сетевые адаптеры VPN: ' + (($adapters | Select-Object -ExpandProperty Name) -join ', '))
}

if (Get-NetTCPConnection -State Listen -LocalPort 2080 -ErrorAction SilentlyContinue) {
  $problems.Add('порт 2080 занят (там работает чужой прокси)')
}

$inet = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
if ($inet.ProxyEnable -eq 1) {
  $problems.Add('системный прокси уже включён: ' + $inet.ProxyServer)
}
if ($inet.AutoConfigURL) {
  $problems.Add('в системе задан PAC-скрипт: ' + $inet.AutoConfigURL)
}

# VPN-подключения Windows (RAS) не запрещают тест, но LAVRay временно меняет их прокси.
$ras = @(Get-VpnConnection -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'LavrayTestVpn' })
if ($ras.Count -gt 0) {
  Write-Host ('ВНИМАНИЕ: в Windows есть VPN-подключения: ' + (($ras | Select-Object -ExpandProperty Name) -join ', ') +
              '. Тест временно сменит их прокси и вернёт обратно.')
}

if ($problems.Count -gt 0) {
  Remove-Item -LiteralPath $marker -ErrorAction SilentlyContinue
  Write-Host 'СТОП: это не тестовый ПК или он не подтверждён:'
  $problems | ForEach-Object { Write-Host (' - ' + $_) }
  exit 1
}

New-Item -ItemType Directory -Force -Path $root | Out-Null
# Маркер несёт содержимое, а не только факт существования: имя ПК, пользователь, время (UTC) и подтверждение владельца.
# Test-TestPc (env.ps1) сверяет machine с именем этого ПК и возраст, поэтому маркер, скопированный на другой ПК, не годится.
[pscustomobject]@{
  machine   = $env:COMPUTERNAME
  user      = $env:USERNAME
  utc       = (Get-Date).ToUniversalTime().ToString('o')
  confirmed = $env:LAVRAY_TESTPC_CONFIRMED
} | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding utf8
Write-Host "OK: маркер создан: $marker"
exit 0
```

Запуск и критерий:

```powershell
pwsh -NoProfile -File C:\lavray-test\guard.ps1
$LASTEXITCODE
```

PASS: код выхода `0` и существует файл `C:\lavray-test\TESTPC_OK` (после `. C:\lavray-test\env.ps1` команда `Test-TestPc` печатает `True`). FAIL (стоп всего прогона опасных файлов): код `1`; оркестратор показывает владельцу список причин и не продолжает.

Файлы **без** опасности запускаются и без маркера: A01, A02, A03, A05, A06, A07, A08, A09, A12, A13, A14, A15, M02, M07, M18. Файлы с опасностью проверяют маркер целиком: A04, A10, A11, M01, M03, M04, M06, M08, M10, M11, M12, M14, M15, M17, M19. Файлы с опасностью в **части** проверяют маркер перед этой частью (без него блокируется только она): M05 и M09 — часть 6, M13 — часть 3 и шаг 4.31, M16 — часть 8.

## 4. Переменные окружения

Создайте `C:\lavray-test\env.ps1`. Каждый субагент первым шагом выполняет `. C:\lavray-test\env.ps1`.

```powershell
# env.ps1: переменные плана. Секреты здесь НЕ хранятся.
$env:LAVRAY_TP_ROOT   = 'C:\lavray-test'
$env:LAVRAY_REPO      = 'anatolijlaptev1991-ctrl/lavray'
# Оба репозитория (lavray, lavray-windows) публичные, но GitHub CLI без входа не работает: нужен gh auth login или GH_TOKEN.
$env:LAVRAY_RELEASES_REPO = 'anatolijlaptev1991-ctrl/lavray-windows'
$env:LAVRAY_VERSION   = '0.9.3'
$env:LAVRAY_FROM_VERSION = '0.3.0'
# Под тестом всегда РЕЛИЗ v0.9.3 (<TAG> в документах плана = v0.9.3). План берётся с main, где его исправляют уже после тега.
# main у продукта - только запасной вариант на случай, когда тег ещё не выпущен; тогда в отчёте указывайте фактический коммит.
$env:LAVRAY_REF       = 'v0.9.3'
$env:LAVRAY_REF_FALLBACK = 'main'
$env:LAVRAY_SRC       = Join-Path $env:LAVRAY_TP_ROOT 'src'
$env:LAVRAY_PLAN      = Join-Path $env:LAVRAY_TP_ROOT 'plan'
$env:LAVRAY_ASSETS    = Join-Path $env:LAVRAY_TP_ROOT ('assets\' + $env:LAVRAY_VERSION)
$env:LAVRAY_ASSETS_OLD = Join-Path $env:LAVRAY_TP_ROOT ('assets\' + $env:LAVRAY_FROM_VERSION)
$env:LAVRAY_PORTABLE  = Join-Path $env:LAVRAY_TP_ROOT ('portable\' + $env:LAVRAY_VERSION)
$env:LAVRAY_CORE_EXE  = Join-Path $env:LAVRAY_PORTABLE 'binaries\lavray-core.exe'
$env:LAVRAY_RESULTS   = Join-Path $env:LAVRAY_TP_ROOT 'results'
$env:LAVRAY_BASELINE  = Join-Path $env:LAVRAY_TP_ROOT 'baseline'
# Go: на свежем ПК прокси модулей включён (A02 разрешает сеть).
$env:CGO_ENABLED      = '0'

# Общие проверки (используются в файлах плана).
# Коммит под тестом - ВСЕГДА коммит тега, а не HEAD клона плана или рабочей копии.
function Get-RefCommit { git -C $env:LAVRAY_SRC rev-parse "$($env:LAVRAY_REF)^{commit}" }
# Клон продукта создан с core.autocrlf=false (иначе buf format и кодогенерация дают ложные расхождения).
function Test-RepoLf { (git -C $env:LAVRAY_SRC config core.autocrlf) -eq 'false' }
# Маркер тестового ПК: файл есть, создан на ЭТОМ ПК (machine = имя компьютера), не старше 30 суток.
function Test-TestPc {
  $m = 'C:\lavray-test\TESTPC_OK'
  if (-not (Test-Path -LiteralPath $m)) { return $false }
  try { $j = Get-Content -LiteralPath $m -Raw | ConvertFrom-Json } catch { return $false }
  if ($j.machine -ne $env:COMPUTERNAME) { return $false }
  $utc = if ($j.utc -is [datetime]) { $j.utc.ToUniversalTime() } else { [datetime]::Parse([string]$j.utc).ToUniversalTime() }
  return (((Get-Date).ToUniversalTime() - $utc).TotalDays -lt 30)
}
```

Переменные, которые задаёт только владелец (оркестратор их лишь читает и никогда не печатает значения):

| Переменная | Назначение | Обязательна для |
|---|---|---|
| `LAVRAY_TESTPC_CONFIRMED` | `YES-DISPOSABLE`: «это тестовый ПК» | страж (раздел 3) |
| `LAVRAY_TEST_SUB_URL` | ссылка тестовой подписки провайдера (секрет) | M02, часть шагов M03 |
| `LAVRAY_ALLOW_TUN` | `1`: разрешить включение TUN на этом ПК (сеть пропадёт на время теста) | часть D файла A11, M03 (TUN) |
| `GH_TOKEN` | токен GitHub только для чтения; либо владелец заранее выполнил `gh auth login` | все команды `gh`: клон `src\` и `plan\`, скачивание ассетов. GitHub CLI без входа не работает даже с публичными репозиториями |

Проверка наличия без печати значений:

```powershell
foreach ($n in 'LAVRAY_TESTPC_CONFIRMED','LAVRAY_TEST_SUB_URL','LAVRAY_ALLOW_TUN','GH_TOKEN') {
  '{0}: {1}' -f $n, $(if ([Environment]::GetEnvironmentVariable($n)) { 'задана' } else { 'не задана' })
}
```

## 5. Установка инструментов

Репозитории `lavray` и `lavray-windows` публичные, но GitHub CLI без входа не выполняет ни одной команды: ни клон `src\` и `plan\` (на них держатся почти все файлы), ни `gh release download`. Если `gh auth status` завершается кодом, отличным от нуля, и `GH_TOKEN` не задан, прогон получает итог `BLOCKED` с просьбой к владельцу выполнить `gh auth login` (оркестратор не вводит и не запрашивает пароли и токены). Релизы публикуются в `anatolijlaptev1991-ctrl/lavray-windows`.

```powershell
gh auth status
$LASTEXITCODE
```

Установка через winget (если инструмент уже есть и версия не ниже минимальной, пропустите). Для Windows 10 без winget установите «Установщик приложений» из Microsoft Store.

```powershell
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
winget install --id GitHub.cli -e
winget install --id Microsoft.PowerShell -e
winget install --id GoLang.Go -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id OpenJS.NodeJS -e --version 24.16.0
winget install --id Python.Python.3.12 -e
rustup default stable
rustup component add rustfmt clippy
npm install -g @bufbuild/buf@1.75.0
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.12
go install connectrpc.com/connect/cmd/protoc-gen-connect-go@v1.21.1
```

После установки откройте новое окно PowerShell (PATH обновляется только там) и проверьте версии. Минимумы взяты из CI и из файлов репозитория; столбец «Эталон» — версии, на которых план проверялся при написании.

| Инструмент | Команда | Минимум | Эталон | Откуда минимум |
|---|---|---|---|---|
| Git | `git --version` | 2.40 | 2.56.0.windows.2 | любой современный |
| Go | `go version` | версия из строки `go` файла `core/go.mod` (сейчас 1.27) | go1.27.0 windows/amd64 | `core/go.mod`; `actions/setup-go` с `go-version-file` |
| Rust | `rustc --version`, `cargo --version` | stable | 1.96.0 | CI: `dtolnay/rust-toolchain@stable` |
| Node | `node --version` | 24 | v24.16.0 | CI: `node-version: 24` |
| npm | `npm --version` | 10 | 11.16.0 | идёт с Node |
| Python | `python --version` | 3.12 | 3.12.0 | CI: `python-version: "3.12"` |
| buf | `buf --version` | 1.75.0 | 1.75.0 | CI: `buf_version: "1.75.0"` |
| gh | `gh --version` | 2.40 | 2.96.0 | любой современный |
| PowerShell | `pwsh --version` | 7.4 | 7.6.9 | нужен для `Add-VpnConnection` и `Parser` |
| protoc-gen-go | `protoc-gen-go --version` | v1.36.12 | `protoc-gen-go.exe v1.36.12` | заголовок `core/internal/gen/lavrayv1/lavray.pb.go` |
| protoc-gen-connect-go | `protoc-gen-connect-go --version` | 1.21.1 | 1.21.1 (печатает без буквы `v`) | версия `connectrpc.com/connect` в `core/go.mod` |
| WSL2 (Ubuntu) | `wsl -l -v` | WSL2 с любым дистрибутивом | Ubuntu 24.04 | только A06, шаг 16: запуск `lavray-core-linux-amd64`; без него этот шаг `BLOCKED` |

Проверка одним блоком (PASS: каждая строка печатает версию, код выхода каждой команды 0):

```powershell
foreach ($c in 'git --version','go version','rustc --version','cargo --version','node --version','npm --version',
               'python --version','buf --version','gh --version','pwsh --version',
               'protoc-gen-go --version','protoc-gen-connect-go --version') {
  $out = & cmd.exe /c "$c 2>&1"
  '{0,-32} exit={1}  {2}' -f $c, $LASTEXITCODE, ($out | Select-Object -First 1)
}
```

Git: репозиторий хранит LF, а в `C:\Program Files\Git\etc\gitconfig` по умолчанию стоит `core.autocrlf=true`: с ним `buf format -d` и кодогенерация видят CRLF и дают ложный `FAIL` (проверено). Глобальные настройки ПК план **не меняет**: клоны создаются с ключом `-c core.autocrlf=false` (раздел 6), а A01 перед работой проверяет это и останавливается с понятным сообщением.

```powershell
gh auth setup-git
```

## 6. Клонирование

Продукт под тестом клонируется один раз в `src\` и после этого только читается. Рабочие копии файлы создают сами через `git worktree add`.

```powershell
. C:\lavray-test\env.ps1
New-Item -ItemType Directory -Force -Path C:\lavray-test, $env:LAVRAY_RESULTS, $env:LAVRAY_BASELINE | Out-Null
# core.autocrlf=false задаётся только для клона; глобальные настройки Git не меняются.
gh repo clone $env:LAVRAY_REPO $env:LAVRAY_SRC -- -c core.autocrlf=false
git -C $env:LAVRAY_SRC fetch --tags origin
git -C $env:LAVRAY_SRC rev-parse --verify --quiet "refs/tags/$($env:LAVRAY_REF)^{commit}"
if ($LASTEXITCODE -ne 0) {
  Write-Host "тега $($env:LAVRAY_REF) нет: берём запасной вариант $($env:LAVRAY_REF_FALLBACK) (отклонение, укажите коммит в отчёте)"
  $env:LAVRAY_REF = $env:LAVRAY_REF_FALLBACK
}
git -C $env:LAVRAY_SRC checkout --detach $env:LAVRAY_REF
"HEAD клона:         " + (git -C $env:LAVRAY_SRC rev-parse HEAD)
"коммит $($env:LAVRAY_REF):   " + (Get-RefCommit)
"core.autocrlf:      " + (git -C $env:LAVRAY_SRC config core.autocrlf)
git -C $env:LAVRAY_SRC status --short
```

PASS: `HEAD клона` и `коммит v0.9.3` — одинаковые 40 шестнадцатеричных символов, `core.autocrlf: false`, `status --short` пуст. Во всех файлах плана коммит под тестом получают из `Get-RefCommit` (то есть `git rev-parse "v0.9.3^{commit}"`), а не из `HEAD`. По умолчанию проверяется тег `v0.9.3`. Если его нет, блок выше берёт запасной вариант `main` (`LAVRAY_REF_FALLBACK`): это отклонение, его и фактический коммит (`rev-parse HEAD`) записывают в отчёт; ассеты релиза при этом недоступны, и файлы с установщиком и ZIP получают `BLOCKED`.

Документы плана берутся отдельным клоном **ветки `main`**: исправления плана вносятся после выхода тега, а исходный код на `main` равен `v0.9.3` (отличается только `docs\test-plan`). Продукт в `src\` остаётся только для чтения и стоит на теге; тестируется всегда релиз `v0.9.3` (ассеты скачиваются с релиза, сравнения коммитов идут с `Get-RefCommit`, не с `HEAD` клона плана). В быстром старте (`00-README.md`, раздел 9) владелец клонирует план так же:

```powershell
gh repo clone $env:LAVRAY_REPO $env:LAVRAY_PLAN -- -c core.autocrlf=false
git -C $env:LAVRAY_PLAN fetch --tags origin
Test-Path (Join-Path $env:LAVRAY_PLAN 'docs\test-plan\00-README.md')
```

PASS: `True`. Если main ушёл вперёд тега за счёт кода (а не плана), это отклонение записывается в отчёт; тестируется по-прежнему тег.

Рабочая копия для файла `<ID>` создаётся так (каждый файл повторяет это в своём первом шаге):

```powershell
git -C $env:LAVRAY_SRC worktree add --detach C:\lavray-test\wt\A02 $env:LAVRAY_REF
```

## 7. Ассеты релиза

Имена Windows-файлов задаёт `.github/workflows/release-windows.yml` (шаг «Версия и имена ассетов») и подтверждает тест `core/internal/buildtags`; Linux-файлы — `.github/workflows/release-linux.yml`:

| Файл | Что это |
|---|---|
| `LAVRay-<версия>-x64-setup.exe` | установщик NSIS, на уровне компьютера (`C:\Program Files\LAVRay`) |
| `LAVRay-<версия>-portable-x64.zip` | `LAVRay.exe`, `binaries\lavray-core.exe`, `LICENSE` |
| `SHA256SUMS.txt` | суммы SHA-256 двух файлов выше, строки `<хэш>  <имя>`, окончания строк CRLF (файл написан `Set-Content` в Windows) |
| `lavray-core-linux-amd64`, `lavray-core-linux-arm64` | ядро для Linux (ELF), собрано с тегом `with_webui` (веб-панель внутри) workflow `release-linux.yml` |
| `ui-dist.tar.gz` | собранный интерфейс (`tar -C ui/dist -czf ui-dist.tar.gz .`), в корне архива `index.html` |
| `SHA256SUMS-linux.txt` | суммы трёх Linux-файлов, окончания строк LF (`sha256sum`) |

Всего **семь** файлов. Каталога `meta/` (подписанные метаданные центра обновлений) в релизе пока нет: ключей подписи не создано, задание `sign` пропускает себя. Для проверки обновления через `meta/` нужен тестовый корень (A13, M12); отсутствие `meta/` в релизе не дефект.

```powershell
. C:\lavray-test\env.ps1
New-Item -ItemType Directory -Force -Path $env:LAVRAY_ASSETS, $env:LAVRAY_ASSETS_OLD | Out-Null
gh release download "v$($env:LAVRAY_VERSION)" --repo $env:LAVRAY_RELEASES_REPO -D $env:LAVRAY_ASSETS --clobber
"новая версия: код $LASTEXITCODE"
gh release download "v$($env:LAVRAY_FROM_VERSION)" --repo $env:LAVRAY_RELEASES_REPO -D $env:LAVRAY_ASSETS_OLD --clobber
"прежняя версия: код $LASTEXITCODE"
Get-ChildItem $env:LAVRAY_ASSETS, $env:LAVRAY_ASSETS_OLD | Select-Object Directory, Name, Length
```

Состояние: финальный релиз — **v0.9.3** (семь файлов выше; репозиторий релизов `lavray-windows` публичный). Прежние релизы `v0.2.0`, `v0.2.1`, `v0.3.0` опубликованы (`v0.1.0` удалён); `v0.3.0` нужен как «прежняя версия» для проверки обновления поверх (установщик 16 518 811 байт, ZIP 22 911 985 байт, `SHA256SUMS.txt` 191 байт; реальная база этой версии — схема SQLite 4). Поэтому:

- если скачивание `v0.9.3` завершилось ошибкой `release not found`, это `BLOCKED` для A06, A10, A11, M01 (шаги с установщиком и ZIP версии 0.9.3), а не `FAIL`. Кто снимает: владелец (тег `v0.9.3`, запуск `release-windows` и `release-linux`);
- пока релиза нет, оркестратор может запускать файлы A01–A05, A07, A08, а A06, A10, A11, M-файлы с установщиком отмечать `BLOCKED`.

Распаковка portable (после проверки сумм в A06; допустимо и до неё, если файл не меняется):

```powershell
Expand-Archive -LiteralPath (Join-Path $env:LAVRAY_ASSETS ('LAVRay-' + $env:LAVRAY_VERSION + '-portable-x64.zip')) -DestinationPath $env:LAVRAY_PORTABLE -Force
Test-Path $env:LAVRAY_CORE_EXE
Test-Path (Join-Path $env:LAVRAY_PORTABLE 'LAVRay.exe')
```

PASS: оба `True`.

Файлы, скачанные через `gh`, не получают метку «из интернета» (Zone.Identifier), поэтому SmartScreen при запуске из скрипта не вмешивается. Ручные файлы (M01) проверяют поведение SmartScreen отдельно.

## 8. Порты, NekoBox, снимок системы

Порты, которые должны быть свободны на старте:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -eq 2080 -or ($_.LocalPort -ge 47950 -and $_.LocalPort -le 47999) } |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

PASS: вывод пуст. Если порт 2080 занят, страж уже отказал (раздел 3); не освобождайте его принудительно.

NekoBox. Если на машине обнаружен NekoBox (`nekobox.exe`, `nekobox_core.exe`, `nekoray.exe`), это признак того, что машина не тестовая. Оркестратор останавливается и сообщает владельцу. Если владелец письменно подтвердил, что машина тестовая, NekoBox закрывают в таком порядке: пункт «Выход» в меню значка в трее; если процесс остался, `Stop-Process -Name nekobox, nekobox_core, nekoray -Force`; затем проверка, что адаптера `neko-tun` нет (`Get-NetAdapter -Name neko-tun -ErrorAction SilentlyContinue` ничего не печатает) и системный прокси выключен. Оркестратор не удаляет NekoBox и не меняет его настройки.

Снимок системы до тестов нужен для проверки отката (все файлы с опасностью `прокси`, `TUN`, `реестр` сравнивают состояние с ним):

```powershell
. C:\lavray-test\env.ps1
$b = $env:LAVRAY_BASELINE
New-Item -ItemType Directory -Force -Path $b | Out-Null
reg export "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" (Join-Path $b 'internet-settings.reg') /y
$LASTEXITCODE
reg export "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" (Join-Path $b 'run.reg') /y
$LASTEXITCODE
Get-NetAdapter | Select-Object Name, InterfaceDescription, Status | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $b 'adapters.json')
Get-NetRoute -AddressFamily IPv4 | Select-Object DestinationPrefix, NextHop, InterfaceIndex, RouteMetric | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $b 'routes.json')
# vpn.json пишется всегда: если VPN-подключений нет, получается пустой массив «[]», а не отсутствие файла.
# (Конвейер «Get-VpnConnection | ConvertTo-Json | Set-Content» при пустом результате не создаёт файл вовсе.)
$vpn = @(Get-VpnConnection -ErrorAction SilentlyContinue | Select-Object Name, ServerAddress, TunnelType)
ConvertTo-Json -InputObject $vpn | Set-Content -Encoding utf8 (Join-Path $b 'vpn.json')
Get-ChildItem $b | Select-Object Name, Length
"vpn.json - массив: " + (Get-Content (Join-Path $b 'vpn.json') -Raw -Encoding utf8).Trim().StartsWith('[')
```

PASS: оба `reg export` вернули `0`, в `baseline\` есть пять файлов, `internet-settings.reg` непустой, последняя строка `vpn.json - массив: True`. Если VPN-подключений нет, `vpn.json` содержит пустой массив `[]`: это допустимо и проверкой принимается. Отсутствие файла `vpn.json` не допускается (команда создаёт его всегда).

Читать эти файлы можно в любой момент; изменять нельзя.

## 9. Проверка Go-модулей и сети (быстрая)

Перед стартом убедитесь, что Go умеет скачивать модули (A02 разрешает сеть, A03 тоже). В отличие от ПК владельца, где модули кэшированы и `GOPROXY=off`, на свежей машине нужен доступ в сеть:

```powershell
go env GOPROXY GOFLAGS GOTOOLCHAIN
```

Ожидается `GOPROXY=https://proxy.golang.org,direct`. Форк sing-box (`github.com/anatolijlaptev1991-ctrl/sing-box`) публичный; для него, как в CI, при тегированных сборках задаются `GOPRIVATE=github.com/anatolijlaptev1991-ctrl/*` и `GOFLAGS=-mod=mod` (это делает файл A03 только внутри своей рабочей копии, потому что `-mod=mod` переписывает `core/go.mod`).

## 10. Порядок завершения прогона

После последнего файла оркестратор:

1. Проверяет, что процессов `lavray-shell` (оболочка установленной версии), `LAVRay` (оболочка из portable ZIP), `lavray-core` нет: `Get-Process lavray-shell, LAVRay, lavray-core -ErrorAction SilentlyContinue` ничего не печатает.
2. Сверяет `Internet Settings` с `baseline\internet-settings.reg` (команда есть в «Откате» файла A11).
3. Удаляет рабочие копии: `git -C $env:LAVRAY_SRC worktree prune` и `Remove-Item -Recurse -Force C:\lavray-test\wt`.
4. Удаляет маркер `TESTPC_OK` (чтобы опасные файлы нельзя было запустить случайно позже).
5. Оставляет `results\`, `assets\` и `baseline\` для владельца. Секретов в них нет.
6. Если машина виртуальная — откатывает снимок «до тестов» после того, как владелец забрал `results\`.
