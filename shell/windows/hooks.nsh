; SPDX-License-Identifier: GPL-3.0-only
;
; NSIS installer hooks for LAVRay (Tauri 2: bundle.windows.nsis.installerHooks).
; Kept ASCII-only on purpose: NSIS reads a .nsh without BOM in the ANSI code page.
;
; T-81/T-82: uninstalling the app must also remove its autostart. LAVRay can be
; started with Windows in two ways (see shell/src/autostart.rs):
;   - without administrator rights: value "LAVRay" in HKCU\...\CurrentVersion\Run;
;   - with administrator rights: Task Scheduler tasks "LAVRay-<SID>" (one per user,
;     run level highest; the plain name "LAVRay" is removed too).
; There is no system service and no wintun.dll to remove: wintun is embedded in
; the core (sing-tun) and loaded from memory.
;
; The hook runs in POSTUNINSTALL: by then the uninstaller has already checked that
; the app is not running and has removed the files. A plain Run value of the current
; user is removed with DeleteRegValue; the tasks of all users with Unregister-ScheduledTask
; (the uninstaller of a per-machine install is elevated). PowerShell is started by its
; real System32 path with file system redirection off (the installer is a 32-bit
; program). Errors are ignored on purpose: a missing task is not a failure.

!macro NSIS_HOOK_POSTUNINSTALL
  ; An update runs the old uninstaller with /UPDATE and must keep autostart
  ; (the stock template keeps the Run value on updates for the same reason).
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LAVRay"
    ${If} ${RunningX64}
      ${DisableX64FSRedirection}
    ${EndIf}
    nsExec::Exec `"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-ScheduledTask -TaskName 'LAVRay','LAVRay-*' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$$false -ErrorAction SilentlyContinue"`
    Pop $0
    ${If} ${RunningX64}
      ${EnableX64FSRedirection}
    ${EndIf}
  ${EndIf}
!macroend
