# A06. Ассеты релиза: имена, суммы, содержимое, теги ядра, подписи

| Поле | Значение |
|---|---|
| ID | A06 |
| Слой | авто |
| Время | 5–10 минут (скачивание около 40 МБ) |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–7 (доступ `gh` к приватному репозиторию, скачанные ассеты) |
| Опасность | нет: файлы только скачиваются и читаются. Ничего не запускается из скачанного, кроме `go version -m` (читает метаданные) |

## Цель

Проверить, что опубликованные Windows-ассеты версии под тестом целы, названы так, как задаёт `release-windows.yml`, собраны из нужного коммита с нужными тегами ядра и не содержат лишнего. Покрывает шаг «Проверка ассетов (суммы, теги ядра, smoke, MCP)» общей готовности каждой фазы плана (п. 10.7); сам smoke и MCP — файлы A07 и A08 (они должны быть запущены на ядре из этого же ZIP).

## Предусловия

- `gh auth status` успешен; доступ на чтение к `anatolijlaptev1991-ctrl/lavray` (репозиторий приватный).
- Go (для `go version -m`), PowerShell 7, Git.
- Релиз `v0.4.0` может быть ещё не опубликован. Тогда шаги 2–11 для этой версии получают `BLOCKED` (причина: релиз не найден; снять может владелец, выпустив тег). В этом случае для проверки самого файла выполните «репетицию» на `v0.3.0`: те же шаги с `$ver = '0.3.0'`; результат репетиции в итог файла не входит, но показывает, что команды рабочие.
- Ожидаемые значения ниже заданы для версии 0.4.0; для репетиции подставляются `0.3.0` и размеры из шага 4.

## Безопасность

Файлы скачиваются в `C:\lavray-test\assets\<версия>\` по команде `gh release download` (имена и размеры названы в шаге 3; это ассеты собственного репозитория владельца). Метка «из интернета» (Zone.Identifier) на файлы не ставится. Распакованный ZIP не запускается.

## Шаги

1. Окружение и версия.

```powershell
. C:\lavray-test\env.ps1
$ver = $env:LAVRAY_VERSION
$dir = $env:LAVRAY_ASSETS
$repo = $env:LAVRAY_REPO
gh auth status
"auth exit=$LASTEXITCODE"
"версия под тестом: $ver"
```

   Ожидается: `auth exit=0`. Иначе `BLOCKED` (просьба к владельцу: `gh auth login`).

2. Релиз опубликован, список ассетов.

```powershell
$rel = gh release view "v$ver" -R $repo --json tagName,isDraft,isPrerelease,assets,targetCommitish 2>&1
"view exit=$LASTEXITCODE"
$rel | ConvertFrom-Json | Select-Object tagName, isDraft, isPrerelease, targetCommitish
($rel | ConvertFrom-Json).assets | Select-Object name, size
```

   Ожидается: `view exit=0`, `isDraft=False`. Ответ `release not found` — `BLOCKED` для всех шагов версии 0.4.0 (см. «Предусловия»).

3. Состав ассетов: ровно три файла с именами из workflow.

```powershell
$want = @("LAVRay-$ver-x64-setup.exe", "LAVRay-$ver-portable-x64.zip", 'SHA256SUMS.txt') | Sort-Object
$have = (($rel | ConvertFrom-Json).assets | ForEach-Object name) | Sort-Object
"want: $($want -join ', ')"
"have: $($have -join ', ')"
"совпадают: " + (($want -join '|') -eq ($have -join '|'))
```

   Ожидается `совпадают: True`. Лишние файлы (например, `.minisig`) не ошибка плана 0.4.0, но их подписи проверяются на шаге 11; отсутствие любого из трёх — `FAIL`.

4. Скачивание и размеры.

```powershell
New-Item -ItemType Directory -Force -Path $dir | Out-Null
gh release download "v$ver" -R $repo -D $dir --clobber
"download exit=$LASTEXITCODE"
Get-ChildItem $dir | Select-Object Name, Length
$setup = Join-Path $dir "LAVRay-$ver-x64-setup.exe"
"установщик <= 25 МБ: " + ((Get-Item $setup).Length -le 25MB)
```

   Ожидается: `download exit=0`, три файла, `установщик <= 25 МБ: True` (бюджет из `docs/TEST-PLAN.md`, раздел 2). Для сравнения: у `v0.3.0` установщик 16 518 811 байт, ZIP 22 911 985 байт, `SHA256SUMS.txt` 191 байт.

5. Контрольные суммы. `SHA256SUMS.txt` написан `Set-Content` в Windows: окончания строк CRLF, формат `<хэш в нижнем регистре><два пробела><имя>`. Поэтому сверка идёт PowerShell, а не `sha256sum -c` (тот увидел бы `\r` в имени).

```powershell
$sums = Join-Path $dir 'SHA256SUMS.txt'
$lines = Get-Content $sums | Where-Object { $_.Trim() -ne '' }
"строк в файле сумм: $($lines.Count)"
$allOk = $true
foreach ($l in $lines) {
  $h, $n = $l -split '\s+', 2
  $file = Join-Path $dir $n.Trim()
  $actual = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
  $ok = ($actual -eq $h.ToLower()) -and ($h -cmatch '^[0-9a-f]{64}$')
  '{0}  {1}  {2}' -f $(if ($ok) { 'OK  ' } else { 'FAIL' }), $h.Substring(0, 12), $n
  if (-not $ok) { $allOk = $false }
}
"суммы совпали: $allOk"
```

   Ожидается: две строки `OK` (установщик и ZIP), `суммы совпали: True`. В файле сумм нет строки про сам `SHA256SUMS.txt` (workflow считает только `.exe` и `.zip`). То же через bash, если нужно (строки CRLF обрабатываются так):

```bash
cd /c/lavray-test/assets/0.4.0 && tr -d '\r' < SHA256SUMS.txt | sha256sum -c -
```

   Ожидается: две строки `... OK`.

6. Содержимое portable ZIP: ровно `LAVRay.exe`, `binaries/lavray-core.exe`, `LICENSE`.

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $dir "LAVRay-$ver-portable-x64.zip"
$z = [System.IO.Compression.ZipFile]::OpenRead($zip)
$entries = $z.Entries | Where-Object { $_.FullName -notmatch '/$' } | ForEach-Object { '{0} {1}' -f $_.FullName, $_.Length }
$z.Dispose()
$entries
$names = ($entries | ForEach-Object { ($_ -split ' ')[0] }) | Sort-Object
"файлов: $($names.Count)"
"состав верный: " + (($names -join '|') -eq (('LAVRay.exe', 'LICENSE', 'binaries/lavray-core.exe' | Sort-Object) -join '|'))
```

   Ожидается: `файлов: 3`, `состав верный: True`. Если Compress-Archive записал пути с обратной косой чертой (`binaries\lavray-core.exe`), замените в сравнении `/` на `\` и отметьте как наблюдение.

7. Распаковка и архитектура.

```powershell
Remove-Item -Recurse -Force $env:LAVRAY_PORTABLE -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $zip -DestinationPath $env:LAVRAY_PORTABLE -Force
function Get-PeMachine([string]$Path) {
  $fs = [IO.File]::OpenRead($Path)
  try { $pe = New-Object System.Reflection.PortableExecutable.PEReader($fs); [string]$pe.PEHeaders.CoffHeader.Machine } finally { $fs.Dispose() }
}
foreach ($f in 'LAVRay.exe', 'binaries\lavray-core.exe') {
  '{0}: {1}' -f $f, (Get-PeMachine (Join-Path $env:LAVRAY_PORTABLE $f))
}
```

   Ожидается: у обоих `Amd64`.

8. Ядро из ZIP собрано из нужного коммита с нужными тегами (`go version -m` читает метаданные, ничего не запускает).

```powershell
$core = $env:LAVRAY_CORE_EXE
$info = (go version -m $core) -join "`n"
$tags = (Get-Content (Join-Path $env:LAVRAY_SRC 'core\BUILD_TAGS') -Raw).Trim()
"tags в BUILD_TAGS: $tags"
"теги в бинарнике:   " + [bool]($info -match [regex]::Escape("-tags=$tags"))
"trimpath:           " + [bool]($info -match '-trimpath=true')
"CGO отключён:       " + [bool]($info -match 'CGO_ENABLED=0')
"форк закреплён:     " + [bool]($info -match '=>\s+github\.com/anatolijlaptev1991-ctrl/sing-box\s+v1\.14\.2-0\.20261031133806-35f3fd09bcf9')
$rev = [regex]::Match($info, 'vcs\.revision=([0-9a-f]{40})').Groups[1].Value
"vcs.revision:       $rev"
"vcs.modified=false: " + [bool]($info -match 'vcs\.modified=false')
$tagCommit = (git -C $env:LAVRAY_SRC rev-parse "v$ver^{commit}" 2>$null)
"коммит тега v${ver}:  $tagCommit"
"ядро из коммита тега: " + ($rev -eq $tagCommit)
```

   Ожидается: все `True`; `vcs.revision` равен коммиту тега (если тега нет в `src\`, выполните `git -C $env:LAVRAY_SRC fetch --tags`). Версию форка в строке `форк закреплён` сверяйте с `replace` в `core/go.mod` выбранного коммита: если пин в коммите другой, подставьте его (запишите в отклонения).

9. Ядро из ZIP — честная проверка версии без запуска сервера: строка версии в двоичном файле.

```powershell
$bytes = [IO.File]::ReadAllBytes($core)
$text = [Text.Encoding]::ASCII.GetString($bytes)
"версия $ver найдена в ядре: " + $text.Contains($ver)
```

   Ожидается `True`. Фактическая проверка `coreVersion` через API делается в A07 (шаг `status.initial`, поле `coreVersion`).

10. Подписи Authenticode. В версии 0.4.0 сборки не подписаны (заметки к выпуску: «Сборки не подписаны», SmartScreen предупредит); цель шага — зафиксировать текущее состояние, а не требовать подпись.

```powershell
foreach ($f in $setup, (Join-Path $env:LAVRAY_PORTABLE 'LAVRay.exe'), $core) {
  '{0}: {1}' -f (Split-Path $f -Leaf), (Get-AuthenticodeSignature $f).Status
}
```

    Ожидается: `NotSigned` для всех трёх. `Valid` (если владелец подписал сборку) — не ошибка, это улучшение: запишите издателя `(Get-AuthenticodeSignature $f).SignerCertificate.Subject`. `HashMismatch`, `NotTrusted`, `UnknownError` — `major`.

11. Подписи minisign (если среди ассетов есть файлы `*.minisig`; в версии 0.4.0 их нет, обновления с подписями появятся с T-75).

```powershell
$sigs = Get-ChildItem $dir -Filter '*.minisig' -ErrorAction SilentlyContinue
if (-not $sigs) { 'minisig: нет (ожидаемо для 0.4.0) -> SKIPPED' } else { $sigs | Select-Object Name, Length }
```

    Ожидается для 0.4.0: `minisig: нет ... SKIPPED`. Если подписи есть, проверьте каждую `minisign -Vm <файл> -P <публичный ключ из SECURITY.md>`; публичный ключ берите из репозитория (`docs/SECURITY.md`), не из релиза.

12. Зеркало в платформенном репозитории (необязательно; нужен доступ к приватному `lavray-windows`).

```powershell
$mirror = gh release view "v$ver" -R anatolijlaptev1991-ctrl/lavray-windows --json assets 2>&1
"mirror exit=$LASTEXITCODE"
if ($LASTEXITCODE -eq 0) { ($mirror | ConvertFrom-Json).assets | Select-Object name, size }
```

    Ожидается: либо те же три ассета с теми же размерами, либо `release not found`/нет доступа. Второе — `SKIPPED` с причиной, не `FAIL`. Совпадение размеров при несовпадении сумм — `major`.

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Релиз `v0.4.0` опубликован и не черновик | шаг 2 (иначе `BLOCKED`) |
| К2 | Ровно три ассета с именами из workflow | `совпадают: True` |
| К3 | Установщик не больше 25 МБ | шаг 4 |
| К4 | Суммы из `SHA256SUMS.txt` совпали для обоих файлов | `суммы совпали: True` |
| К5 | В ZIP ровно три файла: `LAVRay.exe`, `LICENSE`, `binaries/lavray-core.exe` | `состав верный: True` |
| К6 | Оба exe — `Amd64` | шаг 7 |
| К7 | Ядро: теги из `BUILD_TAGS`, `-trimpath`, без cgo, форк закреплён, `vcs.modified=false`, ревизия равна коммиту тега | шаг 8, все `True` |
| К8 | В ядре есть строка версии 0.4.0 | шаг 9 |
| К9 | Подписи: `NotSigned` или `Valid`, без `HashMismatch`/`NotTrusted` | шаг 10 |

Если релиз не опубликован, итог файла `BLOCKED`, а не `FAIL`; репетиция на `v0.3.0` фиксируется в «Отклонениях».

## Что собрать

`results\A06\`: ответ шага 2 (`gh release view` в JSON без токенов), таблица шага 4, вывод шагов 5, 6, 8, 10, значение `vcs.revision`.

## Откат / уборка

Ничего системного не менялось. Скачанные файлы остаются нужными для A07, A10, A11, M01: не удаляйте `assets\0.4.0`, `assets\0.3.0` и `portable\0.4.0` до конца прогона. Финальная уборка — раздел 10 файла `01-ENVIRONMENT.md`.

## Отчёт

`results/A06.md` по `templates/REPORT.md`: статусы 12 шагов, К1–К9, список ассетов с размерами и суммами, `vcs.revision`. Провал К4 и К7 — `critical` (выпущен не тот артефакт), К2, К5, К6 — `major`, К3 — `minor`.
