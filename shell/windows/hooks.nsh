; SPDX-License-Identifier: GPL-3.0-only
;
; NSIS installer hooks for LAVRay (Tauri 2: bundle.windows.nsis.installerHooks).
; Kept ASCII-only on purpose: NSIS reads a .nsh without BOM in the ANSI code page.
;
; T-81/T-82: uninstalling the app must also remove its autostart. LAVRay can be
; started with Windows in two ways (see shell/src/autostart.rs):
;   - without administrator rights: value "LAVRay" in HKCU\...\CurrentVersion\Run;
;   - with administrator rights: Task Scheduler task "LAVRay" (run level highest).
; There is no system service and no wintun.dll to remove: wintun is embedded in
; the core (sing-tun) and loaded from memory.

!macro NSIS_HOOK_PREUNINSTALL
  ; An update runs the old uninstaller with /UPDATE and must keep autostart
  ; (the stock template keeps the Run value on updates for the same reason).
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "LAVRay"
    ; "schtasks /Delete" fails when the task does not exist; the exit code is
    ; ignored on purpose, so a missing task is not an error. Absolute path: the
    ; uninstaller runs elevated and must not search PATH.
    nsExec::Exec '"$SYSDIR\schtasks.exe" /Delete /TN LAVRay /F'
    Pop $0
  ${EndIf}
!macroend
