# Testing

## Everything

```powershell
npm run test:full
```

This chains `npm test`, `npm run test:native`, and `npm run test:native-ui`. It is Windows-only because the native UI suites are PowerShell. Run it from an interactive desktop session.

## Default suite

```powershell
npm test
```

This covers runtime APIs, window lifecycle and callback isolation, public package exports, TypeScript declarations, logging, IPC validation, updater, plugins, platform boundaries, single instance, associations, bundle surface, menus, taskbar, colors, notifications, bridge embedding, package inputs, integrity, and CLI packaging.

Three of those are worth running directly while working on the public surface:

```powershell
npm run test:window-lifecycle
npm run test:exports
npm run test:types
```

`test:window-lifecycle` drives a mocked native host to prove that native
callbacks never leak an unhandled rejection, that a failing event handler is
isolated rather than fatal, that transient windows are not retained, and that
unsubscribing releases its event name. `test:exports` checks that only the
documented entry points resolve from an installed package. `test:types`
type-checks `types/test-d.ts` against the shipped declarations.

## Packed artifact

```powershell
npm run test:tarball
```

Packs the package, installs the tarball into a clean temporary project with
`--ignore-scripts`, and verifies that the public entry points, type
declarations, and CLI arrived and resolve. It does not build the native addon.

## Live bridge

```powershell
npm run test:bridge
```

The bridge suite includes native lifecycle, ordinary integration, and the parameter/stress matrix. It verifies supported JSON values, Unicode, missing payloads, undefined results, errors, 250 KB round trips, unsupported values, 64-way concurrency, event acknowledgements, pre-run events, and repeated reloads.

```powershell
npm run test:bridge-matrix
npm run test:ipc-security-integration
npm run test:trusted-document
npm run test:webview-capabilities
npm run test:multi-window
```

`npm run test:native` runs the bridge suite plus the raw WebMessage diagnostic and every integration listed above in one pass.

## Native Windows features

```powershell
npm run test:menu-native
npm run test:tray-menu-native
npm run test:taskbar-native
npm run test:notification-native
```

`npm run test:native-ui` runs all four.

## Security and installer

```powershell
npm run security:gate
```

The gate includes repository scanning, production dependency audit, MSVC security analysis, PE hardening, malformed-input corpus, runtime/IPC/package integrity tests, and the installer smoke test.

Run GUI/native tests from an interactive desktop session. Restricted or headless shells can prevent WebView2 windows from initializing or delivering messages.

## What CI covers

The Windows CI job runs on Node 20 and Node 22 — 20 is the minimum version
`package.json` supports, so it is verified on every change rather than assumed.
Each runs `npm test`, `npm run test:native-lifecycle`, and `npm pack --dry-run`;
the security gate runs on Node 22. A separate Node 20 job packs the artifact and
runs `test:exports`, `test:types`, and `test:tarball`. CI does not run
`test:native` or `test:native-ui`: a GitHub runner can create a WebView2 controller but cannot complete browser navigation, so those suites time out there rather than reporting a real defect (PLAN.md DBG-01).

Live bridge, WebView capability, multi-window, and native UI coverage is therefore a local gate. Run `npm run test:full` from an interactive desktop session before a release.

## macOS and Linux volunteers

The repository's [macOS and Linux test plan](../PLATFORM-TESTING.md) defines the
priority operating systems and architectures, clean-build commands, package
smoke checks, evidence requirements, and completion criteria. Submit results in
an issue titled `[Platform test]: <platform and version>`.

