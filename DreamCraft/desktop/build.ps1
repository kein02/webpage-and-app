param(
    [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
    [string]$Python = 'python',
    [string]$Compiler,
    [switch]$RequireInstaller,
    [switch]$RequireSignature
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$signing = [bool]($env:DREAMCRAFT_SIGN_THUMBPRINT -or $env:DREAMCRAFT_SIGN_PFX)
if ($RequireSignature -and !$signing) { throw 'Trusted signing credentials are required' }
if ($signing) {
    & (Join-Path $PSScriptRoot 'sign.ps1') -CheckOnly
} else { Write-Warning 'Building unsigned packages: no trusted signing certificate configured' }
& $Python (Join-Path $ProjectRoot 'scripts\version.py')
if ($LASTEXITCODE -ne 0) { throw 'Version validation failed' }
$version = (Get-Content -LiteralPath (Join-Path $ProjectRoot 'VERSION') -Raw).Trim()
$releaseRoot = Join-Path $ProjectRoot 'releases'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
if (!$Compiler) { $Compiler = Join-Path $ProjectRoot 'tools\InnoSetup\ISCC.exe' }
if ($RequireInstaller -and !(Test-Path -LiteralPath $Compiler)) { throw 'Inno Setup compiler is required' }
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
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
$resource = Join-Path $buildRoot 'version.txt'
& $Python (Join-Path $ProjectRoot 'scripts\version.py') --resource $resource
if ($LASTEXITCODE -ne 0) { throw 'Version resource generation failed' }
& $Python -m PyInstaller --noconfirm --onedir --windowed --name DreamCraft --noupx `
    --icon (Join-Path $PSScriptRoot 'app.ico') --version-file $resource `
    --distpath (Join-Path $buildRoot 'dist') --workpath (Join-Path $buildRoot 'work') `
    --specpath $buildRoot --paths $backend --hidden-import main --hidden-import compose `
    --collect-submodules uvicorn --collect-all cryptography `
    --add-data "$(Join-Path $frontend 'dist');frontend" --add-data "$(Join-Path $PSScriptRoot 'app.ico');." `
    --add-data "$(Join-Path $ProjectRoot 'VERSION');." (Join-Path $PSScriptRoot 'desktop.py')
if ($LASTEXITCODE -ne 0) { throw 'Executable build failed' }
$appFolder = Join-Path $buildRoot 'dist\DreamCraft'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'apply-update.ps1') -Destination (Join-Path $appFolder '_internal')
if ($signing) { & (Join-Path $PSScriptRoot 'sign.ps1') -FilePath (Join-Path $appFolder 'DreamCraft.exe') }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '使用说明.txt') -Destination $appFolder
$forbidden = Get-ChildItem -LiteralPath $appFolder -Recurse -Force -File | Where-Object {
    $_.Name -match '\.(db|db-wal|db-shm)$|^\.env$|^\.jwt-secret$|^\.engine-key$' -or
    $_.FullName -match '\\(uploads|exports)\\'
}
if ($forbidden) { throw 'Private runtime data found in release' }
$archive = Join-Path $releaseRoot "DreamCraft-Windows-$version-x64.zip"
Compress-Archive -LiteralPath $appFolder -DestinationPath $archive -Force
Write-Output "APP=$appFolder"
Write-Output "ZIP=$archive"
$artifacts = @($archive)
if (Test-Path -LiteralPath $Compiler) {
    $signArguments = @()
    if ($signing) {
        $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $signer = Join-Path $PSScriptRoot 'sign.ps1'
        $signArguments = @('/DSignRelease=1', ('/Sdreamcraft=$q' + $powershell + '$q -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $q' + $signer + '$q -FilePath $f'))
    }
    & $Compiler /Q "/DAppSource=$appFolder" "/DAppVersion=$version" "/O$releaseRoot" @signArguments (Join-Path $PSScriptRoot 'installer.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' }
    $artifacts += Join-Path $releaseRoot "DreamCraft-Setup-$version-x64.exe"
    if ($signing) {
        $signature = Get-AuthenticodeSignature -LiteralPath $artifacts[-1]
        if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate) { throw 'Installer signature verification failed' }
    }
} else { Write-Warning 'Inno Setup not found; portable ZIP only' }
$sums = foreach ($artifact in $artifacts) {
    $hash = Get-FileHash -LiteralPath $artifact -Algorithm SHA256
    $hash.Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($artifact)
}
[IO.File]::WriteAllLines((Join-Path $releaseRoot 'SHA256SUMS.txt'), [string[]]$sums, [Text.Encoding]::ASCII)
Copy-Item -LiteralPath (Join-Path $ProjectRoot "docs\releases\$version.md") -Destination (Join-Path $releaseRoot "release-notes-$version.md") -Force
