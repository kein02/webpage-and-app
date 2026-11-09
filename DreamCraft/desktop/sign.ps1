param([string]$FilePath, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -le 5) { $env:PSModulePath = Join-Path $PSHOME 'Modules' }
$imported = $null
try {
    $thumbprint = $env:DREAMCRAFT_SIGN_THUMBPRINT
    if ($env:DREAMCRAFT_SIGN_PFX) {
        $password = ConvertTo-SecureString -String $env:DREAMCRAFT_SIGN_CERT_PASSWORD -AsPlainText -Force
        $contents = Get-PfxData -FilePath $env:DREAMCRAFT_SIGN_PFX -Password $password
        if (@($contents.EndEntityCertificates).Count -ne 1) { throw 'PFX must contain exactly one signing certificate' }
        $thumbprint = $contents.EndEntityCertificates[0].Thumbprint
        if (!(Test-Path -LiteralPath "Cert:\CurrentUser\My\$thumbprint")) {
            $imported = Import-PfxCertificate -FilePath $env:DREAMCRAFT_SIGN_PFX -CertStoreLocation Cert:\CurrentUser\My -Password $password |
                Where-Object HasPrivateKey
        }
    }
    if (!$thumbprint -or $thumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Configure a trusted code signing certificate' }
    $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint"
    if (!$certificate.HasPrivateKey -or !$certificate.Verify() -or
        !($certificate.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3')) {
        throw 'Certificate must have a private key, trusted chain and Code Signing usage'
    }
    $tool = $env:DREAMCRAFT_SIGNTOOL
    if (!$tool) {
        $tool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if (!$tool -or !(Test-Path -LiteralPath $tool)) { throw 'Windows SDK signtool.exe is required' }
    if ($CheckOnly) { Write-Output 'PASS trusted signing certificate and SignTool'; return }
    $timestamp = $env:DREAMCRAFT_SIGN_TIMESTAMP
    if (!$timestamp) { $timestamp = 'http://timestamp.digicert.com' }
    & $tool sign /q /s My /sha1 $thumbprint /fd SHA256 /tr $timestamp /td SHA256 $FilePath
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing or timestamp failed' }
    & $tool verify /pa /all /q $FilePath
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode verification failed' }
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate) {
        throw 'A trusted timestamped signature is required'
    }
} finally {
    if ($imported) { Remove-Item -LiteralPath ("Cert:\CurrentUser\My\" + $imported.Thumbprint) }
}
