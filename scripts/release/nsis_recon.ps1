# SPDX-License-Identifier: GPL-3.0-only
#requires -Version 7.0
<#
.SYNOPSIS
  Ф3.0 «разведка NSIS» (docs/UPDATE-SYSTEM.md §12.7): как ведёт себя НАСТОЯЩИЙ опубликованный
  установщик LAVRay при тихой установке, обновлении поверх работающего приложения, понижении,
  флаге /R, запуске под дескриптором с запретом записи, голом запуске exe, удалении и удалении
  работающего приложения (D-2 прогона 0.9.0).

.DESCRIPTION
  Скрипт СТАВИТ и УДАЛЯЕТ LAVRay, пишет в реестр и планировщик. Запускать его можно только на
  одноразовом раннере GitHub (workflow nsis-recon): вне раннера он отказывается работать.
  Каждый сценарий обёрнут в try/catch со сроком; сбой пишется в JSON как status=error, прогон
  продолжается. Итог - один JSON (по объекту на сценарий) и журнал.

.PARAMETER OldSetup
  Путь к LAVRay-<старая версия>-x64-setup.exe.
.PARAMETER NewSetup
  Путь к LAVRay-<новая версия>-x64-setup.exe.
.PARAMETER OldVersion
  Старая версия без «v».
.PARAMETER NewVersion
  Новая версия без «v».
.PARAMETER OutDir
  Куда писать nsis-recon.json и nsis-recon.log.
.PARAMETER WorkDir
  Рабочий каталог (копии exe и установщика).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OldSetup,
    [Parameter(Mandatory)][string]$NewSetup,
    [Parameter(Mandatory)][ValidatePattern('^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$')][string]$OldVersion,
    [Parameter(Mandatory)][ValidatePattern('^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$')][string]$NewVersion,
    [string]$OutDir = 'recon-out',
    [string]$WorkDir = ''
)

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'

# Защита от запуска на личной машине: установка, реестр, планировщик.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    [Console]::Error.WriteLine('nsis_recon.ps1 ставит и удаляет LAVRay: его можно запускать только на одноразовом раннере GitHub (workflow nsis-recon).')
    exit 3
}

foreach ($lib in 'common', 'probe', 'proc', 'app', 'environment', 'scenarios_install', 'scenarios_running', 'scenarios_lock', 'scenarios_bare', 'scenarios_uninstall', 'scenarios_cleanup') {
    . (Join-Path $PSScriptRoot "nsis_recon/$lib.ps1")
}

$OutDir = (New-Item -ItemType Directory -Force -Path $OutDir).FullName
if (-not $WorkDir) { $WorkDir = Join-Path ($env:RUNNER_TEMP ?? $env:TEMP) 'nsis-recon-work' }
$WorkDir = (New-Item -ItemType Directory -Force -Path $WorkDir).FullName
$script:LogPath = Join-Path $OutDir 'nsis-recon.log'
$script:JsonPath = Join-Path $OutDir 'nsis-recon.json'

$script:Ctx = @{
    OldSetup = (Resolve-Path -LiteralPath $OldSetup).Path
    NewSetup = (Resolve-Path -LiteralPath $NewSetup).Path
    OldVersion = $OldVersion; NewVersion = $NewVersion; WorkDir = $WorkDir
    InstallDir = $null; MainExe = $null; OldExeCopy = $null; NewExeCopy = $null; Marker = $null
}

$startedUtc = [datetime]::UtcNow
$script:Report['schema'] = 1
$script:Report['startedUtc'] = $startedUtc.ToString('o')
$script:Report['oldVersion'] = $OldVersion
$script:Report['newVersion'] = $NewVersion
$script:Report['setups'] = [ordered]@{ old = Get-SetupFacts $script:Ctx.OldSetup; new = Get-SetupFacts $script:Ctx.NewSetup }
$script:Report['environment'] = Get-EnvironmentFacts
Write-Log "раннер: $($script:Report['environment']['os']), админ=$($script:Report['environment']['isAdmin']), WebView2=$($script:Report['environment']['webView2Version'])"

Invoke-Scenario 's1_install_old' 420 { param($f) Invoke-InstallOld $f }
Invoke-Scenario 's2_upgrade_while_running' 600 { param($f) Invoke-UpgradeWhileRunning $f }
Invoke-Scenario 's3_downgrade' 420 { param($f) Invoke-Downgrade $f }
Invoke-Scenario 's4_relaunch_flag_R' 480 { param($f) Invoke-RelaunchFlag $f }
Invoke-Scenario 's5_deny_write_handle' 1200 { param($f) Invoke-DenyWriteHandle $f }
Invoke-Scenario 's6_bare_old_exe' 540 { param($f) Invoke-BareExe $f }
Invoke-Scenario 's7_silent_uninstall' 600 { param($f) Invoke-SilentUninstall $f }
Invoke-Scenario 's8_uninstall_while_running' 900 { param($f) Invoke-UninstallWhileRunning $f }

$script:Report['finishedUtc'] = [datetime]::UtcNow.ToString('o')
Save-Report
Write-Summary
$failed = @($script:Report.scenarios.Keys | Where-Object { $script:Report.scenarios[$_]['status'] -ne 'ok' })
foreach ($name in $failed) { Write-Host "::warning title=nsis-recon::сценарий $name завершился с ошибкой (см. JSON)" }
exit 0
