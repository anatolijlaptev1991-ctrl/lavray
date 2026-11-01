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
; The autostart hook runs in POSTUNINSTALL: by then the uninstaller has already checked that
; the app is not running and has removed the files. A plain Run value of the current
; user is removed with DeleteRegValue; the tasks of all users with Unregister-ScheduledTask
; (the uninstaller of a per-machine install is elevated). PowerShell is started by its
; real System32 path with file system redirection off (the installer is a 32-bit
; program). Errors are ignored on purpose: a missing task is not a failure.

; D-2 (test run of 0.9.0): the template stops only the main process
; (Restart Manager on lavray-shell.exe; the shell releases the system proxy on
; WM_ENDSESSION). The core is its child process: it exits by itself once the
; shell is gone, but not always before the template replaces or deletes the
; files, and a running binaries\lavray-core.exe can be neither overwritten nor
; deleted (the uninstaller left it behind with the install folder). So the PRE
; hooks stop the shell the same way the template does, then wait for the core to
; release its file (up to 10 s) and only then stop the core itself.
!define LAVRAY_CORE_EXE "$INSTDIR\binaries\lavray-core.exe"

!macro LAVRAY_WAIT_CORE
  Push $0
  Push $1
  StrCpy $1 0
  ${DoWhile} ${FileExists} "${LAVRAY_CORE_EXE}"
    ; A running exe cannot be opened for writing; "a" keeps the file as it is.
    ClearErrors
    FileOpen $0 "${LAVRAY_CORE_EXE}" a
    ${IfNot} ${Errors}
      FileClose $0
      ${Break}
    ${EndIf}
    ${If} $1 >= 40
      !insertmacro CheckIfAppIsRunning "${LAVRAY_CORE_EXE}" "${PRODUCTNAME}"
      ${Break}
    ${EndIf}
    IntOp $1 $1 + 1
    Sleep 250
  ${Loop}
  Pop $1
  Pop $0
!macroend

!macro LAVRAY_STOP_APP
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  !insertmacro LAVRAY_WAIT_CORE
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro LAVRAY_STOP_APP
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro LAVRAY_STOP_APP
!macroend

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
    ; D-2: the template forgets the install folder only when "delete app data"
    ; is ticked. A folder remembered after an uninstall sent the next silent
    ; install there instead of Program Files.
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
  ${EndIf}
!macroend
