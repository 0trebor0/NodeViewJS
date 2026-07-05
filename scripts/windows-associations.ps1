param(
  [ValidateSet("Validate", "Register", "Unregister")]
  [string]$Action,
  [string]$AppName,
  [string]$RegistryId,
  [string]$Executable,
  [string]$AssociationsBase64,
  [string]$RegistryBase = "HKCU:\Software"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AppName) -or
    [string]::IsNullOrWhiteSpace($RegistryId) -or
    [string]::IsNullOrWhiteSpace($Executable) -or
    [string]::IsNullOrWhiteSpace($AssociationsBase64)) {
  throw "Association registration requires app name, registry id, executable, and metadata."
}

$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($AssociationsBase64))
$associations = $json | ConvertFrom-Json
$protocols = @($associations.protocols)
$fileAssociations = @($associations.fileAssociations)
$classesRoot = Join-Path $RegistryBase "Classes"
$registeredApplications = Join-Path $RegistryBase "RegisteredApplications"
$capabilitiesRoot = Join-Path $RegistryBase ("$RegistryId\Capabilities")
$fileCapabilities = Join-Path $capabilitiesRoot "FileAssociations"
$appExecutable = [IO.Path]::GetFullPath($Executable)
$openCommand = '"' + $appExecutable + '" "%1"'

function Get-DefaultRegistryValue($Path) {
  if (!(Test-Path -LiteralPath $Path)) {
    return $null
  }
  return (Get-Item -LiteralPath $Path).GetValue("")
}

function Get-FileProgId($Extension) {
  return "$RegistryId.File." + ([string]$Extension).Substring(1).Replace("-", "_")
}

function Assert-AvailableRegistration($RootPath, $Label) {
  if (!(Test-Path -LiteralPath $RootPath)) {
    return
  }
  $registeredCommand = Get-DefaultRegistryValue (Join-Path $RootPath "shell\open\command")
  if ($registeredCommand -ne $openCommand) {
    throw "$Label is already registered by another application."
  }
}

function Notify-AssociationChanged {
  if ($RegistryBase -ne "HKCU:\Software") {
    return
  }
  if (-not ("NodeViewAssociationNotifications" -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NodeViewAssociationNotifications {
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
  }
  [NodeViewAssociationNotifications]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
}

foreach ($protocol in $protocols) {
  Assert-AvailableRegistration (Join-Path $classesRoot ([string]$protocol.scheme)) "Protocol '$($protocol.scheme)'"
}
foreach ($association in $fileAssociations) {
  $progId = Get-FileProgId ([string]$association.extension)
  Assert-AvailableRegistration (Join-Path $classesRoot $progId) "File type '$($association.extension)'"
}

if ($Action -eq "Validate") {
  return
}

if ($Action -eq "Register") {
  foreach ($protocol in $protocols) {
    $protocolRoot = Join-Path $classesRoot ([string]$protocol.scheme)
    $commandRoot = Join-Path $protocolRoot "shell\open\command"
    New-Item -Path $commandRoot -Force | Out-Null
    Set-Item -LiteralPath $protocolRoot -Value ("URL:" + [string]$protocol.name)
    New-ItemProperty -LiteralPath $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
    Set-Item -LiteralPath $commandRoot -Value $openCommand
  }

  if ($fileAssociations.Count -gt 0) {
    New-Item -Path $fileCapabilities -Force | Out-Null
    Set-ItemProperty -LiteralPath $capabilitiesRoot -Name "ApplicationName" -Value $AppName
    Set-ItemProperty -LiteralPath $capabilitiesRoot -Name "ApplicationDescription" -Value ("Open supported files with " + $AppName)
    New-Item -Path $registeredApplications -Force | Out-Null
    Set-ItemProperty -LiteralPath $registeredApplications -Name $RegistryId -Value ("Software\$RegistryId\Capabilities")
  }

  foreach ($association in $fileAssociations) {
    $extension = [string]$association.extension
    $progId = Get-FileProgId $extension
    $progIdRoot = Join-Path $classesRoot $progId
    $commandRoot = Join-Path $progIdRoot "shell\open\command"
    $openWithRoot = Join-Path (Join-Path $classesRoot $extension) "OpenWithProgids"
    New-Item -Path $commandRoot -Force | Out-Null
    Set-Item -LiteralPath $progIdRoot -Value ([string]$association.name)
    Set-Item -LiteralPath $commandRoot -Value $openCommand
    New-Item -Path $openWithRoot -Force | Out-Null
    New-ItemProperty -LiteralPath $openWithRoot -Name $progId -Value "" -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $fileCapabilities -Name $extension -Value $progId -PropertyType String -Force | Out-Null
  }
  Notify-AssociationChanged
  return
}

foreach ($protocol in $protocols) {
  $protocolRoot = Join-Path $classesRoot ([string]$protocol.scheme)
  if ((Get-DefaultRegistryValue (Join-Path $protocolRoot "shell\open\command")) -eq $openCommand) {
    Remove-Item -LiteralPath $protocolRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

foreach ($association in $fileAssociations) {
  $extension = [string]$association.extension
  $progId = Get-FileProgId $extension
  $progIdRoot = Join-Path $classesRoot $progId
  if ((Get-DefaultRegistryValue (Join-Path $progIdRoot "shell\open\command")) -eq $openCommand) {
    Remove-Item -LiteralPath $progIdRoot -Recurse -Force -ErrorAction SilentlyContinue
    $openWithRoot = Join-Path (Join-Path $classesRoot $extension) "OpenWithProgids"
    Remove-ItemProperty -LiteralPath $openWithRoot -Name $progId -Force -ErrorAction SilentlyContinue
  }
}

$registeredValue = if (Test-Path -LiteralPath $registeredApplications) {
  (Get-Item -LiteralPath $registeredApplications).GetValue($RegistryId)
} else {
  $null
}
if ($registeredValue -eq "Software\$RegistryId\Capabilities") {
  Remove-ItemProperty -LiteralPath $registeredApplications -Name $RegistryId -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $capabilitiesRoot -Recurse -Force -ErrorAction SilentlyContinue
}
Notify-AssociationChanged
