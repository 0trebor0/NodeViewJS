$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
  throw "Could not find the Visual Studio installer discovery tool."
}
$installationPath = (& $vswhere `
  -latest `
  -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
  -property installationPath | Select-Object -First 1)
if (-not $installationPath) {
  throw "Could not find a Visual Studio installation with the x64 C++ build tools."
}
$toolsRoot = Join-Path $installationPath "VC\Tools\MSVC"
$dumpbin = Get-ChildItem $toolsRoot -Filter dumpbin.exe -Recurse |
  Where-Object { $_.FullName -match 'Hostx64\\x64' } |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $dumpbin) {
  throw "Could not find the Visual Studio x64 dumpbin.exe tool."
}

$requiredFlags = @(
  "Dynamic base",
  "NX compatible",
  "Control Flow Guard",
  "CET compatible"
)
$binaries = @(
  (Join-Path $root "build\nodeview\nodeview.node"),
  (Join-Path $root "build\nodeview\nodeview_launcher.exe")
)

foreach ($binary in $binaries) {
  if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
    throw "Native security build output is missing: $binary"
  }
  $headers = (& $dumpbin /headers $binary | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect PE headers for $binary"
  }
  foreach ($flag in $requiredFlags) {
    if ($headers -notmatch [regex]::Escape($flag)) {
      throw "$binary is missing the required PE hardening flag: $flag"
    }
  }
}

Write-Host "Windows PE hardening test passed."
