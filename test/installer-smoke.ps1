param(
  [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"

$runtimeRoot = Split-Path $PSScriptRoot -Parent
$root = if ($ProjectRoot) { (Resolve-Path $ProjectRoot).Path } else { $runtimeRoot }
$packageJson = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$config = $packageJson.nodeviewjs
$metadata = $config.metadata
$appName = if ($config.name) { [string]$config.name } else { "NodeViewDemo" }
$version = if ($metadata.version) { [string]$metadata.version } else { [string]$packageJson.version }
$registryId = ($appName -replace '[^a-zA-Z0-9._-]', '_')
$setup = Join-Path $root "build\installer\$appName-$version-setup.exe"
$installRoot = Join-Path $env:LOCALAPPDATA "Programs\$registryId"
$installedExe = Join-Path $installRoot "$appName.exe"
$shortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$appName.lnk"
$registry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$registryId"
$staging = Join-Path $root "build\installer\.staging-$registryId"
$pendingRoot = "$installRoot.update-pending"
$backupRoot = "$installRoot.update-backup"

if ((Test-Path $installRoot) -or (Test-Path $shortcut) -or (Test-Path $registry)) {
  throw "A pre-existing $appName installation was found; refusing to overwrite it during the smoke test."
}

& powershell -ExecutionPolicy Bypass -File (Join-Path $runtimeRoot "scripts\package-installer.ps1") -ProjectRoot $root -KeepStaging
if ($LASTEXITCODE -ne 0) {
  throw "Installer packaging failed before the smoke test."
}

$setupProcess = Start-Process -FilePath $setup -ArgumentList "/Q:A", "/R:N" -PassThru -Wait
if ($setupProcess.ExitCode -ne 0) {
  throw "Installer exited with code $($setupProcess.ExitCode)."
}

$deadline = [DateTime]::UtcNow.AddSeconds(30)
while (!(Test-Path $installedExe) -and [DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 250
}

if (!(Test-Path $installedExe)) {
  throw "Installer did not create the installed executable."
}
if (!(Test-Path $shortcut)) {
  throw "Installer did not create the Start Menu shortcut."
}
if (!(Test-Path $registry)) {
  throw "Installer did not create the uninstall registry entry."
}
if (!(Test-Path (Join-Path $installRoot "windows-associations.ps1"))) {
  throw "Installer did not include the association unregistration helper."
}

$registration = Get-ItemProperty $registry
if ($registration.DisplayVersion -ne $version) {
  throw "Unexpected installed version: $($registration.DisplayVersion)"
}
if ($registration.InstallLocation -ne $installRoot) {
  throw "Unexpected install location: $($registration.InstallLocation)"
}

$replacementMarker = Join-Path $installRoot "old-version.marker"
Set-Content -LiteralPath $replacementMarker -Value "old"
$replacementProcess = Start-Process -FilePath $setup -ArgumentList "/Q:A", "/R:N" -PassThru -Wait
if ($replacementProcess.ExitCode -ne 0 -or (Test-Path $replacementMarker)) {
  throw "Installer did not replace an existing installation cleanly."
}

$rollbackMarker = Join-Path $installRoot "rollback.marker"
Set-Content -LiteralPath $rollbackMarker -Value "keep"
Set-Content -LiteralPath (Join-Path $staging "payload.zip") -Value "invalid update payload"
$rollbackError = Join-Path $staging "rollback-error.log"
$rollbackProcess = Start-Process -FilePath powershell.exe -ArgumentList @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $staging "install.ps1")
) -RedirectStandardError $rollbackError -PassThru -Wait
if ($rollbackProcess.ExitCode -eq 0) {
  throw "Corrupted update payload unexpectedly installed successfully."
}
if (!(Test-Path $rollbackMarker) -or !(Test-Path $installedExe)) {
  throw "Failed update did not preserve the previous installation."
}
if ((Get-ItemProperty $registry).DisplayVersion -ne $version) {
  throw "Failed update did not preserve the previous registration."
}

Move-Item -LiteralPath $installRoot -Destination $backupRoot
New-Item -ItemType Directory -Path $pendingRoot | Out-Null
Set-Content -LiteralPath (Join-Path $pendingRoot "partial.file") -Value "partial"
$recoveryProcess = Start-Process -FilePath powershell.exe -ArgumentList @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $staging "install.ps1")
) -RedirectStandardError (Join-Path $staging "recovery-error.log") -PassThru -Wait
if ($recoveryProcess.ExitCode -eq 0) {
  throw "Interrupted update recovery fixture unexpectedly installed successfully."
}
if (!(Test-Path $rollbackMarker) -or !(Test-Path $installedExe) -or
    (Test-Path $pendingRoot) -or (Test-Path $backupRoot)) {
  throw "Installer did not recover the previous installation after an interrupted transaction."
}

$appProcess = Start-Process -FilePath $installedExe -PassThru
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NodeViewInstallerSmoke {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string windowName);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
}
'@

$window = [IntPtr]::Zero
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ($window -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 250
  $window = [NodeViewInstallerSmoke]::FindWindow("NodeViewWindow", "NodeViewJS Media Loader")
}

if ($window -eq [IntPtr]::Zero) {
  Stop-Process -Id $appProcess.Id -Force -ErrorAction SilentlyContinue
  throw "Installed app did not open its native window."
}

[NodeViewInstallerSmoke]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
if (!$appProcess.WaitForExit(10000)) {
  Stop-Process -Id $appProcess.Id -Force
  throw "Installed launcher did not exit after the window closed."
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installRoot "uninstall.ps1")
$deadline = [DateTime]::UtcNow.AddSeconds(15)
while (((Test-Path $installRoot) -or (Test-Path $shortcut) -or (Test-Path $registry)) -and [DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 250
}

if (Test-Path $installRoot) {
  throw "Uninstaller did not remove the installation directory."
}
if (Test-Path $shortcut) {
  throw "Uninstaller did not remove the Start Menu shortcut."
}
if (Test-Path $registry) {
  throw "Uninstaller did not remove the uninstall registry entry."
}

Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Installer smoke test passed for $appName $version."
