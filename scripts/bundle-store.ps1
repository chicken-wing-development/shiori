param(
    [string]$IdentityPath = 'store/store-identity.json',
    [string]$ReleaseDirectory = 'releases/v1.0.0/store'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$identity = Get-Content -LiteralPath $IdentityPath -Raw -Encoding UTF8 | ConvertFrom-Json
$config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$pkg = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
if ($identity.identityName -notmatch '^[A-Za-z0-9.-]{3,50}$' -or $identity.identityName -match '(?i)development|REPLACE_' -or
    $identity.publisher -notmatch '^CN=[0-9A-Fa-f-]{36}$' -or $identity.displayName -cne $config.productName) {
    throw 'A real Partner Center identity and matching product display name are required.'
}
$version = "$($pkg.version).0"
$release = [IO.Path]::GetFullPath((Join-Path $projectRoot $ReleaseDirectory))
$stage = Join-Path $projectRoot ('.store-build/bundle/' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($arch in @('x64', 'arm64')) {
    $name = "$($identity.identityName)_${version}_${arch}.msix"
    $file = Join-Path $release "packages/$name"
    $archive = [IO.Compression.ZipFile]::OpenRead($file)
    try {
        $reader = [IO.StreamReader]::new($archive.GetEntry('AppxManifest.xml').Open())
        try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $actual = $manifest.Package.Identity
        if ($actual.Name -cne $identity.identityName -or $actual.Publisher -cne $identity.publisher -or
            $actual.Version -cne $version -or $actual.ProcessorArchitecture -cne $arch -or
            $manifest.Package.Properties.DisplayName -cne $identity.displayName -or
            $manifest.Package.Properties.PublisherDisplayName -cne $identity.publisherDisplayName) {
            throw "Package identity mismatch: $name"
        }
    } finally { $archive.Dispose() }
    $recordedHash = ((Get-Content -LiteralPath "$file.sha256" -Raw).Trim() -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $recordedHash) { throw "Hash mismatch: $name" }
    Copy-Item -LiteralPath $file -Destination (Join-Path $stage $name)
}
$sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$makeappx = Get-Command makeappx.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $makeappx) {
    foreach ($sdk in (Get-ChildItem -LiteralPath $sdkBin -Directory | Where-Object Name -match '^\d+\.\d+\.\d+\.\d+$' | Sort-Object { [version]$_.Name } -Descending)) {
        foreach ($arch in @('arm64', 'x64', 'x86')) {
            if ($arch -eq 'arm64' -and $env:PROCESSOR_ARCHITECTURE -ne 'ARM64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'ARM64') { continue }
            $candidate = Join-Path $sdk.FullName "$arch/makeappx.exe"
            if (Test-Path -LiteralPath $candidate) { $makeappx = $candidate; break }
        }
        if ($makeappx) { break }
    }
}
if (-not $makeappx) { throw 'MakeAppx.exe was not found. Install the Windows SDK.' }
$upload = Join-Path $release 'upload'
New-Item -ItemType Directory -Path $upload -Force | Out-Null
$output = Join-Path $upload "$($identity.identityName)_${version}_x64_arm64.msixbundle"
& $makeappx bundle /d $stage /p $output /bv $version /o
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx bundle validation failed.' }
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$output.sha256", "$hash  $([IO.Path]::GetFileName($output))`n")
Write-Output "Store submission bundle: $output"
Write-Output 'This command does not sign, install, upload, or publish the app.'
