$ErrorActionPreference = "Stop"

function Invoke-Checked($Command, $Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

Invoke-Checked powershell @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "setup-webview2.ps1"))
Invoke-Checked node @((Join-Path $PSScriptRoot "generate-bridge-header.js"))
Invoke-Checked node @((Join-Path $PSScriptRoot "generate-launcher-resource.js"))
