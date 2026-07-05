param(
  [Parameter(Mandatory = $true)][int]$ParentProcessId,
  [int]$LauncherProcessId,
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$RestartExecutable,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedSha256,
  [Parameter(Mandatory = $true)][long]$ExpectedSize
)

$ErrorActionPreference = "Stop"
$logPath = "$InstallerPath.log"

function Write-UpdateLog($Message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

function Wait-ForProcessExit($ProcessId, $Label) {
  if (!$ProcessId) {
    return
  }
  try {
    Wait-Process -Id $ProcessId -Timeout 60 -ErrorAction Stop
  } catch {
    if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
      throw "$Label process $ProcessId did not exit before the update timeout."
    }
  }
}

try {
  Write-UpdateLog "Waiting for application processes to exit."
  Wait-ForProcessExit $ParentProcessId "Node"
  Wait-ForProcessExit $LauncherProcessId "Launcher"

  $installer = Get-Item -LiteralPath $InstallerPath
  if ($installer.Length -ne $ExpectedSize) {
    throw "Staged installer size changed after verification."
  }
  $actualSha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $ExpectedSha256) {
    throw "Staged installer SHA-256 changed after verification."
  }

  Write-UpdateLog "Starting verified installer."
  $installerProcess = Start-Process -FilePath $InstallerPath -ArgumentList "/Q:A", "/R:N" -PassThru -Wait
  if ($installerProcess.ExitCode -ne 0) {
    throw "Installer exited with code $($installerProcess.ExitCode)."
  }

  if (!(Test-Path -LiteralPath $RestartExecutable)) {
    throw "Updated application executable was not found: $RestartExecutable"
  }
  Write-UpdateLog "Update installed successfully; restarting application."
  Start-Process -FilePath $RestartExecutable
  Remove-Item -LiteralPath $InstallerPath -Force -ErrorAction SilentlyContinue
} catch {
  Write-UpdateLog "Update failed: $($_.Exception.Message)"
  exit 1
}

exit 0
