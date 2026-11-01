# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / сценарий 6: «голый» exe - копия главного exe в пустом каталоге, без соседних файлов
# (так стартует watchdog, §12.7). Флаги читаются из shell/src/update/watchdog_args.rs.
#
# Безопасные аргументы:
#   A) `--update-watchdog` без обязательных полей: разбор не проходит, процесс выходит с кодом 2
#      ДО окна, ядра и любых действий. Это проверка «exe вообще запускается без соседей».
#   B) полный набор с pid уже завершённого процесса, пустым каталогом данных и посторонним exe
#      (whoami): watchdog «дожидается» установщика, запускает whoami через Проводник, ждёт heartbeat
#      60 с и пытается откат; прошлого установщика нет (`previous.json` не существует), поэтому
#      откат невозможен (`rollback_unavailable`), а установить он не может ничего.
# Старые сборки (до T-75) флага не знают и запустят окно целиком - тогда B пропускается.

function Invoke-BareRun {
    param([string]$Exe, [string[]]$ArgList, [int]$TimeoutSec)
    $dir = Split-Path -Parent $Exe
    $started = Start-Tracked -Path $Exe -ArgList $ArgList -Mode createprocess -WorkingDirectory $dir -Capture
    $res = $started.info
    if ($null -eq $started.process) { return $res }
    $waited = Wait-Tracked -Process $started.process -TimeoutSec $TimeoutSec -Sample { Get-LavrayProcesses '' } -SampleAfterSec 15
    foreach ($key in $waited.Keys) { $res[$key] = $waited[$key] }
    $res['stdout'] = Read-Captured $started.stdout
    $res['stderr'] = Read-Captured $started.stderr
    $res['dirAfter'] = @(Get-ChildItem -LiteralPath $dir -Force | ForEach-Object { $_.Name })
    $res['strayStopped'] = Stop-LavrayProcesses ''
    return $res
}

function New-ExitedPid {
    $done = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList '/c', 'exit', '0' -PassThru -WindowStyle Hidden
    $done.WaitForExit()
    return $done.Id
}

function Invoke-BareWatchdog {
    param([string]$Exe, [string]$Dir)
    $data = Join-Path $Dir 'data'
    New-Item -ItemType Directory -Force -Path $data | Out-Null
    $argList = @(
        '--update-watchdog',
        "--installer-pid=$(New-ExitedPid)",
        "--data-dir=$data",
        "--app-exe=$env:SystemRoot\System32\whoami.exe",
        '--version=0.0.0'
    )
    $res = Invoke-BareRun $Exe $argList 120
    $result = Get-ChildItem -LiteralPath $data -Recurse -Filter 'last-update.json' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    $res['lastUpdateJson'] = if ($result) { (Get-Content -LiteralPath $result.FullName -Raw -Encoding utf8) } else { $null }
    $res['dataFiles'] = Get-FileList $data 50
    return $res
}

function Invoke-BareSubject {
    param([string]$Label, [string]$Source)
    $dir = Join-Path $script:Ctx.WorkDir "bare-$Label"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $exe = Join-Path $dir (Split-Path -Leaf $Source)
    Copy-Item -LiteralPath $Source -Destination $exe -Force
    $item = Get-Item -LiteralPath $exe
    $res = [ordered]@{ exe = $exe; bytes = $item.Length; fileVersion = $item.VersionInfo.FileVersion; neighbours = @(Get-ChildItem -LiteralPath $dir | ForEach-Object { $_.Name }) }
    $res['badArgs'] = Invoke-BareRun $exe @('--update-watchdog') 45
    $res['supportsWatchdog'] = ($res['badArgs']['exitCode'] -eq 2)
    if ($res['supportsWatchdog']) { $res['fullArgs'] = Invoke-BareWatchdog $exe $dir }
    return $res
}

function Invoke-BareExe {
    param($Facts)
    $ctx = $script:Ctx
    $subjects = [ordered]@{ old = $ctx.OldExeCopy; new = $ctx.NewExeCopy }
    $parts = @()
    foreach ($label in $subjects.Keys) {
        $source = $subjects[$label]
        if (-not $source -or -not (Test-Path -LiteralPath $source)) {
            $Facts[$label] = [ordered]@{ skipped = 'exe не был сохранён' }
            continue
        }
        $res = Invoke-BareSubject $label $source
        $Facts[$label] = $res
        $parts += '{0}: A exit {1}, watchdog {2}' -f $label, $res['badArgs']['exitCodeHex'], $res['supportsWatchdog']
    }
    $Facts['headline'] = $parts -join '; '
}
