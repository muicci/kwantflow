; Microsoft prerequisites remain separately licensed. App uninstall does not
; remove shared platform runtimes or any user workspace/data.
!include "LogicLib.nsh"
!include "WordFunc.nsh"
!include "${__FILEDIR__}\..\src-tauri\native-runtime\windows-prerequisites.nsh"
; __FILEDIR__ inside a macro resolves at invocation in Tauri's generated script.
!define KWANTFLOW_HOOK_DIRECTORY "${__FILEDIR__}"

; Accept only four numeric, bounded version components before VersionCompare.
; Empty, malformed and 0.0.0.0 registry entries cannot satisfy the browser floor.
Function KwantflowWebView2VersionIsCompatible
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  StrCpy $1 0 ; character index
  StrCpy $2 0 ; number of separators
  StrCpy $4 0 ; digits in this component
  StrCpy $5 0 ; numeric component value
  kwantflow_webview_version_loop:
    StrCpy $3 $0 1 $1
    StrCmp $3 "" kwantflow_webview_version_end
    StrCmp $3 "." kwantflow_webview_version_separator
    StrCmp $3 "0" kwantflow_webview_version_digit
    StrCmp $3 "1" kwantflow_webview_version_digit
    StrCmp $3 "2" kwantflow_webview_version_digit
    StrCmp $3 "3" kwantflow_webview_version_digit
    StrCmp $3 "4" kwantflow_webview_version_digit
    StrCmp $3 "5" kwantflow_webview_version_digit
    StrCmp $3 "6" kwantflow_webview_version_digit
    StrCmp $3 "7" kwantflow_webview_version_digit
    StrCmp $3 "8" kwantflow_webview_version_digit
    StrCmp $3 "9" kwantflow_webview_version_digit
    Goto kwantflow_webview_version_invalid
  kwantflow_webview_version_digit:
    ${If} $4 > 0
    ${AndIf} $5 == 0
      Goto kwantflow_webview_version_invalid
    ${EndIf}
    IntOp $4 $4 + 1
    IntCmp $4 5 0 0 kwantflow_webview_version_invalid
    IntOp $5 $5 * 10
    IntOp $5 $5 + $3
    IntCmp $5 65535 0 0 kwantflow_webview_version_invalid
    Goto kwantflow_webview_version_next
  kwantflow_webview_version_separator:
    StrCmp $4 0 kwantflow_webview_version_invalid
    IntOp $2 $2 + 1
    IntCmp $2 3 0 0 kwantflow_webview_version_invalid
    StrCpy $4 0
    StrCpy $5 0
  kwantflow_webview_version_next:
    IntOp $1 $1 + 1
    Goto kwantflow_webview_version_loop
  kwantflow_webview_version_end:
    StrCmp $4 0 kwantflow_webview_version_invalid
    StrCmp $2 3 0 kwantflow_webview_version_invalid
    StrCmp $0 "0.0.0.0" kwantflow_webview_version_invalid
    ${VersionCompare} "$0" "${KWANTFLOW_WEBVIEW2_MINIMUM_VERSION}" $3
    StrCmp $3 2 kwantflow_webview_version_stale
    StrCpy $0 1
    Goto kwantflow_webview_version_return
  kwantflow_webview_version_stale:
    StrCpy $0 2
    Goto kwantflow_webview_version_return
  kwantflow_webview_version_invalid:
    StrCpy $0 0
  kwantflow_webview_version_return:
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
FunctionEnd

Function KwantflowWebView2IsCompatible
  Push $0
  Push $1
  SetRegView 32
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${KWANTFLOW_WEBVIEW2_APP_GUID}" "pv"
  Push $0
  Call KwantflowWebView2VersionIsCompatible
  Pop $1
  ; A registered stale machine runtime must be repaired even if a newer user
  ; registration exists. Do not assume undocumented runtime-selection priority.
  StrCmp $1 0 0 kwantflow_webview_registry_done
  ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${KWANTFLOW_WEBVIEW2_APP_GUID}" "pv"
  Push $0
  Call KwantflowWebView2VersionIsCompatible
  Pop $1
  kwantflow_webview_registry_done:
    SetRegView lastused
    ${If} $1 != 1
      StrCpy $1 0
    ${EndIf}
    StrCpy $0 $1
    Pop $1
    Exch $0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; Tauri's WebView mode is deliberately skip: this hook owns BOTH absent and
  ; obsolete runtime handling, including app upgrades. No EdgeUpdate download.
  Push $0
  Call KwantflowWebView2IsCompatible
  Pop $0
  StrCmp $0 1 kwantflow_webview_done
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" "${KWANTFLOW_HOOK_DIRECTORY}\..\src-tauri\native-runtime\prerequisites\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
  IfErrors kwantflow_webview_failed
  DetailPrint "Installing the bundled Microsoft WebView2 runtime (minimum ${KWANTFLOW_WEBVIEW2_MINIMUM_VERSION})..."
  DetailPrint "Microsoft's shared runtime may require administrator approval."
  ClearErrors
  ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" /silent /install' $0
  IfErrors kwantflow_webview_failed
  ${If} $0 == 3010
    Goto kwantflow_webview_reboot
  ${ElseIf} $0 == 1641
    Goto kwantflow_webview_reboot
  ${ElseIf} $0 != 0
    Goto kwantflow_webview_failed
  ${EndIf}
  ; Installer success alone is insufficient. Re-read the actual runtime version.
  Call KwantflowWebView2IsCompatible
  Pop $0
  StrCmp $0 1 kwantflow_webview_done kwantflow_webview_failed
  kwantflow_webview_reboot:
    SetRebootFlag true
    SetErrorLevel $0
    MessageBox MB_ICONSTOP "Microsoft WebView2 requires a Windows restart. Restart Windows, then run the Kwantflow installer again. Kwantflow has not been installed by this run." /SD IDOK
    Abort
  kwantflow_webview_failed:
    SetErrorLevel 1
    MessageBox MB_ICONSTOP "Microsoft WebView2 installation or version verification failed. Administrator approval or your organization's permission may be required for Microsoft's shared runtime. Install WebView2 ${KWANTFLOW_WEBVIEW2_MINIMUM_VERSION} or newer, then run the Kwantflow installer again." /SD IDOK
    Abort
  kwantflow_webview_done:
    Pop $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !if ${KWANTFLOW_VC_REDIST_REQUIRED} == 1
    Push $0
    Push $1
    Push $2
    SetRegView 64
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    ReadRegStr $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Version"
    ; Microsoft prefixes Version with "v"; VersionCompare requires numeric text.
    StrCpy $2 $1 1
    ${If} $2 == "v"
      StrCpy $1 $1 "" 1
    ${EndIf}
    ${If} $0 == 1
      ${VersionCompare} "$1" "${KWANTFLOW_VC_REDIST_VERSION}" $2
      ${If} $2 != 2
        Goto kwantflow_vc_done
      ${EndIf}
    ${EndIf}
    ${IfNot} ${FileExists} "$INSTDIR\local-ai\native\prerequisites\vc_redist.x64.exe"
      MessageBox MB_ICONSTOP "The bundled Visual C++ runtime installer is missing. Kwantflow cannot be installed." /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
    DetailPrint "Installing the bundled Microsoft Visual C++ runtime..."
    ; The Microsoft bootstrapper handles its own UAC elevation when needed.
    ClearErrors
    IfSilent 0 kwantflow_vc_passive
      ExecWait '"$INSTDIR\local-ai\native\prerequisites\vc_redist.x64.exe" /install /quiet /norestart' $0
      Goto kwantflow_vc_result
    kwantflow_vc_passive:
      ExecWait '"$INSTDIR\local-ai\native\prerequisites\vc_redist.x64.exe" /install /passive /norestart' $0
    kwantflow_vc_result:
    IfErrors kwantflow_vc_failed
    ${If} $0 == 3010
      Goto kwantflow_vc_reboot
    ${ElseIf} $0 == 1641
      Goto kwantflow_vc_reboot
    ${ElseIf} $0 != 0
      ; A newer runtime can win an installation race. Re-check it below.
      ${If} $0 != 1638
        Goto kwantflow_vc_failed
      ${EndIf}
    ${EndIf}
    ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    ReadRegStr $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Version"
    StrCpy $2 $1 1
    ${If} $2 == "v"
      StrCpy $1 $1 "" 1
    ${EndIf}
    ${If} $0 != 1
      Goto kwantflow_vc_failed
    ${EndIf}
    ${VersionCompare} "$1" "${KWANTFLOW_VC_REDIST_VERSION}" $2
    ${If} $2 == 2
      Goto kwantflow_vc_failed
    ${EndIf}
    Goto kwantflow_vc_done
    kwantflow_vc_reboot:
      SetRebootFlag true
      SetErrorLevel $0
      MessageBox MB_ICONSTOP "Microsoft Visual C++ requires a Windows restart. Restart Windows, then run the Kwantflow installer again. Application files may already have been copied, but setup has not completed." /SD IDOK
      Abort
    kwantflow_vc_failed:
      MessageBox MB_ICONSTOP "Microsoft Visual C++ runtime installation failed. Install the bundled runtime with administrator approval, then run the Kwantflow installer again." /SD IDOK
      SetErrorLevel 1
      Abort
    kwantflow_vc_done:
    SetRegView lastused
    Pop $2
    Pop $1
    Pop $0
  !endif
!macroend
