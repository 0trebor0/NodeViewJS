# Testing

## Default suite

```powershell
npm test
```

This covers runtime APIs, logging, IPC validation, updater, plugins, platform boundaries, single instance, associations, bundle surface, menus, taskbar, colors, notifications, bridge embedding, package inputs, integrity, and CLI packaging.

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

## Native Windows features

```powershell
npm run test:menu-native
npm run test:tray-menu-native
npm run test:taskbar-native
npm run test:notification-native
```

## Security and installer

```powershell
npm run security:gate
```

The gate includes repository scanning, production dependency audit, MSVC security analysis, PE hardening, malformed-input corpus, runtime/IPC/package integrity tests, and the installer smoke test.

Run GUI/native tests from an interactive desktop session. Restricted or headless shells can prevent WebView2 windows from initializing or delivering messages.

