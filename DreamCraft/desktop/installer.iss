#ifndef AppSource
  #error AppSource must point to the frozen DreamCraft directory
#endif
#ifndef AppVersion
  #error AppVersion must be provided by desktop/build.ps1
#endif
[Setup]
#ifdef SignRelease
SignTool=dreamcraft
SignedUninstaller=yes
#endif
AppId={{7B50A372-A404-4B9C-9D99-73DECF6F9058}
AppName=DreamCraft 造梦工坊
AppVersion={#AppVersion}
AppVerName=DreamCraft 造梦工坊 {#AppVersion}
AppPublisher=DreamCraft
DefaultDirName={localappdata}\Programs\DreamCraft
DefaultGroupName=DreamCraft
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\releases
OutputBaseFilename=DreamCraft-Setup-{#AppVersion}-x64
SetupIconFile=app.ico
UninstallDisplayIcon={app}\DreamCraft.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
VersionInfoVersion={#AppVersion}.0
[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\DreamCraft"; Filename: "{app}\DreamCraft.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\DreamCraft"; Filename: "{app}\DreamCraft.exe"; WorkingDir: "{app}"; Tasks: desktopicon
[Run]
Filename: "{app}\DreamCraft.exe"; Description: "{cm:LaunchProgram,DreamCraft}"; Flags: nowait postinstall skipifsilent
