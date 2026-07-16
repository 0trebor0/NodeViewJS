# Troubleshooting

## `node-gyp` cannot find Python

Install Python 3 and point npm to it for the current shell:

```powershell
$env:PYTHON = "C:\Path\To\Python\python.exe"
npm run build
```

## Visual Studio is not found

Install Visual Studio 2022 Build Tools with Desktop development with C++, the Windows SDK, MSVC toolchain, and Spectre-mitigated libraries required by the build.

## WebView2 controller error `0x800700aa`

The WebView profile is busy. Close another instance using the same `appId`, or run tests with an isolated `LOCALAPPDATA` directory. Do not terminate unrelated WebView2 processes indiscriminately.

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

## Installer appears to hang

Use the current packaging script, which waits for the complete IExpress payload instead of treating the initial executable stub as finished. Run `npm run test:installer` to verify install, replacement, rollback, recovery, launch, and uninstall.

