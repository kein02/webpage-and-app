param([string]$Python = 'python', [string]$ReleaseRoot, [string]$Version)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (!$Version) { $Version = (Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw).Trim() }
if (!$ReleaseRoot) { $ReleaseRoot = Join-Path $root 'releases' }
$testRoot = Join-Path $root ('tests\output\installer-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$installDir = Join-Path $testRoot 'installed'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DreamCraft.lnk'
$menuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'DreamCraft'
$registryKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{7B50A372-A404-4B9C-9D99-73DECF6F9058}_is1'
if ((Test-Path $desktopLink) -or (Test-Path $menuDir) -or (Test-Path $registryKey)) {
    throw 'Existing DreamCraft installation/shortcut found; refusing to overwrite it'
}
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$userData = Join-Path $env:LOCALAPPDATA 'DreamCraft'
New-Item -ItemType Directory -Path $userData -Force | Out-Null
$sentinel = Join-Path $userData ('installer-qa-' + [guid]::NewGuid() + '.txt')
[IO.File]::WriteAllText($sentinel, 'preserve user data')
try {
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/LANG=chinesesimplified',
        ('/DIR="' + $installDir + '"'), '/TASKS=desktopicon',
        ('/LOG="' + (Join-Path $testRoot 'install.log') + '"'))
    $setup = Start-Process -FilePath (Join-Path $ReleaseRoot "DreamCraft-Setup-$version-x64.exe") -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden
    if ($setup.ExitCode -ne 0) { throw "Installation failed: $($setup.ExitCode)" }
    $exe = Join-Path $installDir 'DreamCraft.exe'
    if ((Get-Item -LiteralPath $exe).VersionInfo.ProductVersion -ne $version) { throw 'Incorrect EXE version' }
    $shell = New-Object -ComObject WScript.Shell
    foreach ($link in @($desktopLink, (Join-Path $menuDir 'DreamCraft.lnk'))) {
        if (!(Test-Path -LiteralPath $link)) { throw "Shortcut missing: $link" }
        if ($shell.CreateShortcut($link).TargetPath -ne $exe) { throw 'Incorrect shortcut target' }
    }
    if ((Get-ItemProperty $registryKey).DisplayVersion -ne $version) { throw 'Incorrect installed version' }
    Write-Output 'PASS installer: version, desktop shortcut and start menu shortcut'
    & $Python (Join-Path $root 'desktop\test_desktop.py') $exe --version $version
    if ($LASTEXITCODE -ne 0) { throw 'Installed executable regression failed' }
} finally {
    $uninstaller = Join-Path $installDir 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -PassThru -Wait -WindowStyle Hidden
        if ($uninstall.ExitCode -ne 0) { throw 'Uninstall failed' }
    }
    if (!(Test-Path -LiteralPath $sentinel)) { throw 'Uninstaller deleted user data' }
    Remove-Item -LiteralPath $sentinel
}
if ((Test-Path $desktopLink) -or (Test-Path $menuDir) -or (Test-Path $registryKey) -or (Test-Path (Join-Path $installDir 'DreamCraft.exe'))) {
    throw 'Uninstall left application files, shortcuts or registration behind'
}
Write-Output 'PASS uninstall: removes application/shortcuts/registration and preserves user data'
Write-Output "EVIDENCE=$testRoot"
