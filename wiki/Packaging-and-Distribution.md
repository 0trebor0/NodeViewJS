# Packaging and Distribution

## Portable packages

```powershell
npx nodeviewjs package
```

Windows output is written under `build/portable`. Packaging validates project-contained inputs, rejects traversal and reparse points, copies the runtime, prepares HTML with a local external bridge script, and binds an integrity manifest into the launcher.

## Windows installer

```powershell
npm run package:installer
```

The installer supports clean installation, replacement, rollback after corrupt payloads, interrupted-update recovery, Start Menu registration, notification identity, associations, and uninstall cleanup.

## macOS and Linux

```powershell
npm run package:macos
npm run package:linux
```

macOS produces an `.app` bundle and optional DMG flow. Linux produces a native application folder using GTK/WebKitGTK. Review [[Known Limitations]] before treating security behavior as equivalent to Windows.

## Signing

Windows release installers and launchers should be Authenticode signed. Configure signing identity and timestamp settings through the documented release environment, never by committing credentials.

Unsigned launchers can be replaced together with their embedded trust anchor. Resource integrity is strongest when the launcher itself is authenticated.

## Updates

Update metadata is Ed25519-signed and binds application identity, version, HTTPS URL, size, and SHA-256. Downloaded installers are rechecked before installation.

```powershell
npm run update:manifest
```

Keep signing keys outside the repository and CI logs.

