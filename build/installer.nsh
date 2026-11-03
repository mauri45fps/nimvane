; Register Nimvane as a browser so it shows up in Windows Settings > Default apps.
; electron-builder includes this file automatically. SHCTX is HKCU for a per-user install
; and HKLM for an all-users install.

!define NV_CLIENT "Software\Clients\StartMenuInternet\Nimvane"
!define NV_EXE "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

!macro customInstall
  WriteRegStr SHCTX "${NV_CLIENT}" "" "Nimvane"
  WriteRegStr SHCTX "${NV_CLIENT}\DefaultIcon" "" "${NV_EXE},0"
  WriteRegStr SHCTX "${NV_CLIENT}\shell\open\command" "" '"${NV_EXE}"'
  WriteRegStr SHCTX "${NV_CLIENT}\Capabilities" "ApplicationName" "Nimvane"
  WriteRegStr SHCTX "${NV_CLIENT}\Capabilities" "ApplicationIcon" "${NV_EXE},0"
  WriteRegStr SHCTX "${NV_CLIENT}\Capabilities" "ApplicationDescription" "Fast, lean, privacy-first web browser"
  WriteRegStr SHCTX "${NV_CLIENT}\Capabilities\URLAssociations" "http" "NimvaneURL"
  WriteRegStr SHCTX "${NV_CLIENT}\Capabilities\URLAssociations" "https" "NimvaneURL"
  WriteRegStr SHCTX "${NV_CLIENT}\Capabilities\FileAssociations" ".html" "NimvaneHTML"
  WriteRegStr SHCTX "${NV_CLIENT}\Capabilities\FileAssociations" ".htm" "NimvaneHTML"
  WriteRegStr SHCTX "${NV_CLIENT}\Capabilities\StartMenu" "StartMenuInternet" "Nimvane"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Nimvane" "${NV_CLIENT}\Capabilities"

  WriteRegStr SHCTX "Software\Classes\NimvaneURL" "" "Nimvane URL"
  WriteRegStr SHCTX "Software\Classes\NimvaneURL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\NimvaneURL\DefaultIcon" "" "${NV_EXE},0"
  WriteRegStr SHCTX "Software\Classes\NimvaneURL\shell\open\command" "" '"${NV_EXE}" "%1"'
  WriteRegStr SHCTX "Software\Classes\NimvaneHTML" "" "Nimvane HTML Document"
  WriteRegStr SHCTX "Software\Classes\NimvaneHTML\DefaultIcon" "" "${NV_EXE},0"
  WriteRegStr SHCTX "Software\Classes\NimvaneHTML\shell\open\command" "" '"${NV_EXE}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "${NV_CLIENT}"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Nimvane"
  DeleteRegKey SHCTX "Software\Classes\NimvaneURL"
  DeleteRegKey SHCTX "Software\Classes\NimvaneHTML"
!macroend
