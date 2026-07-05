$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$temporary = Join-Path $env:TEMP ("nodeviewjs-taskbar-native-" + [Guid]::NewGuid().ToString("N"))
$resultPath = Join-Path $temporary "result.json"
$iconPath = Join-Path $temporary "overlay.ico"
New-Item -ItemType Directory -Path $temporary | Out-Null

$previousResult = $env:NODEVIEW_TASKBAR_RESULT
$previousIcon = $env:NODEVIEW_TASKBAR_ICON
$previousLocalAppData = $env:LOCALAPPDATA
try {
  Add-Type -AssemblyName System.Drawing
  $nodePath = (Get-Command node.exe).Source
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($nodePath)
  $stream = [System.IO.File]::Create($iconPath)
  try { $icon.Save($stream) } finally { $stream.Dispose(); $icon.Dispose() }

  $env:NODEVIEW_TASKBAR_RESULT = $resultPath
  $env:NODEVIEW_TASKBAR_ICON = $iconPath
  $env:LOCALAPPDATA = Join-Path $temporary "local-app-data"
  $process = Start-Process `
    -FilePath $nodePath `
    -ArgumentList (Join-Path $root "test\fixtures\taskbar-native.js") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru

  if (!$process.WaitForExit(20000)) {
    throw "Native taskbar test did not exit."
  }
  if ($process.ExitCode -ne 0) {
    throw "Native taskbar fixture exited with code $($process.ExitCode)."
  }
  if (!(Test-Path -LiteralPath $resultPath)) {
    throw "Native taskbar fixture did not write its result."
  }
  $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if ($result.progressState -ne "paused" -or $result.progressValue -ne 0.5 -or !$result.hasOverlay) {
    throw "Unexpected native taskbar state: $(Get-Content -LiteralPath $resultPath -Raw)"
  }
} finally {
  if ($process -and !$process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  $env:NODEVIEW_TASKBAR_RESULT = $previousResult
  $env:NODEVIEW_TASKBAR_ICON = $previousIcon
  $env:LOCALAPPDATA = $previousLocalAppData
  Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Native taskbar integration test passed."
