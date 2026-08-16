# Troubleshooting

## Start here

```powershell
npx nodeviewjs doctor
```

The doctor checks the Node.js version, whether the native addon is built and
loadable, Python 3 for `node-gyp`, the platform C++ toolchain, the system
WebView runtime, and the packaging prerequisites. Each failure names the exact
install command to run. It exits non-zero when a required check fails, so it can
gate a script.

```powershell
npx nodeviewjs doctor --signing   # also check release signing prerequisites
npx nodeviewjs doctor --json      # machine-readable output
```

Signing checks are opt-in because they are release prerequisites, not
development ones.

## Where runtime errors explain themselves

The page and the backend log deliberately receive different amounts of detail.

`NodeViewJS.invoke()` rejects with a terse message — `Unknown command: save` or
`Permission not granted for command 'save': fs:write` — because that text is
delivered to an untrusted page and should not describe how the backend is
configured.

The full explanation goes to `app.logPath`, and answers what failed, why, and
what to do next. For example, a denied command records which policy denied it,
the app policy or the window's narrowed one, along with the option to change:

```text
Command 'save' requires 'fs:write', which the window permission policy does not grant.
The app grants it, but the window this call came from narrows it:
  app.createWindow({ entry, permissions: ["fs:write"] })
Window policy: allow [fs:read], deny [none]
```

An unknown command lists the commands that *are* registered, which usually
identifies a typo immediately. A message from the page that fails IPC schema
validation is dropped without a reply, as it always was, but is now recorded in
the log with a bounded quote of the offending message. Those reports are rate
limited to five per application so a hostile page cannot flood the log.

Check the log first:

- Windows: `%LOCALAPPDATA%\NodeViewJS\Logs\<app-id>-<hash>\backend.log`
- macOS: `~/Library/Logs/NodeViewJS/<app-id>-<hash>/backend.log`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/nodeviewjs/<app-id>-<hash>/backend.log`

## `node-gyp` cannot find Python

Native builds and Windows packaging require Python 3 for `node-gyp`. Install Python 3 and point npm
to it for the current shell if it is not found automatically:

```powershell
winget install Python.Python.3.12
$env:PYTHON = "C:\Path\To\Python\python.exe"
npm run build
```

## Visual Studio is not found

Install Visual Studio 2022 Build Tools with Desktop development with C++, the Windows SDK, MSVC toolchain, and Spectre-mitigated libraries required by the build.

## WebView2 controller error `0x800700aa`

The WebView profile is busy. Close another instance using the same `appId`, or run tests with an isolated `LOCALAPPDATA` directory. Do not terminate unrelated WebView2 processes indiscriminately.

## A Windows app opens blank

Run the app once with native tracing enabled to print WebView2 initialization, navigation, and message-bridge diagnostics without showing blocking native error dialogs:

```powershell
$env:NODEVIEW_NATIVE_TRACE = "1"
npm run dev
```

Unset `NODEVIEW_NATIVE_TRACE` after debugging to restore normal native error dialogs.

## `devtools: true` does nothing in a package

Packaged Windows applications intentionally disable DevTools. Use `npm run dev` for frontend debugging.

## An event is missing

- Register frontend listeners before depending on an event.
- Normal startup buffering is automatic.
- Use `invoke()` when completion or ordering matters.
- `emit()` is one-way; use an acknowledgement event if required.
- Confirm the 1,024-event and 1 MiB readiness-buffer limits were not exceeded.

## `invoke()` resolves to `undefined`

The backend handler did not return a value:

```js
app.command("example", async () => {
  return { ok: true };
});
```

## Frontend logs are not visible

Frontend logs require development WebView DevTools. Backend logs appear in the terminal or application backend log.

Default backend log paths:

- Windows: `%LOCALAPPDATA%\NodeViewJS\Logs\<app-id>-<hash>\backend.log`
- macOS: `~/Library/Logs/NodeViewJS/<app-id>-<hash>/backend.log`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/nodeviewjs/<app-id>-<hash>/backend.log`

Set `NODEVIEW_LOG_PATH` before launching to write the backend log to a known file.

## Installer appears to hang

Use the current packaging script, which waits for the complete IExpress payload instead of treating the initial executable stub as finished. Run `npm run test:installer` to verify install, replacement, rollback, recovery, launch, and uninstall.

