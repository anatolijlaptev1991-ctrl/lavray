# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / сценарии 1, 3 и 4: чистая тихая установка, понижение версии, флаг /R.
# Каждая функция получает словарь фактов и дописывает в него; ошибку ловит Invoke-Scenario.

function Invoke-InstallOld {
    # Сценарий 1: тихая установка старой версии на чистую систему.
    param($Facts)
    $ctx = $script:Ctx
    $Facts['preInstallScope'] = (Get-InstallSnapshot)['scope']
    $run = Invoke-Setup -Path $ctx.OldSetup -ArgList @('/S') -TimeoutSec 300
    $Facts['installer'] = $run
    Wait-Seconds 2
    $snap = Get-InstallSnapshot
    $Facts['install'] = $snap
    $Facts['expectedInstallDir'] = Join-Path $env:ProgramFiles 'LAVRay'
    $Facts['installDirIsProgramFilesLavray'] = ($snap['installDir'] -eq $Facts['expectedInstallDir'])
    $Facts['scope'] = $snap['scope']
    $Facts['version'] = Get-VersionFacts $snap $ctx.OldVersion
    $shortcuts = Get-Shortcuts
    $Facts['shortcuts'] = $shortcuts
    $Facts['startMenuShortcutPresent'] = @($shortcuts | Where-Object { $_['path'] -match 'Start Menu' }).Count -gt 0
    $ctx.InstallDir = $snap['installDir']
    $ctx.MainExe = $snap['mainExe']
    $ctx.OldExeCopy = Save-ExeCopy $snap['mainExe'] 'old'
    $Facts['headline'] = 'exit {0}, {1} мс, {2}, {3}, v{4}' -f $run['exitCode'], $run['durationMs'], $snap['scope'], $snap['installDir'], $snap['displayVersion']
}

function Invoke-Downgrade {
    # Сценарий 3: установщик старой версии поверх новой (допущение allowDowngrades).
    param($Facts)
    $ctx = $script:Ctx
    $before = Get-InstallSnapshot
    $Facts['versionBefore'] = Get-VersionFacts $before $ctx.NewVersion
    $run = Invoke-Setup -Path $ctx.OldSetup -ArgList @('/S') -TimeoutSec 300
    $Facts['installer'] = $run
    Wait-Seconds 2
    $after = Get-InstallSnapshot
    $Facts['versionAfter'] = Get-VersionFacts $after $ctx.OldVersion
    $Facts['downgradeApplied'] = ($after['displayVersion'] -eq $ctx.OldVersion)
    $Facts['versionUnchanged'] = ($after['displayVersion'] -eq $before['displayVersion'])
    $Facts['headline'] = 'exit {0}, было v{1} -> стало v{2}, даунгрейд {3}' -f $run['exitCode'], $before['displayVersion'], $after['displayVersion'], $(if ($Facts['downgradeApplied']) { 'принят' } else { 'НЕ принят' })
}

function Wait-AppAppears {
    # Ждёт появления процессов приложения после установщика; возвращает мс или $null.
    param([string]$InstallDir, [int]$TimeoutSec)
    return Wait-Until -Condition { (Get-LavrayProcesses $InstallDir).Count -gt 0 } -TimeoutSec $TimeoutSec -IntervalMs 1000
}

function Invoke-RelaunchFlag {
    # Сценарий 4: NEW /S /R - запускает ли установщик приложение сам.
    param($Facts)
    $ctx = $script:Ctx
    $Facts['stoppedBefore'] = Stop-LavrayProcesses $ctx.InstallDir
    $run = Invoke-Setup -Path $ctx.NewSetup -ArgList @('/S', '/R') -TimeoutSec 300
    $Facts['installer'] = $run
    $appeared = Wait-AppAppears $ctx.InstallDir 30
    $Facts['appearedAfterMs'] = $appeared
    $Facts['relaunched'] = ($null -ne $appeared)
    Wait-Seconds 5
    $procs = Get-LavrayProcesses $ctx.InstallDir
    foreach ($p in $procs) { $p['owner'] = Get-ProcessOwner $p['pid'] }
    $Facts['processes'] = $procs
    $snap = Get-InstallSnapshot
    $Facts['version'] = Get-VersionFacts $snap $ctx.NewVersion
    $ctx.NewExeCopy = Save-ExeCopy $snap['mainExe'] 'new'
    $Facts['stoppedAfter'] = Stop-LavrayProcesses $ctx.InstallDir
    $Facts['headline'] = 'exit {0}, /R перезапустил приложение: {1} ({2} процессов)' -f $run['exitCode'], $Facts['relaunched'], $procs.Count
}
