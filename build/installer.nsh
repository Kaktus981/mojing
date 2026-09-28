!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "getProcessInfo.nsh"

!define MUI_DIRECTORYPAGE_TEXT_TOP "墨境将安装到下方文件夹。若需更改，请点击“浏览”；确认后点击“安装”。"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "安装位置"

Var pid

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  ${GetParameters} $R0
  ${If} $R0 == "/restore"
    InitPluginsDir
    File /oname=$PLUGINSDIR\mojing-maintenance.ps1 "${BUILD_RESOURCES_DIR}\installer-maintenance.ps1"
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\mojing-maintenance.ps1" -Mode RestoreUpgrade -UserDataDir "$APPDATA\mojing-novel-studio" -RecoveryRoot "$LOCALAPPDATA\墨境\mojing-upgrade-recovery"' $R1
    ${If} $R1 == 0
      MessageBox MB_OK|MB_ICONINFORMATION "已恢复上一版本的墨境和升级前的作品数据。"
    ${Else}
      MessageBox MB_OK|MB_ICONSTOP "恢复未完成。请保留恢复文件并检查安装目录。"
    ${EndIf}
    Quit
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "墨境 1.0.0 仅支持 Windows 11 64 位。"
    Abort
  ${EndIf}
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "InstallationType"
  ${If} $0 != "Client"
    MessageBox MB_OK|MB_ICONSTOP "墨境 1.0.0 仅支持 Windows 11 64 位。"
    Abort
  ${EndIf}
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows NT\CurrentVersion" "CurrentBuildNumber"
  IntCmp $0 22000 mojing_windows_check_upper mojing_windows_unsupported mojing_windows_check_upper
  mojing_windows_check_upper:
    IntCmp $0 30000 mojing_windows_unsupported mojing_windows_supported mojing_windows_unsupported
  mojing_windows_unsupported:
    MessageBox MB_OK|MB_ICONSTOP "墨境 1.0.0 仅支持 Windows 11 64 位。"
    Abort
  mojing_windows_supported:
!macroend

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "请先保存墨境中正在编辑的内容。确认后安装程序会关闭墨境并继续。" /SD IDCANCEL IDOK +2
    Quit
  ${EndIf}
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      InitPluginsDir
      File /oname=$PLUGINSDIR\mojing-maintenance.ps1 "${BUILD_RESOURCES_DIR}\installer-maintenance.ps1"
      CreateDirectory "$LOCALAPPDATA\墨境\mojing-upgrade-recovery"
      ExecWait '"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\mojing-maintenance.ps1" -Mode PrepareUpgrade -InstallDir "$INSTDIR" -UserDataDir "$APPDATA\mojing-novel-studio" -RecoveryRoot "$LOCALAPPDATA\墨境\mojing-upgrade-recovery"' $R0
      ${If} $R0 != 0
        MessageBox MB_OK|MB_ICONSTOP "升级前的作品备份未完成。墨境未安装新版本；请检查本机数据后重试。"
        Abort
      ${EndIf}
    ${EndIf}
  !endif
!macroend

!macro customInstall
  ${If} ${FileExists} "$LOCALAPPDATA\墨境\mojing-upgrade-recovery\latest\program\墨境.exe"
    CopyFiles /SILENT "$EXEPATH" "$LOCALAPPDATA\墨境\mojing-upgrade-recovery\恢复上一版本.exe"
    SetShellVarContext current
    CreateShortCut "$SMPROGRAMS\恢复上一版本的墨境.lnk" "$LOCALAPPDATA\墨境\mojing-upgrade-recovery\恢复上一版本.exe" "/restore"
  ${EndIf}
!macroend

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.MojingDataPageShow un.MojingDataPageLeave

  Var MojingDataCheckbox
  Var MojingRemoveData

  Function un.MojingDataPageShow
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 32u "卸载墨境时，默认保留作品和个人设置，方便以后重新安装。"
    Pop $0
    ${NSD_CreateCheckbox} 0 45u 100% 24u "同时删除这台电脑上的墨境作品和设置"
    Pop $MojingDataCheckbox
    ${NSD_Uncheck} $MojingDataCheckbox
    nsDialogs::Show
  FunctionEnd

  Function un.MojingDataPageLeave
    ${NSD_GetState} $MojingDataCheckbox $MojingRemoveData
    ${If} $MojingRemoveData == ${BST_CHECKED}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "再次确认：这将删除本机的墨境作品和个人设置，不能通过重新安装找回。确定继续吗？" /SD IDNO IDYES +2
      Abort
    ${EndIf}
  FunctionEnd
!macroend

!macro customUnInstall
  SetShellVarContext current
  Delete "$SMPROGRAMS\恢复上一版本的墨境.lnk"
  ${If} $MojingRemoveData == ${BST_CHECKED}
    InitPluginsDir
    File /oname=$PLUGINSDIR\mojing-maintenance.ps1 "${BUILD_RESOURCES_DIR}\installer-maintenance.ps1"
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\mojing-maintenance.ps1" -Mode DeleteUserData -UserDataDir "$APPDATA\mojing-novel-studio" -RecoveryRoot "$LOCALAPPDATA\墨境\mojing-upgrade-recovery"' $R0
    ${If} $R0 != 0
      MessageBox MB_OK|MB_ICONSTOP "作品与设置删除未完成，已停止卸载。请检查数据目录后重试。"
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装墨境"
  !define MUI_WELCOMEPAGE_TEXT "墨境帮助你从灵感写到完整故事。安装程序只为当前 Windows 用户安装。$\r$\n$\r$\n点击“下一步”选择安装位置。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !undef MUI_WELCOMEFINISHPAGE_BITMAP
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${BUILD_RESOURCES_DIR}\installerFinish.bmp"
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "立即打开墨境"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "创建桌面快捷方式"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "MojingCreateDesktopShortcut"
  !insertmacro MUI_PAGE_FINISH

  Function StartApp
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" ""
  FunctionEnd

  Function MojingCreateDesktopShortcut
    SetShellVarContext current
    CreateShortCut "$DESKTOP\墨境.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  FunctionEnd
!macroend
