$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$temporary = Join-Path $env:TEMP ("nodeviewjs-notification-native-" + [Guid]::NewGuid().ToString("N"))
$resultPath = Join-Path $temporary "result.json"
New-Item -ItemType Directory -Path $temporary | Out-Null

$previousResult = $env:NODEVIEW_NOTIFICATION_RESULT
$previousLocalAppData = $env:LOCALAPPDATA
$process = $null
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
} finally {
  if ($process -and !$process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  $env:NODEVIEW_NOTIFICATION_RESULT = $previousResult
  $env:LOCALAPPDATA = $previousLocalAppData
  Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Native notification integration test passed."
