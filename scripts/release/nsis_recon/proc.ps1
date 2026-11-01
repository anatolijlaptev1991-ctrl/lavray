# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / proc: запуск процессов тремя способами и ожидание с жёстким сроком.
# Способы: createprocess (ProcessStartInfo, UseShellExecute=false - голый CreateProcess),
# startprocess (Start-Process без -Verb), runas (Start-Process -Verb RunAs, как у оболочки).

function Start-CreateProcess {
    param([string]$Path, [string[]]$ArgList, [string]$WorkingDirectory, [bool]$Capture)
    $psi = [Diagnostics.ProcessStartInfo]::new($Path)
    $psi.UseShellExecute = $false
    foreach ($arg in $ArgList) { $psi.ArgumentList.Add($arg) }
    if ($WorkingDirectory) { $psi.WorkingDirectory = $WorkingDirectory }
    if ($Capture) {
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
    }
    return [Diagnostics.Process]::Start($psi)
}

function Start-Tracked {
    # Запуск без ожидания. Возвращает process (или $null), info для JSON и задачи чтения вывода.
    param(
        [Parameter(Mandatory)][string]$Path,
        [string[]]$ArgList = @(),
        [ValidateSet('createprocess', 'startprocess', 'runas')][string]$Mode = 'createprocess',
        [string]$WorkingDirectory = '',
        [switch]$Capture
    )
    $info = [ordered]@{ file = (Split-Path -Leaf $Path); args = ($ArgList -join ' '); mode = $Mode; started = $false; pid = $null; startError = $null }
    $proc = $null
    $out = $null
    $err = $null
    try {
        if ($Mode -eq 'createprocess') {
            $proc = Start-CreateProcess -Path $Path -ArgList $ArgList -WorkingDirectory $WorkingDirectory -Capture ([bool]$Capture)
            if ($Capture) {
                $out = $proc.StandardOutput.ReadToEndAsync()
                $err = $proc.StandardError.ReadToEndAsync()
            }
        } else {
            $splat = @{ FilePath = $Path; PassThru = $true; ErrorAction = 'Stop' }
            if ($ArgList.Count -gt 0) { $splat['ArgumentList'] = $ArgList }
            if ($WorkingDirectory) { $splat['WorkingDirectory'] = $WorkingDirectory }
            if ($Mode -eq 'runas') { $splat['Verb'] = 'RunAs' }
            $proc = Start-Process @splat
        }
        $info['started'] = $true
        $info['pid'] = $proc.Id
    } catch {
        $info['startError'] = Get-ErrorFacts $_
        $proc = $null
    }
    return @{ process = $proc; info = $info; stdout = $out; stderr = $err }
}

function Test-ProcessExited {
    param($Process)
    try { return $Process.HasExited } catch { return -not (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue) }
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    & "$env:SystemRoot\System32\taskkill.exe" /PID $ProcessId /T /F 2>&1 | Out-Null
}

function Wait-Tracked {
    # Ждёт выхода не дольше срока (и не дольше остатка срока сценария); по таймауту убивает дерево.
    # WatchPids: когда каждый из этих процессов исчез (мс от старта ожидания).
    # Sample: однократно через SampleAfterSec, пока процесс ещё работает.
    param($Process, [int]$TimeoutSec, [int[]]$WatchPids = @(), [scriptblock]$Sample = $null, [int]$SampleAfterSec = 0)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $limit = Get-RemainingSec $TimeoutSec
    $gone = [ordered]@{}
    $taken = $null
    $sampled = $null -eq $Sample
    while (-not (Test-ProcessExited $Process) -and $watch.Elapsed.TotalSeconds -lt $limit) {
        foreach ($id in $WatchPids) {
            if (-not $gone.Contains("$id") -and -not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { $gone["$id"] = $watch.ElapsedMilliseconds }
        }
        if (-not $sampled -and $watch.Elapsed.TotalSeconds -ge $SampleAfterSec) { $taken = & $Sample; $sampled = $true }
        Start-Sleep -Milliseconds 250
    }
    $timedOut = -not (Test-ProcessExited $Process)
    if ($timedOut) { Stop-ProcessTree $Process.Id } else { $Process.WaitForExit() }
    $code = $null
    if (-not $timedOut) { try { $code = $Process.ExitCode } catch { $code = $null } }
    return [ordered]@{
        timedOut        = $timedOut
        exitCode        = $code
        exitCodeHex     = if ($null -ne $code) { '0x{0:X8}' -f $code } else { $null }
        durationMs      = $watch.ElapsedMilliseconds
        watchedGoneAtMs = $gone
        sample          = $taken
    }
}

function Read-Captured {
    param($Task)
    if ($null -eq $Task) { return $null }
    if ($Task.Wait(3000)) { return $Task.Result }
    return '(вывод не дочитан)'
}

function Invoke-Setup {
    # Запускает установщик (или любой exe) и ждёт; все факты - в одном объекте для JSON.
    param(
        [Parameter(Mandatory)][string]$Path,
        [string[]]$ArgList = @(),
        [int]$TimeoutSec = 300,
        [string]$Mode = 'createprocess',
        [int[]]$WatchPids = @(),
        [string]$WorkingDirectory = '',
        [switch]$Capture
    )
    $started = Start-Tracked -Path $Path -ArgList $ArgList -Mode $Mode -WorkingDirectory $WorkingDirectory -Capture:$Capture
    $info = $started.info
    if ($null -eq $started.process) { return $info }
    $waited = Wait-Tracked -Process $started.process -TimeoutSec $TimeoutSec -WatchPids $WatchPids
    foreach ($key in $waited.Keys) { $info[$key] = $waited[$key] }
    if ($Capture) {
        $info['stdout'] = Read-Captured $started.stdout
        $info['stderr'] = Read-Captured $started.stderr
    }
    return $info
}
