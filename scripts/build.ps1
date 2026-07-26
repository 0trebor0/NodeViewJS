param(
  [string]$ProjectRoot,
  [switch]$SecurityAnalysis
)

$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent

function Invoke-Checked($Command, $Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

Invoke-Checked node @((Join-Path $PSScriptRoot "check-native-prerequisites.js"))
Invoke-Checked powershell @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "setup-webview2.ps1"))
Invoke-Checked node @((Join-Path $PSScriptRoot "generate-bridge-header.js"))
$resourceArguments = @((Join-Path $PSScriptRoot "generate-launcher-resource.js"))
if ($ProjectRoot) {
  $resourceArguments += @("--project-root", (Resolve-Path $ProjectRoot).Path)
}
Invoke-Checked node $resourceArguments
$nodeGyp = & node -e "console.log(require.resolve('node-gyp/bin/node-gyp.js', { paths: [process.argv[1]] }))" $root
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
$gypArguments = @($nodeGyp, "rebuild", "--directory", (Join-Path $root "src-nodeview"))
if ($SecurityAnalysis) {
  $gypArguments += "--security_analysis=1"
}
Invoke-Checked node $gypArguments
Invoke-Checked powershell @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "stage-native-build.ps1"))
