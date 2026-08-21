$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NodeViewShortcutIntegration {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string windowName);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@

function Invoke-ShortcutCase {
  param([string]$Case)

  $temporary = Join-Path $env:TEMP ("nodeviewjs-shortcut-native-" + [Guid]::NewGuid().ToString("N"))
  $resultPath = Join-Path $temporary "result.json"
  New-Item -ItemType Directory -Path $temporary | Out-Null

  $previousResult = $env:NODEVIEW_SHORTCUT_RESULT
  $previousCase = $env:NODEVIEW_SHORTCUT_CASE
  $previousLocalAppData = $env:LOCALAPPDATA
  $process = $null
  try {
    $env:NODEVIEW_SHORTCUT_RESULT = $resultPath
    $env:NODEVIEW_SHORTCUT_CASE = $Case
    $env:LOCALAPPDATA = Join-Path $temporary "local-app-data"
    $process = Start-Process `
      -FilePath (Get-Command node.exe).Source `
      -ArgumentList (Join-Path $root "test\fixtures\shortcut-native.js") `
      -WorkingDirectory $root `
      -WindowStyle Hidden `
      -PassThru

    $window = [IntPtr]::Zero
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ($window -eq [IntPtr]::Zero -and !$process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 200
      $window = [NodeViewShortcutIntegration]::FindWindow("NodeViewWindow", "NodeViewJS Shortcut Integration Test")
    }
    if ($window -eq [IntPtr]::Zero) {
      throw "Native shortcut test window did not open for the $Case case."
    }

    # WM_KEYDOWN for F9. The runtime message pump translates it through the
    # window accelerator table, so this proves the registration, not just the
    # WM_COMMAND routing a posted command id would exercise.
    [NodeViewShortcutIntegration]::PostMessage($window, 0x0100, [IntPtr]0x78, [IntPtr]::Zero) | Out-Null
    if (!$process.WaitForExit(10000)) {
      throw "The $Case shortcut case did not exit after the accelerator was pressed."
    }
    if ($process.ExitCode -ne 0) {
      throw "The $Case shortcut fixture exited with code $($process.ExitCode)."
    }
    if (!(Test-Path -LiteralPath $resultPath)) {
      throw "The $Case shortcut did not reach the Node event handler."
    }
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    if ($result.id -ne "test.shortcut") {
      throw "Unexpected native shortcut event: $(Get-Content -LiteralPath $resultPath -Raw)"
    }
    Write-Host "Shortcut dispatched for the $Case case."
  } finally {
    if ($process -and !$process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    $env:NODEVIEW_SHORTCUT_RESULT = $previousResult
    $env:NODEVIEW_SHORTCUT_CASE = $previousCase
    $env:LOCALAPPDATA = $previousLocalAppData
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Invoke-ShortcutCase -Case "plain"
Invoke-ShortcutCase -Case "menu-cleared"

Write-Host "Native shortcut integration test passed."
