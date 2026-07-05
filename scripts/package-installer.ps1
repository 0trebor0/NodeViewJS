param(
  [string]$ProjectRoot,
  [switch]$KeepStaging
)

$ErrorActionPreference = "Stop"

$runtimeRoot = Split-Path $PSScriptRoot -Parent
$root = if ($ProjectRoot) { (Resolve-Path $ProjectRoot).Path } else { $runtimeRoot }
$packageJson = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$config = $packageJson.nodeviewjs
$metadata = $config.metadata
$appName = if ($config.name) { [string]$config.name } else { "NodeViewDemo" }
$version = if ($metadata.version) { [string]$metadata.version } else { [string]$packageJson.version }
$publisher = if ($metadata.companyName) { [string]$metadata.companyName } else { "NodeViewJS" }
if ($appName -notmatch '^[A-Za-z0-9][A-Za-z0-9._ -]*$' -or
    $appName -match '[. ]$' -or
    $appName -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') {
  throw "nodeviewjs.name contains characters that are unsafe for an installer path."
}
if ($version -notmatch '^[A-Za-z0-9][A-Za-z0-9._+-]*$') {
  throw "Package version contains characters that are unsafe for an installer filename."
}
$registryId = ($appName -replace '[^a-zA-Z0-9._-]', '_')
$associationJson = (& node (Join-Path $runtimeRoot "scripts\normalize-associations.js") --project-root $root | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or !$associationJson) {
  throw "Could not validate nodeviewjs protocols and fileAssociations."
}
$associationBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($associationJson))
$portableRoot = Join-Path $root "build\portable\$appName"
$installerRoot = Join-Path $root "build\installer"
$staging = Join-Path $installerRoot ".staging-$registryId"
$output = Join-Path $installerRoot "$appName-$version-setup.exe"
$iexpress = Join-Path $env:WINDIR "System32\iexpress.exe"

if (!(Test-Path $iexpress)) {
  throw "Windows IExpress was not found at $iexpress."
}

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "package-portable.ps1") -ProjectRoot $root
if ($LASTEXITCODE -ne 0) {
  throw "Portable packaging failed before installer generation."
}

function Convert-ToPowerShellLiteral($Value) {
  return "'" + ([string]$Value).Replace("'", "''") + "'"
}

function Find-SignTool {
  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  $kitRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
  return Get-ChildItem $kitRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
      Sort-Object FullName -Descending |
      Select-Object -First 1 -ExpandProperty FullName
}

function Invoke-CodeSigning($FilePath) {
  $certificate = $env:NODEVIEW_SIGN_CERTIFICATE
  $thumbprint = $env:NODEVIEW_SIGN_THUMBPRINT
  if (!$certificate -and !$thumbprint) {
    return
  }

  $signTool = Find-SignTool
  if (!$signTool) {
    throw "Signing was requested, but signtool.exe was not found."
  }

  $arguments = @("sign", "/fd", "SHA256")
  if ($certificate) {
    $arguments += @("/f", (Resolve-Path $certificate).Path)
    if ($env:NODEVIEW_SIGN_PASSWORD) {
      $arguments += @("/p", $env:NODEVIEW_SIGN_PASSWORD)
    }
  } else {
    $arguments += @("/sha1", $thumbprint)
  }
  if ($env:NODEVIEW_SIGN_TIMESTAMP_URL) {
    $arguments += @("/tr", $env:NODEVIEW_SIGN_TIMESTAMP_URL, "/td", "SHA256")
  }
  $arguments += $FilePath

  & $signTool @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Code signing failed for $FilePath."
  }
}

function Wait-ForInstallerOutput($FilePath, $TimeoutSeconds = 120) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastLength = -1
  $stableChecks = 0

  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path $FilePath) {
      $length = (Get-Item -LiteralPath $FilePath).Length
      if ($length -gt 0 -and $length -eq $lastLength) {
        $stableChecks++
        if ($stableChecks -ge 2) {
          return
        }
      } else {
        $stableChecks = 0
        $lastLength = $length
      }
    }
    Start-Sleep -Milliseconds 500
  }

  throw "IExpress did not finish creating the Windows installer within $TimeoutSeconds seconds."
}

New-Item -ItemType Directory -Force -Path $installerRoot | Out-Null
Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $staging | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "windows-associations.ps1") -Destination (Join-Path $staging "windows-associations.ps1") -Force

$portableExe = Join-Path $portableRoot "$appName.exe"
Invoke-CodeSigning $portableExe

$payload = Join-Path $staging "payload.zip"
Compress-Archive -Path (Join-Path $portableRoot "*") -DestinationPath $payload -CompressionLevel Optimal

$installTemplate = @'
$ErrorActionPreference = "Stop"
$appName = __APP_NAME__
$version = __VERSION__
$publisher = __PUBLISHER__
$registryId = __REGISTRY_ID__
$associationsBase64 = __ASSOCIATIONS_BASE64__
$installRoot = Join-Path $env:LOCALAPPDATA ("Programs\" + $registryId)
$pendingRoot = "$installRoot.update-pending"
$backupRoot = "$installRoot.update-backup"
$archive = Join-Path $PSScriptRoot "payload.zip"
$shortcutPath = Join-Path $env:APPDATA ("Microsoft\Windows\Start Menu\Programs\" + $appName + ".lnk")
$registryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\" + $registryId
$associationScript = Join-Path $PSScriptRoot "windows-associations.ps1"
$appExecutable = Join-Path $installRoot ($appName + ".exe")

& $associationScript -Action Validate -AppName $appName -RegistryId $registryId -Executable $appExecutable -AssociationsBase64 $associationsBase64

Remove-Item -LiteralPath $pendingRoot -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $backupRoot) {
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $backupRoot -Destination $installRoot -Force
}

$hadInstall = Test-Path $installRoot
$hadShortcut = Test-Path $shortcutPath
$hadRegistration = Test-Path $registryPath
$previousRegistration = if ($hadRegistration) { Get-ItemProperty $registryPath } else { $null }
$replacementActivated = $false
$associationsStarted = $false

try {
  New-Item -ItemType Directory -Force -Path $pendingRoot | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $pendingRoot -Force
  Copy-Item (Join-Path $PSScriptRoot "uninstall.ps1") (Join-Path $pendingRoot "uninstall.ps1") -Force
  Copy-Item $associationScript (Join-Path $pendingRoot "windows-associations.ps1") -Force

  if ($hadInstall) {
    Move-Item -LiteralPath $installRoot -Destination $backupRoot
  }
  Move-Item -LiteralPath $pendingRoot -Destination $installRoot
  $replacementActivated = $true

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = Join-Path $installRoot ($appName + ".exe")
  $shortcut.WorkingDirectory = $installRoot
  $shortcut.IconLocation = $shortcut.TargetPath
  $shortcut.Save()

  $uninstallScript = Join-Path $installRoot "uninstall.ps1"
  $uninstallCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $uninstallScript + '"'
  New-Item -Path $registryPath -Force | Out-Null
  Set-ItemProperty -Path $registryPath -Name DisplayName -Value $appName
  Set-ItemProperty -Path $registryPath -Name DisplayVersion -Value $version
  Set-ItemProperty -Path $registryPath -Name Publisher -Value $publisher
  Set-ItemProperty -Path $registryPath -Name InstallLocation -Value $installRoot
  Set-ItemProperty -Path $registryPath -Name DisplayIcon -Value (Join-Path $installRoot ($appName + ".exe"))
  Set-ItemProperty -Path $registryPath -Name UninstallString -Value $uninstallCommand
  Set-ItemProperty -Path $registryPath -Name NoModify -Value 1 -Type DWord
  Set-ItemProperty -Path $registryPath -Name NoRepair -Value 1 -Type DWord

  $associationsStarted = $true
  & (Join-Path $installRoot "windows-associations.ps1") -Action Register -AppName $appName -RegistryId $registryId -Executable $appExecutable -AssociationsBase64 $associationsBase64

  Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  if ($associationsStarted) {
    try {
      & $associationScript -Action Unregister -AppName $appName -RegistryId $registryId -Executable $appExecutable -AssociationsBase64 $associationsBase64
    } catch {}
  }
  Remove-Item -LiteralPath $pendingRoot -Recurse -Force -ErrorAction SilentlyContinue
  if ($replacementActivated) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $backupRoot) {
    Move-Item -LiteralPath $backupRoot -Destination $installRoot -Force
  }

  if ($hadRegistration) {
    New-Item -Path $registryPath -Force | Out-Null
    foreach ($name in @("DisplayName", "DisplayVersion", "Publisher", "InstallLocation", "DisplayIcon", "UninstallString", "NoModify", "NoRepair")) {
      if ($null -ne $previousRegistration.$name) {
        Set-ItemProperty -Path $registryPath -Name $name -Value $previousRegistration.$name
      }
    }
  } else {
    Remove-Item -LiteralPath $registryPath -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (!$hadShortcut) {
    Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
  }
  throw
}
'@

$uninstallTemplate = @'
$ErrorActionPreference = "SilentlyContinue"
$appName = __APP_NAME__
$registryId = __REGISTRY_ID__
$associationsBase64 = __ASSOCIATIONS_BASE64__
$installRoot = $PSScriptRoot
$appExecutable = Join-Path $installRoot ($appName + ".exe")
$associationScript = Join-Path $installRoot "windows-associations.ps1"

Get-Process -Name $appName -ErrorAction SilentlyContinue | Stop-Process -Force
if (Test-Path -LiteralPath $associationScript) {
  & $associationScript -Action Unregister -AppName $appName -RegistryId $registryId -Executable $appExecutable -AssociationsBase64 $associationsBase64
}
Remove-Item -LiteralPath (Join-Path $env:APPDATA ("Microsoft\Windows\Start Menu\Programs\" + $appName + ".lnk")) -Force
Remove-Item -LiteralPath ("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\" + $registryId) -Recurse -Force

$quotedRoot = "'" + $installRoot.Replace("'", "''") + "'"
$cleanup = "Start-Sleep -Milliseconds 500; Remove-Item -LiteralPath $quotedRoot -Recurse -Force"
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cleanup
)
'@

$replacements = @{
  "__APP_NAME__" = Convert-ToPowerShellLiteral $appName
  "__VERSION__" = Convert-ToPowerShellLiteral $version
  "__PUBLISHER__" = Convert-ToPowerShellLiteral $publisher
  "__REGISTRY_ID__" = Convert-ToPowerShellLiteral $registryId
  "__ASSOCIATIONS_BASE64__" = Convert-ToPowerShellLiteral $associationBase64
}
foreach ($key in $replacements.Keys) {
  $installTemplate = $installTemplate.Replace($key, $replacements[$key])
  $uninstallTemplate = $uninstallTemplate.Replace($key, $replacements[$key])
}

$installScript = Join-Path $staging "install.ps1"
$uninstallScript = Join-Path $staging "uninstall.ps1"
Set-Content -LiteralPath $installScript -Value $installTemplate -Encoding UTF8
Set-Content -LiteralPath $uninstallScript -Value $uninstallTemplate -Encoding UTF8

$sed = Join-Path $staging "installer.sed"
$sedContent = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=$appName was installed successfully.
TargetName=$output
FriendlyName=$appName Installer
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
UserQuietInstCmd=powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
FILE0=payload.zip
FILE1=install.ps1
FILE2=uninstall.ps1
FILE3=windows-associations.ps1
[SourceFiles]
SourceFiles0=$staging\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=
"@
Set-Content -LiteralPath $sed -Value $sedContent -Encoding ASCII

Remove-Item -LiteralPath $output -Force -ErrorAction SilentlyContinue
& $iexpress /N /Q $sed
Wait-ForInstallerOutput $output

Invoke-CodeSigning $output
if (!$KeepStaging) {
  Remove-Item -LiteralPath $staging -Recurse -Force
}
Write-Host "Created installer: $output"
exit 0
