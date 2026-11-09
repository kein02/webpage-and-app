param([Parameter(Mandatory)][string]$Plan)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -le 5) { $env:PSModulePath = Join-Path $PSHOME 'Modules' }
$cache = Split-Path (Resolve-Path -LiteralPath $Plan).Path -Parent
$log = Join-Path $cache 'update.log'
try {
    $p = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
    $app = [IO.Path]::GetFullPath($p.app).TrimEnd('\')
    $payload = [IO.Path]::GetFullPath($p.payload)
    if (!(Split-Path $cache -Leaf).StartsWith('.dreamcraft-update-') -or
        (Split-Path $cache -Parent) -ne (Split-Path $app -Parent) -or
        (Split-Path $payload -Parent) -ne $cache -or
        $p.version -notmatch '^\d+\.\d+\.\d+$' -or
        $p.kind -notin @('portable', 'installed') -or
        !(Test-Path -LiteralPath (Join-Path $app 'DreamCraft.exe'))) {
        throw 'Invalid update paths or metadata'
    }
    if ((Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant() -ne $p.sha256) {
        throw 'Update package changed after verification'
    }
    $currentExe = Join-Path $app 'DreamCraft.exe'
    if ([version](Get-Item -LiteralPath $currentExe).VersionInfo.ProductVersion -ge [version]$p.version) {
        throw 'Refusing a downgrade or replayed update'
    }
    $currentSignature = Get-AuthenticodeSignature -LiteralPath $currentExe
    if ($p.kind -eq 'portable') {
        $staged = [IO.Path]::GetFullPath($p.staged)
        $backup = [IO.Path]::GetFullPath($p.backup)
        if ($staged -ne (Join-Path $cache 'unpacked\DreamCraft') -or
            (Split-Path $backup -Parent) -ne (Split-Path $app -Parent) -or
            !(Split-Path $backup -Leaf).StartsWith((Split-Path $app -Leaf) + '.previous-') -or
            (Test-Path -LiteralPath $backup)) { throw 'Invalid portable update paths' }
        $candidate = Join-Path $staged 'DreamCraft.exe'
    } else { $candidate = $payload }
    if (!(Test-Path -LiteralPath $candidate) -or
        (Get-Item -LiteralPath $candidate).VersionInfo.ProductVersion.Trim() -ne $p.version) {
        throw 'Update executable version mismatch'
    }
    if ($currentSignature.Status -eq 'Valid') {
        $signature = Get-AuthenticodeSignature -LiteralPath $candidate
        if ($signature.Status -ne 'Valid' -or
            $signature.SignerCertificate.Subject -ne $currentSignature.SignerCertificate.Subject) {
            throw 'Update publisher signature does not match'
        }
    }
    # Signal readiness only after all checks, before asking the launcher to close.
    [IO.File]::WriteAllText((Join-Path $cache 'ready'), 'ready')
    $running = Get-Process -Id $p.pid -ErrorAction SilentlyContinue
    if ($running) { Wait-Process -Id $p.pid -Timeout 120 -ErrorAction Stop }
    if ($p.kind -eq 'installed') {
        $setup = Start-Process -FilePath $payload -ArgumentList @('/SILENT', '/SUPPRESSMSGBOXES',
            '/NORESTART', '/SP-', ('/DIR="' + $app + '"'), ('/LOG="' + (Join-Path $cache 'installer.log') + '"')) -Wait -PassThru -WindowStyle Hidden
        if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }
    } else {
        Move-Item -LiteralPath $app -Destination $backup
        try { Move-Item -LiteralPath $staged -Destination $app }
        catch {
            Move-Item -LiteralPath $backup -Destination $app
            throw
        }
    }
    if ((Get-Item -LiteralPath $currentExe).VersionInfo.ProductVersion -ne $p.version) {
        throw 'Installed application version mismatch'
    }
    $restartArgs = @('--data-dir', ('"' + $p.data + '"'))
    if ($p.noBrowser) { $restartArgs += '--no-browser' }
    Start-Process -FilePath $currentExe -ArgumentList $restartArgs -WorkingDirectory $app -WindowStyle Normal
    [IO.File]::WriteAllText($log, 'Update completed: ' + $p.version)
} catch {
    [IO.File]::WriteAllText($log, $_.Exception.Message)
    [IO.File]::WriteAllText((Join-Path $cache 'failed'), $_.Exception.Message)
    exit 1
}
