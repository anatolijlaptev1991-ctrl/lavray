# A06. Ассеты релиза: имена, суммы, содержимое, теги ядра, подписи

| Поле | Значение |
|---|---|
| ID | A06 |
| Слой | авто |
| Время | 8–12 минут (скачивание около 150 МБ: два Linux-ядра по 55–60 МБ) |
| Зависимости | `01-ENVIRONMENT.md`, разделы 4–7 (доступ `gh` к приватному репозиторию, скачанные ассеты); для шага 16 — WSL2 с Ubuntu (на ПК без WSL только этот шаг получает `BLOCKED`) |
| Опасность | нет: файлы только скачиваются и читаются. Из скачанного запускаются `go version -m` (читает метаданные) и, в шаге 16, Linux-ядро внутри WSL на loopback в `/tmp` (без сети, без прав администратора) |

## Цель

Проверить, что опубликованные ассеты версии под тестом (в плане — `v0.9.0`) целы, названы так, как задают `release-windows.yml` и `release-linux.yml`, собраны из нужного коммита с нужными тегами ядра и не содержат лишнего. Релиз состоит из **семи** файлов: Windows — `LAVRay-0.9.0-x64-setup.exe`, `LAVRay-0.9.0-portable-x64.zip`, `SHA256SUMS.txt`; Linux — `lavray-core-linux-amd64` и `lavray-core-linux-arm64` (оба собраны с тегом `with_webui`), `ui-dist.tar.gz`, `SHA256SUMS-linux.txt`. Покрывает шаг «Проверка ассетов (суммы, теги ядра, smoke, MCP)» общей готовности каждой фазы плана (п. 10.7); сам smoke и MCP — файлы A07 и A08 (они должны быть запущены на ядре из этого же ZIP). Каталога `meta/` (подписанные метаданные обновлений) в релизе **нет**: ключей подписи пока не создано, задание `sign` пропускает себя; отсутствие `meta/` — не `FAIL` (шаг 17).

## Предусловия

- `gh auth status` успешен; доступ на чтение к `anatolijlaptev1991-ctrl/lavray` (репозиторий приватный).
- Go (для `go version -m`), PowerShell 7, Git.
- Релиз `v0.9.0` может быть ещё не опубликован. Тогда шаги 2–17 для этой версии получают `BLOCKED` (причина: релиз не найден; снять может владелец, выпустив тег). В этом случае для проверки самого файла выполните «репетицию» на `v0.3.0` (шаги 1–12, только Windows: Linux-ассетов у неё нет): те же шаги с `$ver = '0.3.0'`; результат репетиции в итог файла не входит, но показывает, что команды рабочие.
- Ожидаемые значения ниже заданы для версии 0.9.0; для репетиции подставляются `0.3.0` и размеры из шага 4. Теги ядра берутся из `core/BUILD_TAGS` клона на коммите тега (на `773b4e8`: `singbox_run,with_quic,with_gvisor,with_utls`).

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

3. Состав ассетов: ровно семь файлов с именами из двух workflow.

```powershell
$want = @("LAVRay-$ver-x64-setup.exe", "LAVRay-$ver-portable-x64.zip", 'SHA256SUMS.txt', 'lavray-core-linux-amd64', 'lavray-core-linux-arm64', 'ui-dist.tar.gz', 'SHA256SUMS-linux.txt') | Sort-Object
$have = (($rel | ConvertFrom-Json).assets | ForEach-Object name) | Sort-Object
"want: $($want -join ', ')"
"have: $($have -join ', ')"
"совпадают: " + (($want -join '|') -eq ($have -join '|'))
```

   Ожидается `совпадают: True`. Лишние файлы (например, `.minisig` после появления ключей подписи) не ошибка, но их подписи проверяются на шаге 11; отсутствие любого из семи — `FAIL`. Если Linux-ассетов нет, а Windows-ассеты есть, workflow `release-linux` не отработал или не прикрепил файлы: `FAIL` (`major`).

4. Скачивание и размеры.

```powershell
New-Item -ItemType Directory -Force -Path $dir | Out-Null
gh release download "v$ver" -R $repo -D $dir --clobber
"download exit=$LASTEXITCODE"
Get-ChildItem $dir | Select-Object Name, Length
$setup = Join-Path $dir "LAVRay-$ver-x64-setup.exe"
"установщик <= 25 МБ: " + ((Get-Item $setup).Length -le 25MB)
```

   Ожидается: `download exit=0`, семь файлов, `установщик <= 25 МБ: True` (бюджет из `docs/TEST-PLAN.md`, раздел 2). Для сравнения: у `v0.3.0` установщик 16 518 811 байт, ZIP 22 911 985 байт, `SHA256SUMS.txt` 191 байт. Linux-ядра — статические бинарники без отладочной информации (`-s -w`) порядка 55–60 МБ каждое; `ui-dist.tar.gz` — сотни килобайт. Размеры записываются в отчёт; Linux-ядро больше 120 МБ или меньше 20 МБ — `WARN` (проверьте теги).

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
cd /c/lavray-test/assets/0.9.0 && tr -d '\r' < SHA256SUMS.txt | sha256sum -c -
```

   Ожидается: две строки `... OK`.

   Суммы Linux-ассетов написаны на Linux (`sha256sum`, окончания строк LF), поэтому проверяются напрямую:

```bash
cd /c/lavray-test/assets/0.9.0 && sha256sum -c SHA256SUMS-linux.txt
grep -c . SHA256SUMS-linux.txt
```

   Ожидается: три строки `... OK` (`lavray-core-linux-amd64`, `lavray-core-linux-arm64`, `ui-dist.tar.gz`) и `3`; в файле нет строк про Windows-ассеты и про сам `SHA256SUMS-linux.txt`; в `SHA256SUMS.txt` — про Linux-ассеты. Тот же итог в PowerShell: повторите цикл выше для `SHA256SUMS-linux.txt`. Нет `sha256sum` в `PATH` (нет Git Bash) — используйте PowerShell и отметьте это в отчёте.

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
"версия в ldflags:    " + [bool]($info -match [regex]::Escape("internal/version.Version=$ver"))
$rev = [regex]::Match($info, 'vcs\.revision=([0-9a-f]{40})').Groups[1].Value
"vcs.revision:       $rev"
"vcs.modified=false: " + [bool]($info -match 'vcs\.modified=false')
$tagCommit = (git -C $env:LAVRAY_SRC rev-parse "v$ver^{commit}" 2>$null)
"коммит тега v${ver}:  $tagCommit"
"ядро из коммита тега: " + ($rev -eq $tagCommit)
```

   Ожидается: все `True` (строка `версия в ldflags` — версия, подставленная workflow флагом `-X …/internal/version.Version=<версия>`); `vcs.revision` равен коммиту тега (если тега нет в `src\`, выполните `git -C $env:LAVRAY_SRC fetch --tags`). Версию форка в строке `форк закреплён` сверяйте с `replace` в `core/go.mod` выбранного коммита: если пин в коммите другой, подставьте его (запишите в отклонения). `vcs.modified=true` — `WARN`, не `FAIL`: перед сборкой workflow выполняет `go mod tidy`, и если он правит `go.mod` или `go.sum`, дерево считается изменённым; обязательно совпадение `vcs.revision` с коммитом тега.

9. Ядро из ZIP — честная проверка версии без запуска сервера: строка версии в двоичном файле.

```powershell
$bytes = [IO.File]::ReadAllBytes($core)
$text = [Text.Encoding]::ASCII.GetString($bytes)
"версия $ver найдена в ядре: " + $text.Contains($ver)
```

   Ожидается `True`. Фактическая проверка `coreVersion` через API делается в A07 (шаг `status.initial`, поле `coreVersion`).

10. Подписи Authenticode. В версии 0.9.0 сборки не подписаны (если это изменится — улучшение) (заметки к выпуску: «Сборки не подписаны», SmartScreen предупредит); цель шага — зафиксировать текущее состояние, а не требовать подпись.

```powershell
foreach ($f in $setup, (Join-Path $env:LAVRAY_PORTABLE 'LAVRay.exe'), $core) {
  '{0}: {1}' -f (Split-Path $f -Leaf), (Get-AuthenticodeSignature $f).Status
}
```

    Ожидается: `NotSigned` для всех трёх. `Valid` (если владелец подписал сборку) — не ошибка, это улучшение: запишите издателя `(Get-AuthenticodeSignature $f).SignerCertificate.Subject`. `HashMismatch`, `NotTrusted`, `UnknownError` — `major`.

11. Подписи minisign (если среди ассетов есть файлы `*.minisig`; в версии 0.9.0 их нет: задание `sign` пропускается без ключей, подпись метаданных и установщика появится после церемонии ключей).

```powershell
$sigs = Get-ChildItem $dir -Filter '*.minisig' -ErrorAction SilentlyContinue
if (-not $sigs) { 'minisig: нет (ожидаемо для 0.9.0, ключей подписи ещё нет) -> SKIPPED' } else { $sigs | Select-Object Name, Length }
```

    Ожидается для 0.9.0: `minisig: нет ... SKIPPED`. Если подписи есть, проверьте каждую `minisign -Vm <файл> -P <публичный ключ из SECURITY.md>`; публичный ключ берите из репозитория (`docs/SECURITY.md`), не из релиза.

12. Зеркало в платформенном репозитории (необязательно; нужен доступ к приватному `lavray-windows`).

```powershell
$mirror = gh release view "v$ver" -R anatolijlaptev1991-ctrl/lavray-windows --json assets 2>&1
"mirror exit=$LASTEXITCODE"
if ($LASTEXITCODE -eq 0) { ($mirror | ConvertFrom-Json).assets | Select-Object name, size }
```

    Ожидается: либо те же три Windows-ассета с теми же размерами (Linux-ассеты в платформенный репозиторий не копируются), либо `release not found`/нет доступа. Второе — `SKIPPED` с причиной, не `FAIL`. Совпадение размеров при несовпадении сумм — `major`.

13. Linux-ассеты: заголовки ELF (архитектура) и размеры. Ядра собраны для `linux/amd64` и `linux/arm64`; файл не должен быть переименованным Windows-бинарником.

```powershell
function Get-ElfInfo([string]$Path) {
  $b = New-Object byte[] 20
  $fs = [IO.File]::OpenRead($Path); try { [void]$fs.Read($b, 0, 20) } finally { $fs.Dispose() }
  $magic = ($b[0..3] | ForEach-Object { '{0:x2}' -f $_ }) -join ''
  $machine = [BitConverter]::ToUInt16($b, 18)
  [pscustomobject]@{ Magic = $magic; Class64 = ($b[4] -eq 2); LittleEndian = ($b[5] -eq 1); Machine = ('0x{0:x}' -f $machine) }
}
foreach ($pair in @(@('lavray-core-linux-amd64', '0x3e'), @('lavray-core-linux-arm64', '0xb7'))) {
  $e = Get-ElfInfo (Join-Path $dir $pair[0])
  '{0}: magic={1} 64bit={2} LE={3} machine={4} (ожидается {5})' -f $pair[0], $e.Magic, $e.Class64, $e.LittleEndian, $e.Machine, $pair[1]
}
```

    Ожидается: у обоих `magic=7f454c46`, `64bit=True`, `LE=True`; `machine=0x3e` (x86-64) у `amd64` и `0xb7` (AArch64) у `arm64`. Несовпадение — `FAIL` (`critical`: в релиз попал не тот артефакт).

14. Linux-ядра собраны из нужного коммита с нужными тегами, включая `with_webui` (`go version -m` читает метаданные, ничего не запускает).

```powershell
$base = (Get-Content (Join-Path $env:LAVRAY_SRC 'core\BUILD_TAGS') -Raw).Trim()
$want = "$base,with_webui"
$tagCommit = (git -C $env:LAVRAY_SRC rev-parse "v$ver^{commit}" 2>$null)
foreach ($arch in 'amd64', 'arm64') {
  $f = Join-Path $dir "lavray-core-linux-$arch"
  $info = (go version -m $f) -join "`n"
  $tags = [regex]::Match($info, '-tags=(\S+)').Groups[1].Value
  $have = $tags -split ',' | Sort-Object
  $need = $want -split ',' | Sort-Object
  "[$arch] теги в бинарнике: $tags"
  "[$arch] есть with_webui и всё из BUILD_TAGS: " + (-not (Compare-Object $have $need))
  "[$arch] точная строка -tags=${want}: " + [bool]($info -match [regex]::Escape("-tags=$want"))
  "[$arch] GOOS=linux GOARCH=${arch}: " + [bool]($info -match 'GOOS=linux' -and $info -match "GOARCH=$arch")
  "[$arch] trimpath, без cgo: " + [bool]($info -match '-trimpath=true' -and $info -match 'CGO_ENABLED=0')
  $rev = [regex]::Match($info, 'vcs\.revision=([0-9a-f]{40})').Groups[1].Value
  "[$arch] vcs.revision: $rev; равен коммиту тега: " + ($rev -eq $tagCommit)
  "[$arch] vcs.modified: " + [regex]::Match($info, 'vcs\.modified=(\w+)').Groups[1].Value
}
```

    Ожидается: у обеих архитектур все строки `True`, `vcs.revision` равен коммиту тега, `vcs.modified=false` (иначе `WARN`, см. шаг 8). Теги обязаны содержать `with_webui` и **каждый** тег из `core/BUILD_TAGS`: ядро без `with_webui` покажет вместо веб-панели страницу «панель не встроена» (`FAIL`, `major`); без `singbox_run` — ядро без настоящего sing-box (`FAIL`, `critical`).

15. `ui-dist.tar.gz`: содержимое интерфейса веб-панели.

```powershell
$tgz = Join-Path $dir 'ui-dist.tar.gz'
$list = tar -tzf $tgz
"tar exit=$LASTEXITCODE; записей: $($list.Count)"
"index.html есть: " + [bool]($list | Where-Object { $_ -match '^(\./)?index\.html$' })
"карт кода (.map) нет: " + (-not [bool]($list | Where-Object { $_ -match '\.map$' }))
$tmp = Join-Path $env:TEMP ('a06-ui-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
tar -xzf $tgz -C $tmp
$html = Get-Content (Join-Path $tmp 'index.html') -Raw
$refs = [regex]::Matches($html, '(?:src|href)="\.?/?(assets/[^"]+)"') | ForEach-Object { $_.Groups[1].Value }
"ссылок на assets/ в index.html: $($refs.Count); все файлы на месте: " + (-not [bool]($refs | Where-Object { -not (Test-Path (Join-Path $tmp $_)) }))
Remove-Item -Recurse -Force $tmp
```

    Ожидается: `tar exit=0`, `index.html есть: True`, `карт кода (.map) нет: True`, ссылок на `assets/` хотя бы одна и `все файлы на месте: True`. Архив без `index.html` — `FAIL` (`major`: веб-панель не откроется на роутере).

16. Linux-ядро запускается (WSL2, Ubuntu). У ядра нет флага `--version`: проверяются справка без аргументов (код выхода 2) и ответ `GetStatus` после запуска `serve` на loopback; версия ядра берётся из ответа. Скрипт ничего не пишет вне `/tmp`; сохраните его как `C:\lavray-test\tmp\A06\a06_linux_run.sh`.

```bash
#!/bin/bash
# A06: запуск Linux-ядра из релиза под WSL: справка (код 2) и ответ GetStatus. Ничего не пишет вне /tmp.
src="$1"
exe=/tmp/lavray-core-a06
cp "$src" "$exe" && chmod +x "$exe" || { echo "FAIL copy"; exit 1; }
"$exe" 2>/tmp/a06-usage.txt; usage_code=$?
echo "usage exit=$usage_code :: $(head -1 /tmp/a06-usage.txt)"
data=$(mktemp -d)
tok=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')
( printf '%s\n' "$tok"; sleep 8 ) | "$exe" serve --listen-socket 127.0.0.1:0 --data "$data" >/tmp/a06-out.txt 2>/tmp/a06-err.txt &
for i in 1 2 3 4 5 6 7 8 9 10; do grep -q LAVRAY_CORE_READY /tmp/a06-out.txt 2>/dev/null && break; sleep 0.5; done
addr=$(awk '/LAVRAY_CORE_READY/{print $2}' /tmp/a06-out.txt | sed 's#tcp://##')
echo "ready: ${addr:+yes}"
curl -s -X POST -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{}' "http://$addr/lavray.v1.CoreService/GetStatus"; echo
echo "healthz=$(curl -s -o /dev/null -w '%{http_code}' "http://$addr/healthz") no-auth=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "http://$addr/lavray.v1.CoreService/GetStatus")"
wait
rm -rf "$data" /tmp/a06-out.txt /tmp/a06-err.txt /tmp/a06-usage.txt "$exe"
```

```powershell
New-Item -ItemType Directory -Force -Path C:\lavray-test\tmp\A06 | Out-Null
$w = (('C:\lavray-test\tmp\A06\a06_linux_run.sh' -replace '^C:', '/mnt/c') -replace '\\', '/')
$a = (($dir -replace '^C:', '/mnt/c') -replace '\\', '/') + '/lavray-core-linux-amd64'
wsl -e bash $w $a 2>$null
```

    Ожидается: `usage exit=2 :: использование: lavray-core serve --listen-socket <path> …`, `ready: yes`, JSON статуса с полем `coreVersion`, строка `healthz=200 no-auth=401`. **`coreVersion` обязан быть `0.9.0`.** У Linux-ядра `release-linux.yml` не передаёт флаг `-X …/internal/version.Version`, поэтому версия берётся из константы `core/internal/version/version.go` (на `773b4e8` — `0.4.0`): если на теге константу не подняли, шаг даёт `FAIL` (`major`: Linux-ядро выдаёт чужую версию, а сравнение версий обновлений идёт по ней). Скрипт для `arm64` не запускается (нет эмуляции): для него остаются шаги 13 и 14. Нет WSL — `BLOCKED` для этого шага (`wsl --status`).

17. Каталога `meta/` нет, и это не `FAIL`. Ключей подписи пока не создано (церемония ключей у владельца), задание `sign` в `release-windows.yml` завершается успешно, ничего не публикуя; релиз выходит без `.minisig`, а ядро с заглушкой корня отвечает `not_configured` (A13, M12).

```powershell
$m = gh api "repos/$repo/contents/meta?ref=gh-pages" 2>&1
"meta в gh-pages: exit=$LASTEXITCODE"
$assetsMeta = Get-ChildItem $dir -Recurse -Include 'timestamp.json', 'manifest-*.json', 'root.json' -ErrorAction SilentlyContinue
"метаданные среди ассетов релиза: " + [bool]$assetsMeta
```

    Ожидается: `exit` не 0 (ветки `gh-pages` или каталога `meta/` нет) и `метаданные среди ассетов релиза: False` → итог шага «`meta/` отсутствует (ожидаемо до церемонии ключей)» — `PASS`/`SKIPPED`, не `FAIL`. Если `meta/` уже есть (ключи созданы), проверьте его файлом A13 (`updsign verify`) и запишите наблюдение; корень в `meta/root.json` должен совпасть с `core/cmd/lavray-core/root.json` на теге.

## Критерии PASS/FAIL

| № | Критерий | Как проверить |
|---|---|---|
| К1 | Релиз `v0.9.0` опубликован и не черновик | шаг 2 (иначе `BLOCKED`) |
| К2 | Ровно семь ассетов с именами из двух workflow | `совпадают: True` |
| К3 | Установщик не больше 25 МБ | шаг 4 |
| К4 | Суммы совпали: `SHA256SUMS.txt` (2 файла) и `SHA256SUMS-linux.txt` (3 файла, `sha256sum -c`) | `суммы совпали: True`, три `OK` |
| К5 | В ZIP ровно три файла: `LAVRay.exe`, `LICENSE`, `binaries/lavray-core.exe` | `состав верный: True` |
| К6 | Оба exe — `Amd64` | шаг 7 |
| К7 | Ядро: теги из `BUILD_TAGS`, `-trimpath`, без cgo, форк закреплён, `vcs.modified=false`, ревизия равна коммиту тега | шаг 8, все `True` |
| К8 | В Windows-ядре есть строка версии 0.9.0 и она передана через `-X` | шаги 8 и 9 |
| К9 | Подписи: `NotSigned` или `Valid`, без `HashMismatch`/`NotTrusted` | шаг 10 |
| К10 | Linux-ядра: ELF нужной архитектуры, теги `BUILD_TAGS` + `with_webui` точно, `trimpath`, без cgo, `vcs.revision` равен коммиту тега | шаги 13–14 |
| К11 | `ui-dist.tar.gz`: `index.html` есть, все ссылки на `assets/` разрешаются, карт нет | шаг 15 |
| К12 | Linux-ядро запускается (справка с кодом 2, `GetStatus`, `healthz=200`, без токена `401`) и сообщает `coreVersion = 0.9.0` | шаг 16 (`BLOCKED` без WSL) |
| К13 | Отсутствие `meta/` зафиксировано и не считается провалом | шаг 17 |

Если релиз не опубликован, итог файла `BLOCKED`, а не `FAIL`; репетиция на `v0.3.0` фиксируется в «Отклонениях».

## Что собрать

`results\A06\`: ответ шага 2 (`gh release view` в JSON без токенов), таблица шага 4, вывод шагов 5, 6, 8, 10, 13–17, значения `vcs.revision` обоих Windows- и Linux-ядер.

## Откат / уборка

Ничего системного не менялось. Скачанные файлы остаются нужными для A07, A10, A11, M01: не удаляйте `assets\0.9.0`, `assets\0.3.0` и `portable\0.9.0` до конца прогона. Финальная уборка — раздел 10 файла `01-ENVIRONMENT.md`.

## Отчёт

`results/A06.md` по `templates/REPORT.md`: статусы 17 шагов, К1–К13, список ассетов с размерами и суммами, `vcs.revision`. Провал К4, К7, К10 — `critical` (выпущен не тот артефакт), К2, К5, К6, К11, К12 — `major`, К3 — `minor`; `vcs.modified=true` и размеры вне диапазона — `WARN`.
