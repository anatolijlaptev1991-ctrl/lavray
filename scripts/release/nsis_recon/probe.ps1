# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / probe: снимки состояния - реестр, каталог установки, ярлыки, процессы, автозапуск.
# Всё только читает; пишет лишь Set-AutostartSeed (на одноразовом раннере, сценарий 7).

$script:UninstallRoots = @(
    @{ hive = 'HKLM'; view = '64'; path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' },
    @{ hive = 'HKLM'; view = '32'; path = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' },
    @{ hive = 'HKCU'; view = '64'; path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' },
    @{ hive = 'HKCU'; view = '32'; path = 'HKCU:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' }
)
$script:RunKeys = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
)
$script:VendorKeys = @('HKLM:\SOFTWARE\LAVRay', 'HKCU:\SOFTWARE\LAVRay', 'HKLM:\SOFTWARE\WOW6432Node\LAVRay', 'HKCU:\SOFTWARE\WOW6432Node\LAVRay')

function Get-RegistryValues {
    # Все значения ключа простым словарём (без служебных PS*).
    param([string]$KeyPath)
    $props = Get-ItemProperty -LiteralPath $KeyPath -ErrorAction SilentlyContinue
    $values = [ordered]@{}
    if ($null -eq $props) { return $values }
    foreach ($p in $props.PSObject.Properties) {
        if ($p.Name -notlike 'PS*') { $values[$p.Name] = [string]$p.Value }
    }
    return $values
}

function Get-UninstallEntries {
    # Ключи Uninstall (HKLM/HKCU, 64/32 бита), относящиеся к LAVRay.
    $found = @()
    foreach ($root in $script:UninstallRoots) {
        if (-not (Test-Path -LiteralPath $root.path)) { continue }
        foreach ($key in (Get-ChildItem -LiteralPath $root.path -ErrorAction SilentlyContinue)) {
            $values = Get-RegistryValues $key.PSPath
            $blob = @($key.PSChildName, $values['DisplayName'], $values['InstallLocation'], $values['UninstallString']) -join '|'
            if ($blob -notmatch 'lavray') { continue }
            $found += [ordered]@{ hive = $root.hive; view = $root.view; key = $key.PSChildName; regValues = $values }
        }
    }
    return , $found
}

function Get-VendorRegistry {
    # Раздел Software\LAVRay (MANUFACTURER\PRODUCTNAME шаблона NSIS) со всеми подразделами.
    $out = [ordered]@{}
    foreach ($path in $script:VendorKeys) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $items = @(Get-Item -LiteralPath $path) + @(Get-ChildItem -LiteralPath $path -Recurse -ErrorAction SilentlyContinue)
        foreach ($item in $items) { $out[$item.Name] = Get-RegistryValues $item.PSPath }
    }
    return $out
}

function Get-FileList {
    param([string]$Dir, [int]$Max = 300)
    if (-not $Dir -or -not (Test-Path -LiteralPath $Dir)) { return , @() }
    $files = @(Get-ChildItem -LiteralPath $Dir -Recurse -Force -File -ErrorAction SilentlyContinue)
    $rows = @(foreach ($f in ($files | Select-Object -First $Max)) {
        [ordered]@{ path = $f.FullName.Substring($Dir.TrimEnd('\').Length).TrimStart('\'); bytes = $f.Length }
    })
    return , $rows
}

function Resolve-InstallDir {
    # Каталог установки из ключа Uninstall (InstallLocation, иначе каталог UninstallString).
    param($Entries)
    foreach ($e in $Entries) {
        $loc = ([string]$e['regValues']['InstallLocation']).Trim('"')
        if ($loc) { return $loc.TrimEnd('\') }
        $cmd = [string]$e['regValues']['UninstallString']
        if ($cmd -match '^\s*"([^"]+)"') { return (Split-Path -Parent $Matches[1]) }
    }
    return $null
}

function Resolve-MainExe {
    # Главный exe: LAVRay.exe или lavray-shell.exe (какой из них кладёт установщик - предмет разведки).
    param([string]$InstallDir)
    if (-not $InstallDir) { return $null }
    foreach ($name in 'LAVRay.exe', 'lavray-shell.exe') {
        $path = Join-Path $InstallDir $name
        if (Test-Path -LiteralPath $path) { return $path }
    }
    $other = Get-ChildItem -LiteralPath $InstallDir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '^uninst' } | Sort-Object Length -Descending | Select-Object -First 1
    if ($other) { return $other.FullName }
    return $null
}

function Get-Scope {
    param($Entries)
    $hives = @($Entries | ForEach-Object { $_['hive'] } | Sort-Object -Unique)
    if ($hives.Count -eq 0) { return 'none' }
    if ($hives.Count -gt 1) { return 'both' }
    if ($hives[0] -eq 'HKLM') { return 'perMachine' }
    return 'perUser'
}

function Get-InstallSnapshot {
    $entries = Get-UninstallEntries # функции с «return ,» отдают массив целиком: без @()
    $dir = Resolve-InstallDir $entries
    $exe = Resolve-MainExe $dir
    $info = if ($exe) { (Get-Item -LiteralPath $exe).VersionInfo } else { $null }
    $files = Get-FileList $dir
    return [ordered]@{
        scope              = Get-Scope $entries
        installDir         = $dir
        installDirExists   = [bool]($dir -and (Test-Path -LiteralPath $dir))
        mainExe            = $exe
        exeFileVersion     = Get-Prop $info 'FileVersion'
        exeProductVersion  = Get-Prop $info 'ProductVersion'
        displayVersion     = if ($entries.Count -gt 0) { $entries[0]['regValues']['DisplayVersion'] } else { $null }
        uninstallEntries   = $entries
        vendorRegistry     = Get-VendorRegistry
        uninstallerPresent = [bool]($dir -and (Test-Path -LiteralPath (Join-Path $dir 'uninstall.exe')))
        fileCount          = @($files).Count
        files              = $files
    }
}

function Get-Shortcuts {
    # Ярлыки LAVRay в меню Пуск (все пользователи и текущий) и на рабочих столах.
    $roots = @(
        (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
        (Join-Path $env:PUBLIC 'Desktop'),
        [Environment]::GetFolderPath('Desktop')
    )
    $rows = @(foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($f in (Get-ChildItem -LiteralPath $root -Recurse -Filter '*.lnk' -File -ErrorAction SilentlyContinue)) {
            if ($f.FullName -notmatch 'lavray') { continue }
            $target = (New-Object -ComObject WScript.Shell).CreateShortcut($f.FullName).TargetPath
            [ordered]@{ path = $f.FullName; target = $target }
        }
    })
    return , $rows
}

function Get-LavrayProcesses {
    # Процессы приложения: образ из каталога установки или имя lavray*/LAVRay*.
    param([string]$InstallDir)
    $rows = @(foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        $path = [string]$p.ExecutablePath
        $inDir = [bool]($InstallDir -and $path -and $path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase))
        if (-not ($inDir -or $p.Name -match '^(lavray|LAVRay)')) { continue }
        [ordered]@{ pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId; name = $p.Name; path = $path; sessionId = [int]$p.SessionId; commandLine = $p.CommandLine }
    })
    return , $rows
}

function Stop-LavrayProcesses {
    param([string]$InstallDir)
    $killed = @()
    foreach ($p in (Get-LavrayProcesses $InstallDir)) {
        Stop-Process -Id $p.pid -Force -ErrorAction SilentlyContinue
        $killed += $p.pid
    }
    return , $killed
}

function Get-ProcessOwner {
    param([int]$ProcessId)
    try {
        $r = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" | Invoke-CimMethod -MethodName GetOwner
        return "$($r.Domain)\$($r.User)"
    } catch { return $null }
}

function Get-LavrayTasks {
    try {
        $tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -match 'lavray' })
        $rows = @(foreach ($t in $tasks) {
            [ordered]@{ name = $t.TaskName; path = $t.TaskPath; state = [string]$t.State; runLevel = [string]$t.Principal.RunLevel }
        })
        return , $rows
    } catch {
        $csv = (& "$env:SystemRoot\System32\schtasks.exe" /Query /FO CSV /NH 2>&1 | Out-String) -split "`r?`n"
        return , @($csv | Where-Object { $_ -match 'lavray' })
    }
}

function Get-Autostart {
    # Автозапуск LAVRay: значения Run (HKCU/HKLM) и задачи планировщика.
    $run = @(foreach ($key in $script:RunKeys) {
        $values = Get-RegistryValues $key
        foreach ($name in @($values.Keys)) {
            if ($name -match 'lavray' -or $values[$name] -match 'lavray') { [ordered]@{ key = $key; name = $name; data = $values[$name] } }
        }
    })
    return [ordered]@{ runValues = $run; scheduledTasks = (Get-LavrayTasks) }
}

function Set-AutostartSeed {
    # Имитирует то, что делает приложение (autostart.rs): значение Run и задача LAVRay-<SID>.
    param([string]$Exe)
    $seed = [ordered]@{ runValue = $false; task = $false; error = $null }
    try {
        $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        New-ItemProperty -LiteralPath $runKey -Name 'LAVRay' -Value "`"$Exe`" --tray" -PropertyType String -Force | Out-Null
        $seed['runValue'] = $true
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $action = New-ScheduledTaskAction -Execute $Exe -Argument '--tray'
        $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
        Register-ScheduledTask -TaskName "LAVRay-$sid" -Action $action -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Principal $principal -Force | Out-Null
        $seed['task'] = $true
    } catch { $seed['error'] = Get-ErrorFacts $_ }
    return $seed
}

function Get-WebView2Version {
    $guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($root in 'HKLM:\SOFTWARE\WOW6432Node', 'HKLM:\SOFTWARE', 'HKCU:\SOFTWARE') {
        $pv = (Get-RegistryValues "$root\Microsoft\EdgeUpdate\Clients\$guid")['pv']
        if ($pv) { return $pv }
    }
    return $null
}
