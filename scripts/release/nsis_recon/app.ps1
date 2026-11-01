# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / app: вспомогательные операции с установленным приложением - маркер данных,
# запуск и снимок процессов, подсказки о причине отказа запуска, копия exe в сторону.
# Функции, возвращающие массивы, отдают их через «return ,» и вызываются БЕЗ обёртки @().

function New-DataMarker {
    # Файлы-маркеры в %APPDATA%\LAVRay: переживут ли обновление и удаление.
    $dir = Join-Path $env:APPDATA 'LAVRay'
    $keep = Join-Path $dir 'recon-keep'
    New-Item -ItemType Directory -Force -Path $keep | Out-Null
    $text = 'nsis-recon marker {0}' -f [guid]::NewGuid()
    $marker = [ordered]@{ dir = $dir; file = (Join-Path $dir 'recon-marker.txt'); nested = (Join-Path $keep 'nested.txt'); text = $text }
    [IO.File]::WriteAllText($marker['file'], $text)
    [IO.File]::WriteAllText($marker['nested'], $text)
    return $marker
}

function Test-DataMarker {
    param($Marker)
    # маркера может не быть (сценарий 2 оборвался до его создания): тогда только каталог данных
    $dir = if ($Marker) { $Marker['dir'] } else { Join-Path $env:APPDATA 'LAVRay' }
    $same = $Marker -and (Test-Path -LiteralPath $Marker['file']) -and ([IO.File]::ReadAllText($Marker['file']) -eq $Marker['text'])
    return [ordered]@{
        dirExists      = [bool](Test-Path -LiteralPath $dir)
        markerSurvived = [bool]$same
        nestedSurvived = [bool]($Marker -and (Test-Path -LiteralPath $Marker['nested']))
        dirFiles       = Get-FileList $dir 100
    }
}

function Get-AppFailureHints {
    # События журнала Application с начала сценария, упоминающие LAVRay или WebView2.
    param([datetime]$Since)
    try {
        $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $Since; Level = 1, 2, 3 } -ErrorAction Stop)
    } catch { return , @() }
    $hits = @($events | Where-Object { $_.Message -match 'lavray|webview|msedge' } | Select-Object -First 8)
    $rows = @(foreach ($e in $hits) {
        $text = [string]$e.Message
        if ($text.Length -gt 500) { $text = $text.Substring(0, 500) }
        [ordered]@{ time = $e.TimeCreated.ToString('o'); provider = $e.ProviderName; id = $e.Id; level = $e.LevelDisplayName; message = $text }
    })
    return , $rows
}

function Start-InstalledApp {
    # Запускает установленный exe, ждёт 10 с и снимает процессы (оболочка, ядро, WebView2).
    param([string]$Exe, [string]$InstallDir)
    $started = Start-Tracked -Path $Exe -Mode createprocess -WorkingDirectory $InstallDir
    $res = $started.info
    Wait-Seconds 10
    $res['launcherExited'] = $false
    if ($started.process) {
        $res['launcherExited'] = Test-ProcessExited $started.process
        if ($res['launcherExited']) { $res['launcherExitCode'] = try { $started.process.ExitCode } catch { $null } }
    }
    $procs = Get-LavrayProcesses $InstallDir
    $res['processes'] = $procs
    $res['shellRunning'] = @($procs | Where-Object { $_['name'] -match '^(lavray-shell|LAVRay)\.exe$' }).Count -gt 0
    $res['coreRunning'] = @($procs | Where-Object { $_['name'] -match '^lavray-core\.exe$' }).Count -gt 0
    $res['webview2Processes'] = @(Get-Process msedgewebview2 -ErrorAction SilentlyContinue).Count
    return $res
}

function Get-UpgradeBehavior {
    # Как установщик вёл себя при работающем приложении (чистая функция, проверяется отдельно).
    param($Run, [bool]$AppWasRunning, [int]$StillAlive)
    if (-not $AppWasRunning) { return 'app_not_running' }
    if (-not $Run['started']) { return 'installer_not_started' }
    if ($Run['timedOut']) { return 'installer_hung_waiting' }
    if ($Run['exitCode'] -ne 0) { return 'installer_failed' }
    if ($StillAlive -eq 0) { return 'killed_app_and_installed' }
    return 'installed_app_left_running'
}

function Save-ExeCopy {
    # Копия главного exe в рабочий каталог (потом нужна голому запуску, сценарий 6).
    param([string]$Exe, [string]$Label)
    if (-not $Exe -or -not (Test-Path -LiteralPath $Exe)) { return $null }
    $dir = Join-Path $script:Ctx.WorkDir "bin-$Label"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $copy = Join-Path $dir (Split-Path -Leaf $Exe)
    Copy-Item -LiteralPath $Exe -Destination $copy -Force
    return $copy
}

function Get-VersionFacts {
    # Версия после операции: из ключа Uninstall и из ресурсов главного exe.
    param($Snapshot, [string]$Expected)
    return [ordered]@{
        displayVersion    = $Snapshot['displayVersion']
        exeFileVersion    = $Snapshot['exeFileVersion']
        exeProductVersion = $Snapshot['exeProductVersion']
        expected          = $Expected
        matchesExpected   = ($Snapshot['displayVersion'] -eq $Expected)
    }
}
