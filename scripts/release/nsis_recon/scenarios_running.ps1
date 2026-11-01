# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / сценарий 2: установщик новой версии при работающем приложении.

function Get-PidList {
    param($Processes)
    return , @($Processes | ForEach-Object { [int]$_['pid'] })
}

function Invoke-UpgradeWhileRunning {
    param($Facts)
    $ctx = $script:Ctx
    $startedAt = Get-Date
    $marker = New-DataMarker
    $Facts['marker'] = [ordered]@{ file = $marker['file']; nested = $marker['nested'] }
    $ctx.Marker = $marker
    $app = Start-InstalledApp $ctx.MainExe $ctx.InstallDir
    $Facts['appLaunch'] = $app
    $running = [bool]$app['shellRunning']
    $Facts['appStarted'] = $running
    if (-not $running) {
        # нет рабочего стола или WebView2: фиксируем причину и идём дальше без запущенного приложения
        $Facts['appNotStarted'] = [ordered]@{ webView2Version = Get-WebView2Version; hints = Get-AppFailureHints $startedAt }
    }
    $oldPids = Get-PidList $app['processes']
    $run = Invoke-Setup -Path $ctx.NewSetup -ArgList @('/S') -TimeoutSec 300 -WatchPids $oldPids
    $Facts['installer'] = $run
    Wait-Seconds 15
    $after = Get-LavrayProcesses $ctx.InstallDir
    $afterPids = Get-PidList $after
    $alive = @($oldPids | Where-Object { $afterPids -contains $_ })
    $Facts['processesAfter'] = $after
    $Facts['oldProcessesStillAlive'] = $alive
    $Facts['appRestartedItself'] = @($afterPids | Where-Object { $oldPids -notcontains $_ }).Count -gt 0
    $Facts['behavior'] = Get-UpgradeBehavior $run $running $alive.Count
    $Facts['versionAfter'] = Get-VersionFacts (Get-InstallSnapshot) $ctx.NewVersion
    $Facts['dataAfter'] = Test-DataMarker $marker
    $Facts['stoppedAfter'] = Stop-LavrayProcesses $ctx.InstallDir
    $Facts['headline'] = '{0}; exit {1}, {2} мс; данные {3}; v{4}' -f $Facts['behavior'], $run['exitCode'], $run['durationMs'], $(if ($Facts['dataAfter']['markerSurvived']) { 'целы' } else { 'ПОТЕРЯНЫ' }), $Facts['versionAfter']['displayVersion']
}
