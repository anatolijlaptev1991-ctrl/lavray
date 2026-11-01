# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / common: журнал, запуск сценариев с перехватом ошибок и сроком, отчёт JSON.
# Файл подключается точкой из nsis_recon.ps1 и делит с ним область видимости скрипта.

$script:Report = [ordered]@{ scenarios = [ordered]@{} }
$script:Deadline = [datetime]::MaxValue
$script:LogPath = $null
$script:JsonPath = $null

function Write-Log {
    param([string]$Message)
    $line = '{0:HH:mm:ss.fff} {1}' -f (Get-Date), $Message
    Write-Host $line
    if ($script:LogPath) {
        try { Add-Content -LiteralPath $script:LogPath -Value $line -Encoding utf8 } catch { Write-Host "журнал недоступен: $_" }
    }
}

function Get-Prop {
    # Значение свойства или $null (не падает на отсутствующем свойстве).
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) { return $Object[$Name] }
    $member = $Object.PSObject.Properties[$Name]
    if ($member) { return $member.Value }
    return $null
}

function Get-ErrorFacts {
    # Разбор исключения в простые поля: цепочка, код Win32, признак ERROR_SHARING_VIOLATION (32).
    param($ErrorItem)
    $ex = if ($ErrorItem -is [System.Management.Automation.ErrorRecord]) { $ErrorItem.Exception } else { $ErrorItem }
    $native = $null
    $chain = @()
    for ($e = $ex; $null -ne $e; $e = $e.InnerException) {
        $chain += ('{0}: {1}' -f $e.GetType().FullName, $e.Message)
        if ($e -is [System.ComponentModel.Win32Exception] -and $null -eq $native) { $native = $e.NativeErrorCode }
    }
    $text = $chain -join ' | '
    $where = $null
    if ($ErrorItem -is [System.Management.Automation.ErrorRecord] -and $ErrorItem.InvocationInfo) {
        $where = '{0}:{1}' -f (Split-Path -Leaf ([string]$ErrorItem.InvocationInfo.ScriptName)), $ErrorItem.InvocationInfo.ScriptLineNumber
    }
    return [ordered]@{
        message          = $ex.Message
        chain            = $chain
        nativeErrorCode  = $native
        hresult          = ('0x{0:X8}' -f $ex.HResult)
        sharingViolation = (32 -eq $native) -or ($text -match 'being used by another process|используется другим процессом')
        at               = $where
    }
}

function Get-RemainingSec {
    # Сколько секунд осталось сценарию; не больше запрошенного. Срок вышел - исключение.
    param([int]$Wanted)
    $left = ($script:Deadline - [datetime]::UtcNow).TotalSeconds
    if ($left -le 0) { throw 'срок сценария исчерпан' }
    return [int][math]::Min([double]$Wanted, [math]::Ceiling([math]::Min($left, 2000000000.0)))
}

function Wait-Seconds {
    param([double]$Seconds)
    $allowed = Get-RemainingSec ([int][math]::Ceiling($Seconds))
    Start-Sleep -Milliseconds ([int]([math]::Min([double]$Seconds, [double]$allowed) * 1000))
}

function Wait-Until {
    # Опрашивает условие; возвращает миллисекунды до успеха или $null по истечении срока.
    param([scriptblock]$Condition, [int]$TimeoutSec, [int]$IntervalMs = 500)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $limit = Get-RemainingSec $TimeoutSec
    do {
        if (& $Condition) { return $watch.ElapsedMilliseconds }
        Start-Sleep -Milliseconds $IntervalMs
    } while ($watch.Elapsed.TotalSeconds -lt $limit)
    return $null
}

function Save-Report {
    $json = $script:Report | ConvertTo-Json -Depth 16
    [IO.File]::WriteAllText($script:JsonPath, $json, [Text.UTF8Encoding]::new($false))
}

function Invoke-Scenario {
    # Выполняет сценарий: ошибка и срок не обрывают прогон, а попадают в JSON как status=error.
    param([string]$Name, [int]$TimeoutSec, [scriptblock]$Body)
    Write-Log "=== сценарий $Name (срок $TimeoutSec с) ==="
    $facts = [ordered]@{}
    $status = 'ok'
    $script:Deadline = [datetime]::UtcNow.AddSeconds($TimeoutSec)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try { & $Body $facts | Out-Null }
    catch {
        $status = 'error'
        $facts['error'] = Get-ErrorFacts $_
        Write-Log "ОШИБКА в ${Name}: $($_.Exception.Message)"
    }
    finally { $script:Deadline = [datetime]::MaxValue }
    $entry = [ordered]@{ status = $status; durationMs = $watch.ElapsedMilliseconds; timeoutSec = $TimeoutSec }
    foreach ($key in $facts.Keys) { $entry[$key] = $facts[$key] }
    $script:Report.scenarios[$Name] = $entry
    Write-Log "--- $Name : $status, $($watch.ElapsedMilliseconds) мс, $($entry['headline'])"
    Save-Report
}

function Write-Summary {
    # Короткая таблица в журнал и в сводку шага GitHub Actions.
    $rows = foreach ($name in $script:Report.scenarios.Keys) {
        $s = $script:Report.scenarios[$name]
        [pscustomobject]@{ Scenario = $name; Status = $s['status']; Ms = $s['durationMs']; Headline = $s['headline'] }
    }
    Write-Host ($rows | Format-Table -AutoSize -Wrap | Out-String -Width 200)
    if (-not $env:GITHUB_STEP_SUMMARY) { return }
    $md = @('### nsis-recon', '', '| Сценарий | Статус | мс | Итог |', '|---|---|---|---|')
    foreach ($r in $rows) { $md += ('| {0} | {1} | {2} | {3} |' -f $r.Scenario, $r.Status, $r.Ms, ([string]$r.Headline -replace '\|', '/')) }
    Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value ($md -join "`n") -Encoding utf8
}
