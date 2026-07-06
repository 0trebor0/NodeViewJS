$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$temporary = Join-Path $env:TEMP ("nodeviewjs-notification-native-" + [Guid]::NewGuid().ToString("N"))
$resultPath = Join-Path $temporary "result.json"
New-Item -ItemType Directory -Path $temporary | Out-Null

$previousResult = $env:NODEVIEW_NOTIFICATION_RESULT
$previousLocalAppData = $env:LOCALAPPDATA
$process = $null
$identityPath = $null
try {
  $env:NODEVIEW_NOTIFICATION_RESULT = $resultPath
  $env:LOCALAPPDATA = Join-Path $temporary "local-app-data"
  $process = Start-Process `
    -FilePath (Get-Command node.exe).Source `
    -ArgumentList (Join-Path $root "test\fixtures\notification-native.js") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru

  if (!$process.WaitForExit(20000)) {
    throw "Native notification test did not exit."
  }
  if ($process.ExitCode -ne 0) {
    throw "Native notification fixture exited with code $($process.ExitCode)."
  }
  if (!(Test-Path -LiteralPath $resultPath)) {
    throw "Native notification fixture did not write its result."
  }
  $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if ($result.notificationCount -ne 1) {
    throw "Windows did not accept the native notification: $(Get-Content -LiteralPath $resultPath -Raw)"
  }
  if ($result.notificationTransport -ne "windows-toast") {
    throw "Windows toast delivery was unavailable: $(Get-Content -LiteralPath $resultPath -Raw)"
  }
  $identityPath = "HKCU:\Software\Classes\AppUserModelId\" + $result.appUserModelId
  if (!(Test-Path -LiteralPath $identityPath)) {
    throw "Windows notification identity was not registered."
  }
  if ((Get-ItemPropertyValue -LiteralPath $identityPath -Name DisplayName) -ne
      "NodeViewJS Notification Integration Test") {
    throw "Windows notification identity has the wrong display name."
  }
} finally {
  if ($process -and !$process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  $env:NODEVIEW_NOTIFICATION_RESULT = $previousResult
  $env:LOCALAPPDATA = $previousLocalAppData
  if ($identityPath) {
    Remove-Item -LiteralPath $identityPath -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Native notification integration test passed."
