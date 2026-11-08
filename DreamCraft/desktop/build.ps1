param(
    [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
$frontend = Join-Path $ProjectRoot 'app\frontend'
Push-Location $frontend
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
} finally { Pop-Location }
$backend = Join-Path $ProjectRoot 'app\backend'
& $Python (Join-Path $PSScriptRoot 'make_icon.py')
if ($LASTEXITCODE -ne 0) { throw 'Icon build failed' }
$buildRoot = Join-Path $ProjectRoot ('build\windows-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
& $Python -m PyInstaller --noconfirm --onedir --windowed --name DreamCraft --noupx `
    --icon (Join-Path $PSScriptRoot 'app.ico') --version-file (Join-Path $PSScriptRoot 'version.txt') `
    --distpath (Join-Path $buildRoot 'dist') --workpath (Join-Path $buildRoot 'work') `
    --specpath $buildRoot --paths $backend --hidden-import main --hidden-import compose `
    --collect-submodules uvicorn --collect-all cryptography `
    --add-data "$(Join-Path $frontend 'dist');frontend" --add-data "$(Join-Path $PSScriptRoot 'app.ico');." (Join-Path $PSScriptRoot 'desktop.py')
if ($LASTEXITCODE -ne 0) { throw 'Executable build failed' }
$appFolder = Join-Path $buildRoot 'dist\DreamCraft'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '使用说明.txt') -Destination $appFolder
$forbidden = Get-ChildItem -LiteralPath $appFolder -Recurse -Force -File | Where-Object {
    $_.Name -match '\.(db|db-wal|db-shm)$|^\.env$|^\.jwt-secret$|^\.engine-key$' -or
    $_.FullName -match '\\(uploads|exports)\\'
}
if ($forbidden) { throw 'Private runtime data found in release' }
$archive = Join-Path $ProjectRoot ('releases\DreamCraft-Windows-x64-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
Compress-Archive -LiteralPath $appFolder -DestinationPath $archive
Get-FileHash -LiteralPath $archive -Algorithm SHA256
Write-Output "APP=$appFolder"
Write-Output "ZIP=$archive"
$compiler = Join-Path $ProjectRoot 'tools\InnoSetup\ISCC.exe'
if (Test-Path -LiteralPath $compiler) {
    & $compiler /Q "/DAppSource=$appFolder" (Join-Path $PSScriptRoot 'installer.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
} else { Write-Warning 'Inno Setup not found; portable ZIP only' }
