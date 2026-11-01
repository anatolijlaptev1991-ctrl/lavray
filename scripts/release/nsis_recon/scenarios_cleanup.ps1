# SPDX-License-Identifier: GPL-3.0-only
# nsis_recon / сценарий 8 (D-2 прогона 0.9.0): удаление, пока приложение работает.
# До 0.9.1 ядро не успевало выйти: binaries\lavray-core.exe оставался в Program Files
# вместе с каталогом, а ключ Software\LAVRay запоминал каталог для следующей установки.

function Invoke-UninstallWhileRunning {
    param($Facts)
    $ctx = $script:Ctx
    $Facts['reinstall'] = Invoke-Setup -Path $ctx.NewSetup -ArgList @('/S') -TimeoutSec 300
    Wait-Seconds 2
    $snap = Get-InstallSnapshot
    $app = Start-InstalledApp $snap['mainExe'] $snap['installDir']
    $Facts['appLaunch'] = $app
    $Facts['appRunningBeforeUninstall'] = [bool]$app['shellRunning'] -and [bool]$app['coreRunning']
    Invoke-SilentUninstall $Facts
    $left = $Facts['leftovers']
    $Facts['clean'] = -not ($left['installDirLeft'] -or $left['vendorRegistryLeft'] -or $left['uninstallKeyLeft'])
    $prefix = 'приложение работало: {0}; ' -f $Facts['appRunningBeforeUninstall']
    $suffix = '; Software\LAVRay {0}; чисто: {1}' -f $left['vendorRegistryLeft'], $Facts['clean']
    $Facts['headline'] = $prefix + $Facts['headline'] + $suffix
}
