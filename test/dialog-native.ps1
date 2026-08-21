$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NodeViewDialogIntegration {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string windowName);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@

function Invoke-DialogCase {
  param([string]$Kind)

  $temporary = Join-Path $env:TEMP ("nodeviewjs-dialog-native-" + [Guid]::NewGuid().ToString("N"))
  $resultPath = Join-Path $temporary "result.json"
  New-Item -ItemType Directory -Path $temporary | Out-Null

  $previousResult = $env:NODEVIEW_DIALOG_RESULT
  $previousKind = $env:NODEVIEW_DIALOG_KIND
  $previousLocalAppData = $env:LOCALAPPDATA
  $process = $null
  try {
    $env:NODEVIEW_DIALOG_RESULT = $resultPath
    $env:NODEVIEW_DIALOG_KIND = $Kind
    $env:LOCALAPPDATA = Join-Path $temporary "local-app-data"
    $process = Start-Process `
      -FilePath (Get-Command node.exe).Source `
      -ArgumentList (Join-Path $root "test\fixtures\dialog-native.js") `
      -WorkingDirectory $root `
      -WindowStyle Hidden `
      -PassThru

    $window = [IntPtr]::Zero
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ($window -eq [IntPtr]::Zero -and !$process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 200
      $window = [NodeViewDialogIntegration]::FindWindow("NodeViewWindow", "NodeViewJS Dialog Integration Test")
    }
    if ($window -eq [IntPtr]::Zero) {
      throw "Native dialog test window did not open for the $Kind case."
    }

    # GW_ENABLEDPOPUP is the modal dialog this window owns, so the harness never
    # closes an unrelated window that happens to be a dialog.
    $dialog = [IntPtr]::Zero
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ($dialog -eq [IntPtr]::Zero -and !$process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 200
      $dialog = [NodeViewDialogIntegration]::GetWindow($window, 6)
    }
    if ($dialog -eq [IntPtr]::Zero) {
      throw "The $Kind dialog did not open."
    }

    # WM_CLOSE cancels the dialog, which is the path the runtime reports as no
    # selection rather than as an error. Confirming a selection instead would
    # need real keyboard input: the dialog ignores a posted IDOK, and accepts a
    # sent one only by cancelling, so it is not automated here. See
    # TASK_PROGRESS.md.
    [NodeViewDialogIntegration]::PostMessage($dialog, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    if (!$process.WaitForExit(15000)) {
      throw "The $Kind dialog test did not exit after the dialog was cancelled."
    }
    if ($process.ExitCode -ne 0) {
      throw "The $Kind dialog fixture exited with code $($process.ExitCode)."
    }
    if (!(Test-Path -LiteralPath $resultPath)) {
      throw "The $Kind dialog produced no result."
    }
    $raw = Get-Content -LiteralPath $resultPath -Raw
    $result = $raw | ConvertFrom-Json
    if ($result.error) {
      throw "The $Kind dialog failed: $raw"
    }
    if ($null -ne $result.selection) {
      throw "A cancelled $Kind dialog returned a selection: $raw"
    }
    Write-Host "Cancelled $Kind dialog reported no selection."
  } finally {
    if ($process -and !$process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    $env:NODEVIEW_DIALOG_RESULT = $previousResult
    $env:NODEVIEW_DIALOG_KIND = $previousKind
    $env:LOCALAPPDATA = $previousLocalAppData
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Invoke-DialogCase -Kind "directory"
Invoke-DialogCase -Kind "multiple"

Write-Host "Native dialog integration test passed."
