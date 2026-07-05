$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$nodeGyp = Join-Path $root "node_modules\.bin\node-gyp.cmd"

& $nodeGyp clean --directory (Join-Path $root "src-nodeview")

Remove-Item -LiteralPath (Join-Path $root "build\nodeview") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $root "build\portable") -Recurse -Force -ErrorAction SilentlyContinue
