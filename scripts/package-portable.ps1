param(
  [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"

$runtimeRoot = Split-Path $PSScriptRoot -Parent
$root = if ($ProjectRoot) { (Resolve-Path -LiteralPath $ProjectRoot).ProviderPath } else { $runtimeRoot }

$packageJsonPath = Join-Path $root "package.json"
if (!(Test-Path -LiteralPath $packageJsonPath)) {
  throw "package.json was not found at $packageJsonPath."
}

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$packageConfig = $packageJson.nodeviewjs

$appName = if ($packageConfig.name) { $packageConfig.name } else { "NodeViewDemo" }
$appId = if ($packageConfig.appId) { [string]$packageConfig.appId } else { [string]$packageJson.name }
$appVersion = if ($packageConfig.metadata.version) { [string]$packageConfig.metadata.version } else { [string]$packageJson.version }
$entry = if ($packageConfig.entry) { $packageConfig.entry } else { "examples\basic\app.js" }
$icon = $packageConfig.icon
$packageInputsScript = Join-Path $runtimeRoot "scripts\package-inputs.js"

& node $packageInputsScript --project-root $root
if ($LASTEXITCODE -ne 0) {
  throw "Package input validation failed."
}

$entryPath = if ([System.IO.Path]::IsPathRooted($entry)) {
  $entry
} else {
  Join-Path $root $entry
}

$iconPath = if (!$icon) {
  $null
} elseif ([System.IO.Path]::IsPathRooted($icon)) {
  $icon
} else {
  Join-Path $root $icon
}

$entryDirectory = Split-Path $entryPath -Parent
$output = Join-Path $root "build\portable\$appName"
$resources = Join-Path $output "resources"

$nodeExe = Join-Path $env:ProgramFiles "nodejs\node.exe"
$addon = Join-Path $runtimeRoot "build\nodeview\nodeview.node"
$launcher = Join-Path $runtimeRoot "build\nodeview\nodeview_launcher.exe"

if (!(Test-Path -LiteralPath $nodeExe)) {
  throw "Node.js runtime was not found at $nodeExe."
}

if ($env:NODEVIEW_SKIP_NATIVE_REBUILD -eq "1") {
  Write-Host "Reusing the staged native launcher for packaging verification."
}
else {
  Write-Host "Building the app-specific native launcher before packaging..."

  & powershell -ExecutionPolicy Bypass -File (Join-Path $runtimeRoot "scripts\build.ps1") -ProjectRoot $root

  if ($LASTEXITCODE -ne 0) {
    throw "Could not build the native runtime required for packaging."
  }
}

if (!(Test-Path -LiteralPath $addon) -or !(Test-Path -LiteralPath $launcher)) {
  throw "Native runtime build completed without the required addon and launcher files."
}

if (!(Test-Path -LiteralPath $entryPath)) {
  throw "App entry file was not found at $entryPath."
}

if ($iconPath -and !(Test-Path -LiteralPath $iconPath)) {
  throw "Configured icon file was not found at $iconPath."
}

$associationJson = (& node (Join-Path $runtimeRoot "scripts\normalize-associations.js") --project-root $root | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or !$associationJson) {
  throw "Could not validate nodeviewjs protocols and fileAssociations."
}
$associationConfig = $associationJson | ConvertFrom-Json

Remove-Item -Recurse -Force $output -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $output | Out-Null
New-Item -ItemType Directory -Force -Path $resources | Out-Null

$runtimeOutput = Join-Path $resources "runtime"
$appOutput = Join-Path $resources "app"
$nativeOutput = $runtimeOutput

New-Item -ItemType Directory -Force -Path $runtimeOutput | Out-Null
Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $runtimeOutput "node.exe") -Force

New-Item -ItemType Directory -Force -Path $appOutput | Out-Null

& node $packageInputsScript --project-root $root --destination $appOutput
if ($LASTEXITCODE -ne 0) {
  throw "Could not copy validated package inputs."
}

& node (Join-Path $runtimeRoot "scripts\embed-bridge-html.js") `
  --app-dir $appOutput `
  --bridge (Join-Path $runtimeRoot "runtime\bridge.js")
if ($LASTEXITCODE -ne 0) {
  throw "Could not embed the NodeViewJS bridge in packaged HTML files."
}

$appSource = Get-Content -LiteralPath $entryPath -Raw

$appSource = $appSource.Replace('require("../../runtime")', 'require("../runtime/nodeview")')
$appSource = $appSource.Replace('require("nodeviewjs")', 'require("../runtime/nodeview")')
$appSource = $appSource.Replace("require('nodeviewjs')", "require('../runtime/nodeview')")

$appIdLiteral = ConvertTo-Json $appId -Compress
$appVersionLiteral = ConvertTo-Json $appVersion -Compress
$protocolsJson = ConvertTo-Json @($associationConfig.protocols) -Compress
$fileAssociationsJson = ConvertTo-Json @($associationConfig.fileAssociations) -Compress
$protocolsLiteral = ConvertTo-Json $protocolsJson -Compress
$fileAssociationsLiteral = ConvertTo-Json $fileAssociationsJson -Compress
$appSource = "process.env.NODEVIEW_FILE_ASSOCIATIONS = $fileAssociationsLiteral;`r`n" + $appSource
$appSource = "process.env.NODEVIEW_PROTOCOLS = $protocolsLiteral;`r`n" + $appSource
$appSource = "process.env.NODEVIEW_APP_ID = $appIdLiteral;`r`nprocess.env.NODEVIEW_APP_VERSION = $appVersionLiteral;`r`n" + $appSource
$appSource = 'process.env.NODEVIEW_BRIDGE_EMBEDDED = "1";' + "`r`n" + $appSource

if ($icon) {
  $iconLiteral = ConvertTo-Json ([string]$icon) -Compress
  $appSource = "process.env.NODEVIEW_APP_ICON = require(""node:path"").join(__dirname, $iconLiteral);`r`n" + $appSource
}

Set-Content -LiteralPath (Join-Path $appOutput "app.js") -Value $appSource -NoNewline

$runtimeSource = Join-Path $runtimeRoot "runtime"
if (!(Test-Path -LiteralPath $runtimeSource)) {
  throw "Runtime source directory was not found at $runtimeSource."
}

& node (Join-Path $runtimeRoot "scripts\bundle-runtime.js") `
  --source $runtimeSource `
  --output (Join-Path $runtimeOutput "nodeview.js")
if ($LASTEXITCODE -ne 0) {
  throw "Could not bundle the NodeViewJS runtime for portable packaging."
}
Copy-Item -LiteralPath (Join-Path $runtimeSource "apply-update.ps1") -Destination (Join-Path $runtimeOutput "apply-update.ps1") -Force

New-Item -ItemType Directory -Force -Path $nativeOutput | Out-Null

Copy-Item -LiteralPath $addon -Destination (Join-Path $nativeOutput "nodeview.node") -Force
Copy-Item -LiteralPath $launcher -Destination (Join-Path $output "$appName.exe") -Force

$manifestHash = (& node (Join-Path $runtimeRoot "scripts\package-integrity.js") --resources $resources | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $manifestHash -notmatch '^[a-f0-9]{64}$') {
  throw "Could not generate the package integrity manifest."
}

& powershell -NoProfile -ExecutionPolicy Bypass -File `
  (Join-Path $runtimeRoot "scripts\embed-integrity-resource.ps1") `
  -Executable (Join-Path $output "$appName.exe") `
  -Manifest (Join-Path $resources "integrity.manifest")
if ($LASTEXITCODE -ne 0) {
  throw "Could not bind the integrity manifest to the packaged launcher."
}

Write-Host "Portable package created at:"
Write-Host $output
