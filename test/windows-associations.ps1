$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$script = Join-Path $root "scripts\windows-associations.ps1"
$testId = "AssociationTest_" + [Guid]::NewGuid().ToString("N")
$testsRoot = "HKCU:\Software\NodeViewJS\Tests"
$registryBase = "$testsRoot\$testId"
$appName = "NodeView Association Test"
$registryId = "NodeViewAssociationTest"
$executable = Join-Path $env:TEMP "NodeView Association Test.exe"
$metadata = @{
  protocols = @(@{ scheme = "nodeview-association-test"; name = "NodeView Test URL" })
  fileAssociations = @(@{ extension = ".nvtest"; name = "NodeView test document" })
} | ConvertTo-Json -Compress -Depth 4
$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($metadata))

function Invoke-AssociationScript($Action) {
  & $script `
    -Action $Action `
    -AppName $appName `
    -RegistryId $registryId `
    -Executable $executable `
    -AssociationsBase64 $base64 `
    -RegistryBase $registryBase
}

try {
  Invoke-AssociationScript "Validate"
  Invoke-AssociationScript "Register"

  $command = '"' + [IO.Path]::GetFullPath($executable) + '" "%1"'
  $protocolRoot = Join-Path $registryBase "Classes\nodeview-association-test"
  $protocolCommand = Join-Path $protocolRoot "shell\open\command"
  if ((Get-Item -LiteralPath $protocolCommand).GetValue("") -ne $command) {
    throw "Protocol command was not registered correctly."
  }
  if ($null -eq (Get-Item -LiteralPath $protocolRoot).GetValue("URL Protocol")) {
    throw "Protocol URL marker was not registered."
  }

  $progId = "$registryId.File.nvtest"
  $progIdRoot = Join-Path $registryBase "Classes\$progId"
  if ((Get-Item -LiteralPath (Join-Path $progIdRoot "shell\open\command")).GetValue("") -ne $command) {
    throw "File association command was not registered correctly."
  }
  if ((Get-ItemPropertyValue -LiteralPath (Join-Path $registryBase "$registryId\Capabilities\FileAssociations") -Name ".nvtest") -ne $progId) {
    throw "File association capability was not registered."
  }

  Invoke-AssociationScript "Unregister"
  if ((Test-Path -LiteralPath $protocolRoot) -or (Test-Path -LiteralPath $progIdRoot)) {
    throw "Association keys remained after unregistration."
  }

  $emptyMetadata = @{ protocols = @(); fileAssociations = @() } | ConvertTo-Json -Compress
  $emptyBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($emptyMetadata))
  & $script `
    -Action Unregister `
    -AppName "Empty Association Test" `
    -RegistryId "EmptyAssociationTest" `
    -Executable (Join-Path $env:TEMP "Empty Association Test.exe") `
    -AssociationsBase64 $emptyBase64 `
    -RegistryBase $registryBase

  $conflictRoot = Join-Path $registryBase "Classes\nodeview-association-test\shell\open\command"
  New-Item -Path $conflictRoot -Force | Out-Null
  Set-Item -LiteralPath $conflictRoot -Value '"C:\OtherApp.exe" "%1"'
  try {
    Invoke-AssociationScript "Validate"
    throw "Conflicting protocol registration was not rejected."
  } catch {
    if ($_.Exception.Message -notmatch "already registered by another application") {
      throw
    }
  }
} finally {
  Remove-Item -LiteralPath $registryBase -Recurse -Force -ErrorAction SilentlyContinue
  if ((Test-Path -LiteralPath $testsRoot) -and
      @((Get-ChildItem -LiteralPath $testsRoot -ErrorAction SilentlyContinue)).Count -eq 0) {
    Remove-Item -LiteralPath $testsRoot -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Windows association registry test passed."
