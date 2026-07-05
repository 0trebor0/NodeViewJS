$ErrorActionPreference = "Stop"

$version = "1.0.3800.47"
$packageName = "Microsoft.Web.WebView2.$version"
$packageDirectory = Join-Path $PSScriptRoot "..\vendor\webview2\$packageName"
$headerPath = Join-Path $packageDirectory "build\native\include\WebView2.h"

if (Test-Path $headerPath) {
  exit 0
}

$archivePath = Join-Path $env:TEMP "$packageName.zip"
$packageUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$version/microsoft.web.webview2.$version.nupkg"

New-Item -ItemType Directory -Force -Path (Split-Path $packageDirectory) | Out-Null
Invoke-WebRequest -Uri $packageUrl -OutFile $archivePath
Expand-Archive -Path $archivePath -DestinationPath $packageDirectory -Force
Remove-Item -LiteralPath $archivePath -Force
