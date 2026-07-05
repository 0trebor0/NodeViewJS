$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$temporary = Join-Path $env:TEMP ("nodeviewjs-menu-native-" + [Guid]::NewGuid().ToString("N"))
$resultPath = Join-Path $temporary "result.json"
New-Item -ItemType Directory -Path $temporary | Out-Null

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NodeViewMenuIntegration {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string windowName);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@

$previousResult = $env:NODEVIEW_MENU_RESULT
$previousLocalAppData = $env:LOCALAPPDATA
$process = $null
try {
  $env:NODEVIEW_MENU_RESULT = $resultPath
  $env:LOCALAPPDATA = Join-Path $temporary "local-app-data"
  $process = Start-Process `
    -FilePath (Get-Command node.exe).Source `
    -ArgumentList (Join-Path $root "test\fixtures\menu-native.js") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru

  $window = [IntPtr]::Zero
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ($window -eq [IntPtr]::Zero -and !$process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
    $window = [NodeViewMenuIntegration]::FindWindow("NodeViewWindow", "NodeViewJS Menu Integration Test")
  }
  if ($window -eq [IntPtr]::Zero) {
    throw "Native menu test window did not open."
  }

  # The first generated application-menu command occupies the reserved ID 2000.
  [NodeViewMenuIntegration]::PostMessage($window, 0x0111, [IntPtr]2000, [IntPtr]::Zero) | Out-Null
  if (!$process.WaitForExit(10000)) {
    throw "Native menu test did not exit after command dispatch."
  }
  if ($process.ExitCode -ne 0) {
    throw "Native menu fixture exited with code $($process.ExitCode)."
  }
  if (!(Test-Path -LiteralPath $resultPath)) {
    throw "Native menu command did not reach the Node event handler."
  }
  $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
  if ($result.id -ne "test.checkbox" -or $result.checked -ne $true) {
    throw "Unexpected native menu event: $(Get-Content -LiteralPath $resultPath -Raw)"
  }
} finally {
  if ($process -and !$process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  $env:NODEVIEW_MENU_RESULT = $previousResult
  $env:LOCALAPPDATA = $previousLocalAppData
  Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Native menu integration test passed."
