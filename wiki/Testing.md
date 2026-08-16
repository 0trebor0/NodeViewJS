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

## Release candidate

```powershell
npm run test:rc
```

The gate every release candidate has to survive, run against the package as it
would actually be published rather than against this source tree:

1. pack with `npm pack` and install the tarball into a clean project;
2. generate an application with the installed CLI;
3. run it — a real window opens;
4. frontend to backend IPC through a permission-gated command;
5. backend to frontend events, acknowledged by the page;
6. a clean exit with the expected status;
7. package that application with the installed CLI;
8. verify every entry in the packaged integrity manifest by recomputing its
   size and SHA-256;
9. verify signed update metadata through the installed package, including that
   a tampered manifest is refused.

Steps 3 to 6 open a native window, so run it from an interactive desktop
session. Step 7 is Windows-only. `npm run test:full` ends with this gate.

By default the native addon is copied from this repository's `build/nodeview`
rather than recompiled inside the temporary project, which keeps the gate to
about a minute and exercises the packaged JavaScript, CLI, and runtime. To
compile it inside the project instead and exercise the real install path end to
end:

```powershell
$env:NODEVIEW_RC_BUILD = "1"
npm run test:rc
```

On failure the temporary workspace is kept and its path printed, so the
half-built application can be inspected.

## Load and failure injection

```powershell
npm run test:limits
npm run test:updater-failures
```

`test:limits` is about valid-but-hostile traffic rather than malformed input:
thousands of commands and events, repeated maximum-size messages, a full
concurrency window of handlers that never finish, a page that never signals
readiness, and rapid window churn under traffic. Every case asserts that the
runtime's bookkeeping stays bounded — the replay memo at its cap, no requests
left active, no windows retained. `npm test` runs it with `--expose-gc`, which
adds heap-growth assertions.

`test:updater-failures` injects a failure at every stage of an update and
asserts the guarantee that matters: an update that does not succeed leaves the
working installation exactly as it was, and the application is never shut down
for an installer that failed verification or a helper that never started.

## Trust boundary fuzzing

```powershell
npm run test:fuzz
```

Seeded, structure-aware malformed input for every validator on a trust
boundary: IPC parsing and serialization, permission policies, protocol and
file-association manifests, launch arguments, menu and tray templates, update
metadata, package integrity manifests, the network origin allowlist, and the
whole inbound frontend message path.

Four properties are enforced for each target:

1. the call returns or throws — it never leaves the process;
2. a rejection is a real `Error` with a bounded, usable message;
3. no input reaches `Object.prototype` or `Array.prototype`;
4. anything accepted satisfies that validator's own contract.

The seed is printed on every run. Pin it to reproduce a failure, and raise the
iteration count to search harder:

```powershell
$env:NODEVIEW_FUZZ_SEED = "1337"
$env:NODEVIEW_FUZZ_ITERATIONS = "5000"
npm run test:fuzz
```

Fixed corpus samples in `test/fixtures/security-corpus.json` remain the
regression floor: those exact inputs must always be rejected, whatever a given
seed happens to generate.

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
npm run test:window-retention
npm run test:bridge-matrix
npm run test:ipc-security-integration
npm run test:trusted-document
npm run test:webview-capabilities
npm run test:multi-window
```

`npm run test:window-retention` opens and closes forty native windows and then
asserts, through an internal diagnostics binding, that the native host is
tracking exactly one window again. It is the native half of the window
lifecycle work: closed windows are queued by `OnWindowDestroyed` and released by
the next message pump, because they cannot be freed while their own window
procedure is still executing.

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

