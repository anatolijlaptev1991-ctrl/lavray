# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / сценарий 7: тихое удаление и остатки (файлы, данные, реестр, автозапуск, ярлыки).

function Split-UninstallCommand {
    # `"C:\...\uninstall.exe" /ключи` -> путь и прочие аргументы; $null, если разобрать нельзя.
    param([string]$Command)
    if ($Command -match '^\s*"([^"]+)"\s*(.*)$' -or $Command -match '^\s*(\S+\.exe)\s*(.*)$') {
        $extra = @($Matches[2] -split '\s+' | Where-Object { $_ })
        return [ordered]@{ path = $Matches[1]; extra = $extra }
    }
    return $null
}

function Get-UninstallerStragglers {
    # Копия деинсталлятора во временном каталоге (~nsu*.tmp\Un_*.exe), пока он ещё работает.
    $rows = @(foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        if ([string]$p.ExecutablePath -match '\\~nsu|\\Un_[A-Za-z]\.exe|uninstall\.exe$') { $p.Name }
    })
    return , $rows
}

function Get-LeftoverSnapshot {
    param([string]$InstallDir, $Marker)
    $snap = Get-InstallSnapshot
    $local = Join-Path $env:LOCALAPPDATA 'LAVRay'
    $webview = Join-Path $env:LOCALAPPDATA 'io.github.anatolijlaptev1991-ctrl.lavray'
    return [ordered]@{
        installDirExists = [bool]($InstallDir -and (Test-Path -LiteralPath $InstallDir))
        installDirFiles  = Get-FileList $InstallDir 100
        appData          = Test-DataMarker $Marker
        localAppData     = [ordered]@{ lavray = (Get-FileList $local 50); webview = (Get-FileList $webview 20) }
        uninstallEntries = $snap['uninstallEntries']
        vendorRegistry   = $snap['vendorRegistry']
        autostart        = Get-Autostart
        shortcuts        = Get-Shortcuts
        processes        = Get-LavrayProcesses $InstallDir
    }
}

function Wait-UninstallDone {
    # Деинсталлятор копирует себя во временный каталог и сразу выходит: ждём по следам.
    $done = [ordered]@{}
    $done['registryGoneAfterMs'] = Wait-Until -Condition { (Get-UninstallEntries).Count -eq 0 } -TimeoutSec 90 -IntervalMs 1000
    $done['stragglersGoneAfterMs'] = Wait-Until -Condition { (Get-UninstallerStragglers).Count -eq 0 } -TimeoutSec 90 -IntervalMs 1000
    Wait-Seconds 3
    return $done
}

function Get-LeftoverVerdict {
    param($Before, $After)
    return [ordered]@{
        installDirLeft      = $After['installDirExists']
        installDirFileCount = @($After['installDirFiles']).Count
        appDataDirLeft      = $After['appData']['dirExists']
        appDataMarkerLeft   = $After['appData']['markerSurvived']
        uninstallKeyLeft    = @($After['uninstallEntries']).Count -gt 0
        vendorRegistryLeft  = $After['vendorRegistry'].Count -gt 0
        runValueLeft        = @($After['autostart']['runValues']).Count -gt 0
        scheduledTaskLeft   = @($After['autostart']['scheduledTasks']).Count -gt 0
        shortcutsLeft       = @($After['shortcuts']).Count -gt 0
        seededRunValue      = @($Before['autostart']['runValues']).Count -gt 0
        seededTask          = @($Before['autostart']['scheduledTasks']).Count -gt 0
    }
}

function Invoke-SilentUninstall {
    param($Facts)
    $ctx = $script:Ctx
    $snap = Get-InstallSnapshot
    $dir = $snap['installDir']
    $Facts['seed'] = Set-AutostartSeed $snap['mainExe']
    $before = Get-LeftoverSnapshot $dir $ctx.Marker
    $Facts['before'] = $before
    $raw = if ($snap['uninstallEntries'].Count -gt 0) { [string]$snap['uninstallEntries'][0]['regValues']['UninstallString'] } else { '' }
    $cmd = Split-UninstallCommand $raw
    if ($null -eq $cmd) { $cmd = [ordered]@{ path = (Join-Path $dir 'uninstall.exe'); extra = @() } }
    $Facts['uninstallCommand'] = [ordered]@{ raw = $raw; path = $cmd['path']; extra = $cmd['extra'] }
    $run = Invoke-Setup -Path $cmd['path'] -ArgList (@($cmd['extra']) + '/S') -TimeoutSec 300
    $Facts['uninstaller'] = $run
    $Facts['waited'] = Wait-UninstallDone
    $after = Get-LeftoverSnapshot $dir $ctx.Marker
    $Facts['after'] = $after
    $verdict = Get-LeftoverVerdict $before $after
    $Facts['leftovers'] = $verdict
    $Facts['headline'] = 'exit {0}, {1} мс; остатки: каталог {2}, данные {3}, ключ {4}, Run {5}, задача {6}' -f $run['exitCode'], $run['durationMs'], $verdict['installDirLeft'], $verdict['appDataMarkerLeft'], $verdict['uninstallKeyLeft'], $verdict['runValueLeft'], $verdict['scheduledTaskLeft']
}
