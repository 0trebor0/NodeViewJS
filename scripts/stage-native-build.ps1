$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$source = Join-Path $root "src-nodeview\build\Release\nodeview.node"
$launcher = Join-Path $root "src-nodeview\build\Release\nodeview_launcher.exe"
$output = Join-Path $root "build\nodeview"

if (!(Test-Path $source)) {
  throw "Native build output was not found at $source."
}
if (!(Test-Path $launcher)) {
  throw "Native launcher output was not found at $launcher."
}

New-Item -ItemType Directory -Force -Path $output | Out-Null
Copy-Item $source (Join-Path $output "nodeview.node") -Force
Copy-Item $launcher (Join-Path $output "nodeview_launcher.exe") -Force
Remove-Item -LiteralPath (Join-Path $root "src-nodeview\build") -Recurse -Force
