# Backend API

## Application

```js
const { App } = require("nodeviewjs");
const app = new App(options);
```

`entry` is required and must point at the local HTML file to load. The full option set:

```js
const app = new App({
  title: "NodeViewJS Demo",
  appId: "com.example.nodeview-demo",
  width: 900,
  height: 600,
  minWidth: 500,
  minHeight: 300,
  maxWidth: 1600,
  maxHeight: 1000,
  resizable: true,
  frame: true,
  closable: true,
  minimizable: true,
  maximizable: true,
  center: true,
  maximized: false,
  alwaysOnTop: false,
  closeToHide: false,
  transparent: false,
  windowColors: null,
  tray: false,
  menu: null,
  singleInstance: false,
  devtools: false,
  startupTiming: false,
  icon: "assets/icon.ico",
  entry: "index.html",
  permissions: ["fs:read"],
  allowedOrigins: []
});
```

TypeScript declarations for every option, method, and event payload ship with the
package (`types/index.d.ts`), so editors complete these without extra setup.

Key methods:

- `app.run()` and `app.quit()`
- `app.command(name, handler)`
- `app.command(name, permissions, handler)`
- `app.on()`, `app.once()`, `app.off()`, and `app.emit()`
- `app.createWindow(options)`
- `app.use(plugin, options)`
- `app.fetch(options)`
- menu, tray, taskbar, notification, and window-control methods

Call `app.run()` once, after registering commands, plugins, and event handlers.
It opens the configured windows and returns `true`; a secondary launch of a
single-instance app returns `false` after forwarding its arguments. `app.quit()`
closes every window and releases native resources. See [[Lifecycle]] for the
full ordering, reopen rules, and error semantics.

## WebView profiles, app data, and logs

`appId` identifies persistent web-view data and defaults to `title`. Windows
profiles live under `%LOCALAPPDATA%\NodeViewJS\<app-id>-<hash>\WebView2`; the
macOS app-support path ends in `WebKit`. Keep `appId` stable across releases so
the same profile is reused.

Backend errors are written to `app.logPath`:

- Windows: `%LOCALAPPDATA%\NodeViewJS\Logs\<app-id>-<hash>\backend.log`
- macOS: `~/Library/Logs/NodeViewJS/<app-id>-<hash>/backend.log`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/nodeviewjs/<app-id>-<hash>/backend.log`

Set `NODEVIEW_LOG_PATH` to override the log file during debugging or tests. Logs
append across launches and rotate to `backend.log.1` at the runtime size limit.

## Window options and controls

`transparent: true` makes the WebView canvas and native client area fully
transparent, so transparent page pixels reveal what is behind the app. The
standard Windows frame stays visible, partial opacity is unsupported, and the
reserved color `rgb(1, 0, 1)` must not be used in page content because Windows
uses it as the transparency key.

`closeToHide: true` hides the window when the close button is clicked instead of
quitting. `app.quit()` still closes the app fully.

On Windows, `frame: false` hides the native title bar, system menu, and caption
buttons. `closable`, `minimizable`, and `maximizable` control the native window
actions while the frame is enabled; `closable: false` blocks the native close
action but leaves `window.close()` and `app.quit()` available to backend code.

On Windows 11 build 22000 or newer, `windowColors` sets the native title bar,
title text, and border with `#RRGGBB` values:

```js
const app = new App({
  entry: "index.html",
  windowColors: {
    titleBar: "#162033",
    titleText: "#ffffff",
    border: "#3b82f6"
  }
});

app.setWindowColors({ titleBar: "#24324a", titleText: "#ffffff", border: "#60a5fa" });
console.log(app.mainWindow.getState().windowColorsSupported);
```

Runtime updates preserve colors that are not supplied. Pass `null` for one key to
reset that color, or `app.setWindowColors(null)` to restore all system defaults.
Windows 10 reports `windowColorsSupported: false`; use `frame: false` and a
custom title bar there.

Runtime controls are available on `app.mainWindow` and every window returned by
`app.createWindow()`:

```js
const window = app.mainWindow;

window.minimize();
window.maximize();
window.restore();
window.setFullscreen(true);
window.setTitle("Updated title");
window.setSize(960, 640);
window.setPosition(100, 80);

console.log(window.getState());
```

## Windows taskbar integration

Taskbar progress, overlay icons, and attention requests are available after
`app.run()`, on both `App` and each `AppWindow`:

```js
app.setTaskbarProgress(0.65, "normal"); // normal, paused, error, or indeterminate
app.setTaskbarOverlay("assets/badge.ico", "New messages");
app.requestAttention("informational"); // informational, critical, or stop

app.setTaskbarProgress(null); // clear progress
app.setTaskbarOverlay(null);  // remove overlay
```

Progress values run from `0` to `1`, and overlay images must be existing `.ico`
files.

## Custom title bars

Custom HTML/CSS chrome works on Windows 10 and 11. Disable the native frame and
register permission-gated window commands:

```js
const app = new App({ entry: "index.html", frame: false });

app.command("window:startDrag", { permission: "window:control" }, () => {
  app.mainWindow.startDrag();
  return true;
});

app.command("window:minimize", { permission: "window:control" }, () => {
  app.mainWindow.minimize();
  return true;
});

app.command("window:close", { permission: "window:control" }, () => {
  setImmediate(() => app.mainWindow.close());
  return true;
});
```

```html
<header class="titlebar">
  <span class="titlebar-title">My App</span>
  <button id="minimize" aria-label="Minimize">&#x2212;</button>
  <button id="close" class="close" aria-label="Close">&#x2715;</button>
</header>

<script>
  document.querySelector(".titlebar").addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    NodeViewJS.invoke("window:startDrag");
  });
  document.querySelector("#minimize").addEventListener("click", () => {
    NodeViewJS.invoke("window:minimize");
  });
  document.querySelector("#close").addEventListener("click", () => {
    NodeViewJS.invoke("window:close");
  });
</script>
```

Schedule the close with `setImmediate()` so the IPC response finishes before the
window is destroyed.

## Single-instance applications

```js
const app = new App({
  appId: "com.example.my-app",
  entry: "index.html",
  singleInstance: true
});

app.on("second-instance", ({ args, cwd }) => {
  console.log("Launched again with:", args, cwd);
});

const primary = app.run();
```

The primary `app.run()` returns `true`. A duplicate launch returns `false`, opens
no window, forwards its arguments in the background, and exits naturally once
delivery finishes — do not force it to exit immediately, because that interrupts
delivery. The existing primary window is restored and shown before
`second-instance` handlers run. Messages are validated and limited to 64 KiB.

## Deep links and file associations

```js
const app = new App({
  appId: "com.example.my-app",
  entry: "index.html",
  singleInstance: true,
  protocols: ["my-app"],
  fileAssociations: [".myapp"]
});

app.on("open-url", ({ url, initial }) => console.log("Open URL:", url, initial));
app.on("open-file", ({ path, initial }) => console.log("Open file:", path, initial));
```

`initial` is `true` when the URL or file started the primary process. File paths
resolve against the launching process's working directory. Custom schemes use
lowercase letters, numbers, `+`, `.`, or `-`; `file`, `http`, `https`, and
`mailto` cannot be claimed. Extensions begin with a dot. Portable folders do not
register anything by themselves — the per-user installer performs registration
and removal.

## System tray

```js
const app = new App({
  title: "My App",
  entry: "index.html",
  closeToHide: true,
  tray: {
    title: "My App",
    icon: "assets/app.ico",
    menu: [
      { id: "tray.show", label: "Show" },
      { id: "tray.enabled", label: "Enabled", type: "checkbox", checked: true },
      { type: "separator" },
      { id: "tray.quit", label: "Quit" }
    ]
  }
});

app.on("tray-menu", ({ id, checked }) => {
  if (id === "tray.show") app.show();
  if (id === "tray.quit") app.quit();
});
```

Omit `tray.menu`, or set it to `null`, for the built-in Show and Quit items. Tray
accelerators are rejected because tray menus are not active while the app is
unfocused. Double-clicking the tray icon always shows the app window.

## Native application menus

Menu items are declarative: they carry bounded string IDs and emit events rather
than executing native callbacks.

```js
const app = new App({
  entry: "index.html",
  menu: [
    {
      label: "File",
      submenu: [
        { id: "file.open", label: "Open", accelerator: "Ctrl+O" },
        { type: "separator" },
        { id: "file.autosave", label: "Auto save", type: "checkbox", checked: true }
      ]
    }
  ]
});

app.on("menu", ({ id, checked, window }) => {
  if (id === "file.open") console.log("Open selected", window.id);
});
```

Use `app.setMenu(template)` or `window.setMenu(template)`; `null` removes the
menu. Supported types are `normal`, `checkbox`, `separator`, and nested
`submenu`. Templates are limited to 256 items and eight levels, and IDs and
accelerators must be unique. Context menus emit the same `menu` event:

```js
app.mainWindow.showContextMenu([
  { id: "edit.copy", label: "Copy", accelerator: "Ctrl+C" },
  { id: "edit.delete", label: "Delete" }
], { x: 40, y: 80 });
```

Accelerators support Ctrl, Alt, Shift, letters, numbers, F1–F24, and common
navigation keys.

## Permission-gated commands

```js
const app = new App({
  entry: "index.html",
  permissions: {
    allow: ["fs:read:config", "dialog:open:settings"],
    deny: ["fs:write"]
  }
});

app.command("config:read", {
  permission: "fs:read",
  scope: "config"
}, async () => ({ theme: "dark" }));
```

Deny rules take precedence. Permissions control command admission; handlers must still validate application-specific semantics.

Window options can include `permissions` to narrow the app policy for that window:

```js
app.createWindow({
  title: "Preview",
  entry: "preview.html",
  permissions: ["fs:read:config"]
});
```

The app policy remains the maximum permission set. A command invoked from a window must satisfy both policies.

Permission arrays such as `permissions: ["fs:read"]` are simple allow-lists.
Policy objects add deny rules, and deny always beats allow. A group such as
`fs:*` grants a permission family; a scope such as `dialog:open:settings` grants
one named resource. Commands can combine a `permission` with a `scope`, or
require several at once:

```js
app.command("readSettings", {
  permissions: ["fs:read:config", "dialog:open:settings"]
}, handler);
```

Groups and wildcard scopes are accepted only in app policies, never as command
requirements. Invoking a command the backend never registered rejects with an
`Unknown command` error.

The current permission names are `fs:read`, `fs:write`, `dialog:open`,
`dialog:save`, `clipboard:read`, `clipboard:write`, `shell:open`,
`notification:show`, `window:control`, and `net:fetch`.

## Network access

The WebView cannot reach the network. Grant `net:fetch`, list the origins the app may reach, and perform the request in a command:

```js
const app = new App({
  entry: "index.html",
  permissions: ["net:fetch"],
  allowedOrigins: ["https://api.example.com"]
});

app.command("api:get", { permission: "net:fetch" }, async ({ path }) => {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError("path must start with /.");
  }
  const response = await app.fetch({ url: `https://api.example.com${path}` });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return JSON.parse(response.body);
});
```

`app.fetch()` binds the app's allowlist, so a command cannot widen it. It returns `{ url, status, ok, headers, body }` with `body` as text. Options are `url`, `method`, `headers`, `body`, `timeoutMs`, and `maxResponseBytes`.

`allowedOrigins` takes origins only, with no path, query, or fragment. Both `http` and `https` are accepted, including private and internal addresses, because listing an origin is the deliberate act that grants it. Prefer `https` for anything leaving the machine. An app with no `allowedOrigins` cannot make requests.

Redirects are re-checked against the allowlist on every hop. Transport and credential headers such as `Host` and `Cookie` cannot be set by the caller, and `set-cookie` is stripped from responses.

When a command builds a request entirely from its own constants, the global `fetch()` is equivalent and simpler. `app.fetch()` earns its place when any part of the request comes from the frontend. See [[Security Model]] for what the allowlist does and does not protect.

## Windows

`AppWindow` instances support show, hide, close, reload, minimize, maximize, restore, fullscreen, title, size, position, drag, menus, taskbar state, notifications, tray integration, and state inspection. `isOpen` reports whether a window is currently open, and `isClosed` reports whether it has been closed; a window that has not been opened yet is neither open nor closed.

See [[Windows and Multiple Windows]].

## Events

```js
app.on("ready", (payload) => console.log(payload));
app.once("first-open", (payload) => console.log(payload));
app.emit("theme-changed", { theme: "dark" });

const onStatus = (status) => console.log(status);
const off = app.on("status", onStatus);
off();               // the returned unsubscribe function
app.off("status", onStatus); // or the explicit form
```

`on()` and `once()` return an unsubscribe function that behaves exactly like
`off()`, including releasing the event name once its last handler is gone.
Calling it more than once is harmless.

`app.emit()` broadcasts to every live window; `AppWindow.emit()` targets one.
Events in both directions are buffered until the frontend bridge is ready, which
makes `app.emit()` before `app.run()` safe. Each direction preserves order and is
limited to 1,024 events or 1 MiB per window.

A failing event handler is reported to the backend log and isolated: the
remaining handlers still run, and the process is not terminated. See
[[Lifecycle]].

## Helpers

NodeViewJS exports trusted backend helpers. Expose their behavior to a frontend
only through explicit, permission-gated commands.

### Shell

```js
const { shell } = require("nodeviewjs");

app.command("openWebsite", { permission: "shell:open" }, ({ url }) => shell.openExternal(url));
app.command("showExport", { permission: "shell:open" }, ({ file }) => shell.openPath(file));
```

`shell.openExternal(url)` accepts only absolute `http:`, `https:`, and `mailto:`
URLs without embedded credentials. `shell.openPath(path)` resolves the path and
rejects it unless the file or directory already exists. Both return `true` once
Windows accepts the launch request and throw a descriptive error otherwise.
NodeViewJS provides no arbitrary command or shell-execution method.

### Clipboard

```js
const { clipboard } = require("nodeviewjs");

app.command("clipboard:read", { permission: "clipboard:read" }, () => clipboard.readText());
app.command("clipboard:write", { permission: "clipboard:write" }, ({ text }) => clipboard.writeText(text));
```

`readText()` returns the current Unicode text, or an empty string when the
clipboard holds no text. `writeText(text)` returns `true`. Null characters are
rejected because the Windows clipboard text format is null-terminated.

### Dialogs

```js
const { dialog } = require("nodeviewjs");

dialog.message({ title: "My App", message: "Finished loading." });
const sourcePath = dialog.openFile();
const destinationPath = dialog.saveFile();
```

File helpers return the selected absolute path, or `null` when the user cancels.
The save dialog asks before replacing an existing file.

### Configuration

```js
const { config } = require("nodeviewjs");

const settings = await config.read({
  appName: "MyApp",
  fileName: "settings.json",
  defaults: { theme: "light" }
});

await config.write({ appName: "MyApp", fileName: "settings.json", data: { theme: "dark" } });
```

File names must be simple `.json` names, not paths. Files are stored under the
user's application-data directory unless a trusted backend supplies `directory`.

### Notifications

```js
app.showNotification({ title: "My App", message: "Finished loading." });
app.mainWindow.showNotification({ title: "Download", message: "Complete." });
```

Titles are limited to 63 characters and messages to 255. NodeViewJS gives
Windows an explicit identity derived from `appId` and sends toasts through the
AUMID-addressed API, so notifications show your app title rather than
`Node.js JavaScript Runtime`. Keep `appId` and `title` stable between releases;
Windows caches notification identity by AUMID. Windows notification settings, Do
Not Disturb, and Focus Assist can still suppress presentation.

### IPC protocol helpers

`require("nodeviewjs").ipc`, also importable as `nodeviewjs/ipc`, holds the
versioned message parser, serializer, response/event constructors, validation
helpers, and protocol limits used by the runtime. This is **advanced API**: its
shapes follow the IPC protocol version rather than the package version. Use
`app.command()`, `app.on()`, and `app.emit()` for application IPC; reach for
`ipc` only when writing a protocol adapter or a test that needs the runtime's
own validation.

## Plugins

Plugins are trusted backend modules with namespaced commands/events, declared permissions, transactional setup, deterministic start/stop, and cleanup hooks.

```js
app.use({
  name: "example.settings",
  version: "1.0.0",
  permissions: ["fs:read:config"],
  setup(plugin, options) {
    plugin.command("read", {
      permission: "fs:read",
      scope: "config"
    }, () => loadSettings(options.fileName));

    plugin.on("refresh", () => reloadSettings());
    return () => closeSettingsStore();
  },
  start(plugin) {
    plugin.emit("ready", { loaded: true });
  },
  stop() {
    flushSettings();
  }
}, { fileName: "settings.json" });
```

The frontend calls `NodeViewJS.invoke("example.settings:read")` and listens for
events such as `example.settings:ready`. Plugin names must be lowercase
dot-or-hyphen identifiers. Setup, start, stop, and cleanup hooks are
synchronous; setup is transactional and runs before `app.run()`.

Every plugin permission must be granted by the app policy, and a plugin command
can require only permissions that plugin declared. These declarations control
host admission and command routing; plugin modules are trusted Node.js code, not
an operating-system sandbox. Plugins are loaded by backend code, never from the
WebView.

