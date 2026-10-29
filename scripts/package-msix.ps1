param(
    [ValidateSet('x64', 'arm64')][string]$Architecture = 'x64',
    [string]$IdentityPath = 'store/store-identity.json',
    [string]$OutputDirectory,
    [switch]$SkipBuild,
    [switch]$PrepareOnly,
    [switch]$MsixOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath $IdentityPath)) { throw 'Copy store/store-identity.example.json to store/store-identity.json and fill the Partner Center identity. Use store/development-identity.json only for local testing.' }
$identity = Get-Content -LiteralPath $IdentityPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($field in @('identityName', 'publisher', 'publisherDisplayName', 'displayName')) {
    if ($identity.$field -isnot [string] -or [string]::IsNullOrWhiteSpace($identity.$field) -or $identity.$field -match 'REPLACE_') { throw "Missing Partner Center identity field: $field" }
    if ($identity.$field -cne $identity.$field.Trim()) { throw "Identity field has leading/trailing whitespace: $field" }
}
if ($identity.identityName -notmatch '^[A-Za-z0-9.-]{3,50}$' -or $identity.publisher -notmatch '^CN=') { throw 'Invalid package identity or publisher.' }
$pkg = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
if ($pkg.version -notmatch '^([1-9]\d*)\.(\d+)\.(\d+)$') { throw 'MSIX requires a stable version such as 1.0.0.' }
$version = "$($pkg.version).0"
if (($version.Split('.') | Where-Object { [long]$_ -gt 65535 }).Count -gt 0) { throw 'MSIX version component exceeds 65535.' }
$triple = if ($Architecture -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
if (-not $SkipBuild) {
    & node 'node_modules/@tauri-apps/cli/tauri.js' build --no-bundle --target $triple -- --locked
    if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed.' }
}
$exe = Join-Path $projectRoot "src-tauri/target/$triple/release/shiori-markdown.exe"
if (-not (Test-Path -LiteralPath $exe)) { throw "Missing binary: $exe. Build with --target $triple." }
$binary = [IO.File]::ReadAllBytes($exe)
if ($binary.Length -lt 64 -or $binary[0] -ne 0x4d -or $binary[1] -ne 0x5a) { throw 'Not a Windows executable.' }
$pe = [BitConverter]::ToInt32($binary, 60)
if ($pe -lt 0 -or $pe + 6 -gt $binary.Length -or [BitConverter]::ToUInt32($binary, $pe) -ne 0x4550) { throw 'Invalid PE header.' }
$machine = [BitConverter]::ToUInt16($binary, $pe + 4)
$expected = if ($Architecture -eq 'arm64') { 0xaa64 } else { 0x8664 }
if ($machine -ne $expected) { throw 'Executable architecture does not match the package.' }
$productVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion
if ($productVersion -ne $pkg.version -and $productVersion -ne $version) { throw "Stale executable version: $productVersion (expected $version). Rebuild first." }
$tauriConfig = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$productName = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductName
if ($productName -cne $tauriConfig.productName) { throw "Stale executable product name: $productName. Rebuild first." }

$stage = Join-Path $projectRoot ('.store-build/' + $Architecture + '/' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $stage 'Assets') -Force | Out-Null
Copy-Item -LiteralPath $exe -Destination (Join-Path $stage 'shiori-markdown.exe')
foreach ($asset in @('StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "src-tauri/icons/$asset") -Destination (Join-Path $stage "Assets/$asset")
}
Copy-Item -LiteralPath 'dist-desktop/THIRD-PARTY-LICENSES.md' -Destination (Join-Path $stage 'THIRD-PARTY-JAVASCRIPT-LICENSES.md')
Get-Content -Raw -Encoding UTF8 -LiteralPath 'dist-desktop/DIAGRAM-LICENSES.md' | Add-Content -LiteralPath (Join-Path $stage 'THIRD-PARTY-JAVASCRIPT-LICENSES.md') -Encoding utf8
Copy-Item -LiteralPath 'docs/PRIVACY.md' -Destination (Join-Path $stage 'PRIVACY.md')
& node 'scripts/rust-licenses.mjs' $triple (Join-Path $stage 'THIRD-PARTY-RUST-LICENSES.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not generate Rust license notices.' }
$manifest = Get-Content -LiteralPath 'store/AppxManifest.xml' -Raw -Encoding UTF8
$replacements = @{
    '@IDENTITY_NAME@' = $identity.identityName
    '@PUBLISHER@' = $identity.publisher
    '@PUBLISHER_DISPLAY@' = $identity.publisherDisplayName
    '@DISPLAY_NAME@' = $identity.displayName
    '@VERSION@' = $version
    '@ARCH@' = $Architecture
}
foreach ($key in $replacements.Keys) { $manifest = $manifest.Replace($key, [Security.SecurityElement]::Escape($replacements[$key])) }
[xml]$checkedManifest = $manifest
[IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, [Text.UTF8Encoding]::new($false))
if ($PrepareOnly) { Write-Output "Prepared package contents: $stage"; exit 0 }

$makeappx = Get-Command makeappx.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $makeappx) {
    $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    $versions = @(Get-ChildItem -LiteralPath $sdkBin -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending)
    foreach ($sdk in $versions) {
        foreach ($hostArch in @('arm64', 'x64', 'x86')) {
            if ($hostArch -eq 'arm64' -and $env:PROCESSOR_ARCHITECTURE -ne 'ARM64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'ARM64') { continue }
            $candidate = Join-Path $sdk.FullName "$hostArch/makeappx.exe"
            if (Test-Path -LiteralPath $candidate) { $makeappx = $candidate; break }
        }
        if ($makeappx) { break }
    }
}
if (-not $makeappx) { throw 'MakeAppx.exe was not found. Install the Windows SDK.' }
$outDir = if ($OutputDirectory) { [IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory)) } else { Join-Path $projectRoot "releases/v$($pkg.version)/windows" }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$output = Join-Path $outDir "$($identity.identityName)_${version}_${Architecture}.msix"
& $makeappx pack /d $stage /p $output /o /h SHA256
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx validation/packaging failed.' }
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$output.sha256", "$hash  $([IO.Path]::GetFileName($output))`n")
if ($MsixOnly) {
    Write-Output "Unsigned MSIX for Microsoft Store: $output"
    exit 0
}
$portable = Join-Path $outDir "shiori-$($pkg.version)-$Architecture"
New-Item -ItemType Directory -Path $portable -Force | Out-Null
foreach ($file in @('shiori-markdown.exe', 'THIRD-PARTY-JAVASCRIPT-LICENSES.md', 'THIRD-PARTY-RUST-LICENSES.txt', 'PRIVACY.md')) {
    Copy-Item -LiteralPath (Join-Path $stage $file) -Destination (Join-Path $portable $file) -Force
}
if (Test-Path -LiteralPath (Join-Path $stage 'third-party-sources')) {
    New-Item -ItemType Directory -Path (Join-Path $portable 'third-party-sources') -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $stage 'third-party-sources') -File | Copy-Item -Destination (Join-Path $portable 'third-party-sources') -Force
}
[IO.File]::WriteAllText((Join-Path $portable 'HOW-TO-RUN.txt'), "shiori $($pkg.version) ($Architecture)`r`n`r`nExtract this folder, then run shiori-markdown.exe.`r`nRequires Windows 11 and Microsoft Edge WebView2 Runtime.`r`nThis is an unsigned development build; the Microsoft Store release is separate.`r`nKeep the included third-party notices and source archives when redistributing.`r`n")
$zip = Join-Path $outDir "shiori-$($pkg.version)-$Architecture.zip"
Compress-Archive -LiteralPath $portable -DestinationPath $zip -Force
$zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$zip.sha256", "$zipHash  $([IO.Path]::GetFileName($zip))`n")
Write-Output "Unsigned MSIX: $output"
Write-Output "Runnable folder: $portable"
Write-Output "Runnable ZIP: $zip"
Write-Output 'Microsoft Store signs submitted packages. Local installation requires a trusted development signature.'
