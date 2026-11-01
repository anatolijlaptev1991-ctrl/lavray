# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / environment: что за раннер (ОС, права, рабочий стол, WebView2, UAC) и что за установщики.
# Без этого нельзя честно читать итоги: на раннере процесс уже повышен, окна запроса UAC не будет.

function Get-UacFacts {
    $policy = Get-RegistryValues 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
    return [ordered]@{
        EnableLUA                  = $policy['EnableLUA']
        ConsentPromptBehaviorAdmin = $policy['ConsentPromptBehaviorAdmin']
        PromptOnSecureDesktop      = $policy['PromptOnSecureDesktop']
        FilterAdministratorToken   = $policy['FilterAdministratorToken']
    }
}

function Get-EnvironmentFacts {
    $os = Get-CimInstance Win32_OperatingSystem
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    return [ordered]@{
        os                = $os.Caption
        osVersion         = $os.Version
        osBuild           = $os.BuildNumber
        psVersion         = $PSVersionTable.PSVersion.ToString()
        runnerName        = $env:RUNNER_NAME
        imageOs           = $env:ImageOS
        imageVersion      = $env:ImageVersion
        user              = $identity.Name
        isAdmin           = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        userInteractive   = [Environment]::UserInteractive
        sessionId         = (Get-Process -Id $PID).SessionId
        sessionName       = $env:SESSIONNAME
        explorerRunning   = [bool](Get-Process -Name explorer -ErrorAction SilentlyContinue)
        uac               = Get-UacFacts
        webView2Version   = Get-WebView2Version
        programFiles      = $env:ProgramFiles
        appData           = $env:APPDATA
        localAppData      = $env:LOCALAPPDATA
        lavrayAlreadyHere = (Get-InstallSnapshot)['scope']
        limitations       = @(
            'Раннер уже повышен: окно согласия UAC не показывается, поэтому «один запрос UAC» здесь не проверить.',
            'Интерактивный рабочий стол и WebView2 на раннере могут отсутствовать: см. appStarted в сценарии 2.'
        )
    }
}

function Get-SetupFacts {
    # Размер, sha256, версия ресурсов и подпись установщика.
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        file          = $item.Name
        bytes         = $item.Length
        sha256        = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        fileVersion   = $item.VersionInfo.FileVersion
        signature     = [string](Get-AuthenticodeSignature -LiteralPath $Path).Status
    }
}
