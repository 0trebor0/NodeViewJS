param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$Manifest
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class NodeViewIntegrityResource {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool UpdateResource(
      IntPtr update,
      IntPtr type,
      IntPtr name,
      ushort language,
      byte[] data,
      uint size);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool EndUpdateResource(IntPtr update, bool discard);

  public static void Embed(string executable, byte[] manifest) {
    IntPtr update = BeginUpdateResource(executable, false);
    if (update == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    bool committed = false;
    try {
      if (!UpdateResource(update, new IntPtr(10), new IntPtr(301), 0, manifest, (uint)manifest.Length)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      if (!EndUpdateResource(update, false)) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      committed = true;
    } finally {
      if (!committed) EndUpdateResource(update, true);
    }
  }
}
'@

$executablePath = (Resolve-Path -LiteralPath $Executable).ProviderPath
$manifestPath = (Resolve-Path -LiteralPath $Manifest).ProviderPath
$manifestBytes = [System.IO.File]::ReadAllBytes($manifestPath)
if ($manifestBytes.Length -eq 0 -or $manifestBytes.Length -gt 16MB) {
  throw "Integrity manifest is empty or exceeds 16 MiB."
}

[NodeViewIntegrityResource]::Embed($executablePath, $manifestBytes)
