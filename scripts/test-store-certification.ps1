param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [string]$ReportPath = 'test-results/store-preparation/wack/report.xml'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
$appcert = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/App Certification Kit/appcert.exe'
if (-not (Test-Path -LiteralPath $appcert)) {
    throw 'appcert.exe is unavailable. Use a Windows test PC with the App Certification Kit installed. The SDK installer did not install the WACK executables on the ARM64 preparation PC.'
}
$package = (Resolve-Path -LiteralPath $PackagePath).Path
if ([IO.Path]::GetExtension($package) -notin @('.msix', '.appx', '.msixbundle', '.appxbundle')) { throw 'Select an MSIX/AppX package or bundle.' }
$report = [IO.Path]::GetFullPath((Join-Path $projectRoot $ReportPath))
New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($report)) -Force | Out-Null
& $appcert reset
if ($LASTEXITCODE -ne 0) { throw 'WACK reset failed. Use an administrator terminal in an active user session.' }
& $appcert test -appxpackagepath $package -reportoutputpath $report
if ($LASTEXITCODE -ne 0) { throw "WACK returned exit code $LASTEXITCODE. Inspect the report and installation prerequisites." }
if (-not (Test-Path -LiteralPath $report)) { throw 'WACK did not produce a report.' }
Write-Output "Review all test results in: $report"
Write-Output 'A process exit code alone is not evidence that all certification tests passed.'
