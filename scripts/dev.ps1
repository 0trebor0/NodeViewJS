$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$env:NODEVIEW_DEVTOOLS = "1"
$env:NODEVIEW_DEV_WATCH = "1"

& node (Join-Path $root "examples\basic\app.js")
