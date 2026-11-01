# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / сценарий 5: установщик под дескриптором с запретом записи (UPDATE-SYSTEM §12.7, п. 4 §12.9).
# Оболочка держит установщик открытым с FILE_SHARE_READ, пока его запускает. Принимают ли такой файл
# ShellExecute (runas) и CreateProcess - неизвестно; здесь это проверяется на копии NEW.

function Test-WriteOpen {
    # Контроль: при удерживаемом дескрипторе открыть файл на запись нельзя (ожидаем нарушение доступа).
    param([string]$Path)
    try {
        $probe = [IO.File]::Open($Path, 'Open', 'Write', 'ReadWrite')
        $probe.Dispose()
        return [ordered]@{ writeDenied = $false }
    } catch {
        return [ordered]@{ writeDenied = $true; error = Get-ErrorFacts $_ }
    }
}

function Invoke-LockedVariant {
    # Один запуск: опциональный дескриптор (режим общего доступа), способ запуска, результат.
    param([string]$Path, $Variant)
    $res = [ordered]@{ share = $Variant['share']; mode = $Variant['mode'] }
    $handle = $null
    try {
        if ($Variant['share']) {
            $handle = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]$Variant['share'])
            $res['writeProbe'] = Test-WriteOpen $Path
        }
        $run = Invoke-Setup -Path $Path -ArgList @('/S') -TimeoutSec 180 -Mode $Variant['mode']
        $res['run'] = $run
        $err = $run['startError']
        $res['startFailed'] = ($null -ne $err)
        $res['sharingViolation32'] = [bool]($err -and $err['sharingViolation'])
    } catch {
        $res['error'] = Get-ErrorFacts $_
    } finally {
        if ($handle) { $handle.Dispose() }
    }
    return $res
}

function Get-LockVariants {
    return @(
        @{ id = 'control_runas_no_handle'; share = $null; mode = 'runas' },
        @{ id = 'a_read_runas'; share = 'Read'; mode = 'runas' },
        @{ id = 'b_read_startprocess'; share = 'Read'; mode = 'startprocess' },
        @{ id = 'b2_read_createprocess'; share = 'Read'; mode = 'createprocess' },
        @{ id = 'c_read_delete_runas'; share = 'Read, Delete'; mode = 'runas' },
        @{ id = 'c2_read_delete_createprocess'; share = 'Read, Delete'; mode = 'createprocess' }
    )
}

function Get-LockHeadline {
    param($Variants)
    $parts = foreach ($id in $Variants.Keys) {
        $v = $Variants[$id]
        $state = if ($v['error']) { 'ошибка' } elseif ($v['sharingViolation32']) { 'ERROR 32' } elseif ($v['startFailed']) { 'отказ' } elseif ($v['run']['timedOut']) { 'таймаут' } else { 'exit ' + $v['run']['exitCode'] }
        '{0}={1}' -f $id.Split('_')[0], $state
    }
    return ($parts -join '; ')
}

function Invoke-DenyWriteHandle {
    param($Facts)
    $ctx = $script:Ctx
    $dir = Join-Path $ctx.WorkDir 'locked'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $copy = Join-Path $dir (Split-Path -Leaf $ctx.NewSetup)
    Copy-Item -LiteralPath $ctx.NewSetup -Destination $copy -Force
    $Facts['stateBefore'] = (Get-InstallSnapshot)['displayVersion']
    $results = [ordered]@{}
    foreach ($variant in (Get-LockVariants)) {
        Write-Log "вариант $($variant['id'])"
        $results[$variant['id']] = Invoke-LockedVariant $copy $variant
    }
    $Facts['variants'] = $results
    $Facts['headline'] = Get-LockHeadline $results
}
