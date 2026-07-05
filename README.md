# NodeViewJS

NodeViewJS is a lightweight desktop runtime for building small apps with Node.js, vanilla HTML/CSS/JavaScript, and the operating system web view. Windows uses WebView2, macOS uses WKWebView, and Linux uses WebKitGTK.

It gives your frontend a safe `window.NodeViewJS` bridge and keeps privileged work in registered Node.js commands. It does not expose raw Node.js APIs such as `require()` to the WebView.

> This project and its implementation plan were created with GPT assistance.

## Current status

NodeViewJS is an early cross-platform runtime. The current version can:

- open native windows backed by WebView2, WKWebView, or WebKitGTK;
- load a local HTML entry file;
- expose `NodeViewJS.invoke()`, `NodeViewJS.on()`, `NodeViewJS.once()`, `NodeViewJS.off()`, and `NodeViewJS.emit()` in the frontend;
- register backend commands through the Node.js `App` API;
- package Windows portable folders/installers, macOS `.app`/DMG output, and Linux portable folders;
- create independent native windows with isolated WebViews and IPC routing.

Windows is verified locally. The macOS 14 and Ubuntu 24.04 CI lanes compile their native hosts and pass the unit, live bridge, and multi-window suites.

The `v0.1.0` release candidate passes the full GitHub CI matrix and an isolated install from the generated npm tarball. It has not been tagged or published; production signing and registry/release credentials are intentionally external to the repository.

## Feature guide

| Area | Features | Guide |
| --- | --- | --- |
| Project setup | Starter app generation, manual setup, package configuration | [Use NodeViewJS from another project](#use-nodeviewjs-from-another-project) |
| CLI | Create, setup, build, start, develop, package, create installers, and sign update metadata | [CLI commands](#cli-commands) |
| Development | DevTools, frontend live reload, startup timing, and backend error reporting | [Run during development](#5-run-during-development) |
| Frontend bridge | `invoke`, `on`, `once`, `off`, and `emit`; development and packaged loading | [Basic usage](#basic-usage), [How the bridge is loaded](#how-the-bridge-is-loaded) |
| Backend commands | Command registration, scoped permissions, multiple requirements, and deny rules | [Commands and permissions](#appcommandname-handler) |
| Backend events | App-wide broadcasts and targeted window events | [Events](#events) |
| App lifecycle | Start, quit, show, hide, reload, and close behavior | [App lifecycle](#app-lifecycle) |
| Window configuration | Size limits, position, title, fullscreen, transparency, native frame, hover frame, close behavior, and custom dragging | [Window options and controls](#window-options-and-controls), [Custom title bars](#custom-title-bars) |
| Multiple windows | Independent WebViews, IPC, events, menus, and lifecycle | [Multiple windows](#multiple-windows) |
| Desktop UI | System tray, application/context menus, accelerators, taskbar progress, overlays, and attention | [System tray](#system-tray), [Native application menus](#native-application-menus), [Windows taskbar integration](#windows-taskbar-integration) |
| Launch routing | Single-instance behavior, custom protocols, and file associations | [Single-instance applications](#single-instance-applications), [Deep links and file associations](#deep-links-and-file-associations) |
| Backend helpers | Shell, clipboard, dialogs, notifications, AppData JSON config, and strict IPC helpers | [Shell API](#shell-api), [Clipboard API](#clipboard-api), [Runtime helpers](#runtime-helpers) |
| Plugins | Trusted backend plugins, namespaced commands/events, permissions, and lifecycle hooks | [Plugin system](#appuseplugin-options) |
| Windows packaging | Portable folders, include/exclude rules, secret protection, metadata, icons, integrity verification, and per-user installers | [Create the portable app](#6-create-the-portable-app), [Windows installer](#package-a-windows-installer) |
| Windows signing | Authenticode launcher/installer signing and timestamping | [Windows code signing](#windows-code-signing) |
| Automatic updates | Ed25519 manifests, HTTPS downloads, transactional install, rollback, and restart | [Signed auto-updates](#signed-auto-updates) |
| macOS packaging | `.app`, DMG, icons, Developer ID signing, and notarization | [Package a macOS app](#package-a-macos-app) |
| Linux packaging | Portable folder with bundled Node runtime and native host | [Package a Linux app](#package-a-linux-app) |
| Security | Trusted documents, bounded IPC, capability lockdown, package containment, integrity, and release gate | [Security model](#security-model) |
| Verification | Unit, packaging, security, installer, and live native integration tests | [Tests](#tests) |

## Requirements

- Node.js 20 or newer
- Python 3

Windows:

- Windows 10 or newer
- Visual Studio Build Tools 2022 with the `Desktop development with C++` workload
- Microsoft Edge WebView2 Runtime

macOS development:

- macOS 12 or newer
- Xcode command-line tools with the macOS SDK

Linux development:

- GTK 3 development headers
- WebKitGTK 4.1 development headers (`webkit2gtk-4.1`)
- `pkg-config`

On Ubuntu 24.04:

```bash
sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config
```

The build script downloads/stages the WebView2 SDK package into `vendor/` when needed.

If `node-gyp` cannot find Python, set `PYTHON` before building:

```powershell
$env:PYTHON = "C:\Users\robert\AppData\Local\Programs\Python\Python312\python.exe"
```

## Install dependencies

```powershell
npm install
npm run setup
```

## Use NodeViewJS from another project

You can install NodeViewJS directly from GitHub and use its CLI from another app project.

### Fastest path: create a starter app

```powershell
npm install github:0trebor0/NodeViewJS
npx nodeviewjs create MyApp
cd MyApp
npm install
npm run dev
npm run package
```

This creates:

```text
MyApp/
  package.json
  app.js
  index.html
```

### Manual path

If you want to wire an existing app manually, use the steps below.

### 1. Create or open your app project

```powershell
mkdir MyApp
cd MyApp
npm init -y
```

### 2. Install NodeViewJS from GitHub

```powershell
npm install github:0trebor0/NodeViewJS
```

This install builds and provides:

- the NodeViewJS runtime API;
- the `nodeviewjs` CLI;
- the native addon and launcher files built by this package.

The install therefore requires the Windows native build prerequisites listed above and network access the first time the WebView2 SDK is downloaded.

### 3. Configure your app package

Add a `nodeviewjs` block and useful scripts to your app project's `package.json`:

```json
{
  "name": "my-app",
  "version": "0.1.0",
  "main": "app.js",
  "nodeviewjs": {
    "name": "MyApp",
    "appId": "com.example.my-app",
    "entry": "app.js",
    "icon": "assets/app.ico",
    "macIcon": "assets/app.icns",
    "protocols": [{ "scheme": "my-app", "name": "My App URL" }],
    "fileAssociations": [{ "extension": ".myapp", "name": "My App document" }],
    "include": ["assets"],
    "exclude": ["assets/private", "assets/private/*"],
    "metadata": {
      "companyName": "My Company",
      "fileDescription": "My App",
      "productName": "My App",
      "copyright": "Copyright (C) 2026 My Company"
    }
  },
  "scripts": {
    "dev": "nodeviewjs dev app.js",
    "package": "nodeviewjs package",
    "installer": "nodeviewjs installer",
    "update:manifest": "nodeviewjs update-manifest"
  },
  "dependencies": {
    "nodeviewjs": "github:0trebor0/NodeViewJS"
  }
}
```

The important part is:

```json
"nodeviewjs": {
  "name": "MyApp",
  "appId": "com.example.my-app",
  "entry": "app.js",
  "icon": "assets/app.ico",
  "protocols": [{ "scheme": "my-app", "name": "My App URL" }],
  "fileAssociations": [{ "extension": ".myapp", "name": "My App document" }],
  "include": ["assets"],
  "exclude": ["assets/private", "assets/private/*"],
  "secretWarnings": true
}
```

- `name` becomes the portable folder name and exe name.
- `appId` is the stable identity used for app data and signed updates.
- `entry` is your backend NodeViewJS app entry file.
- `icon` is an optional Windows `.ico` file used as the app window/taskbar icon.
- `macIcon` is an optional macOS `.icns` bundle icon.
- `protocols` registers custom URL schemes in the per-user Windows installer.
- `fileAssociations` registers supported extensions with Windows Open With and Default Apps.
- `include` copies extra project files or folders into `resources/app`.
- `exclude` removes files or folders from the app bundle.
- On Windows, `secretWarnings` defaults to `true`; set it to `false` to disable redacted credential-pattern warnings.
- `metadata` sets Windows version metadata when the launcher is built.

On Windows, `entry`, `icon`, `include`, and `exclude` values must be relative and traversal-free. Packaging rejects inputs or destinations containing symbolic links, junctions, or other reparse-point escapes.

### 4. Create your app files

`app.js`:

```js
const path = require("node:path");
const { App } = require("nodeviewjs");

const app = new App({
  title: "My App",
  width: 900,
  height: 600,
  entry: path.join(__dirname, "index.html")
});

app.command("greet", async (name) => {
  return `Hello ${name || "there"} from NodeViewJS`;
});

app.run();
```

`index.html`:

```html
<!doctype html>
<html>
  <body>
    <h1>My App</h1>
    <input id="name" value="Robert" />
    <button id="greet">Greet</button>
    <p id="output"></p>

    <script>
      const nameInput = document.querySelector("#name");
      const greetButton = document.querySelector("#greet");
      const output = document.querySelector("#output");

      greetButton.onclick = async () => {
        output.textContent = await NodeViewJS.invoke("greet", nameInput.value);
      };
    </script>
  </body>
</html>
```

### 5. Run during development

```powershell
npm run dev
```

This runs:

```powershell
nodeviewjs dev app.js
```

Dev mode enables DevTools and startup timing. Packaged Windows apps force DevTools off even if development configuration enabled them. Dev mode also watches the entry file's directory and reloads the WebView when frontend `.html`, `.css`, or `.js` files change. Generated folders such as `node_modules`, `build`, and `.nodeview-webview` are ignored.

Frontend reloads keep the Node.js backend process running. Restart dev mode after changing backend application code.

Uncaught backend exceptions and promise rejections include a `[NodeViewJS dev]` heading and their stack trace. Missing frontend entries fail before a native window is opened. Native WebView failures are shown in a Windows dialog and written to stderr; packaged apps capture that output in `resources/<AppName>.log`.

### 6. Create the portable app

From your app project folder:

```powershell
npm run package
```

This runs:

```powershell
nodeviewjs package
```

The CLI packages the current project, reads that project's `package.json`, and writes:

```text
build/portable/MyApp/
  MyApp.exe
  resources/
```

If the native addon or launcher is missing, `nodeviewjs package` builds the runtime automatically before creating the portable folder.

The top-level portable folder contains only:

```text
MyApp.exe
resources/
```

The `resources/` folder contains your app files, bundled Node runtime, native addon, updater helper, one bundled `nodeview.js` framework file, and `integrity.manifest`. The editable runtime remains separated into modules in the source project; portable packaging combines those modules to keep shipped apps tidy.

On Windows, the manifest records every app/runtime file's path, size, and SHA-256 digest and is embedded byte-for-byte into the launcher. Before Node starts, the launcher rejects manifest changes, missing or extra files, reparse points, path escapes, size changes, and digest mismatches. The runtime log is the only permitted unlisted resource file.

#### Package integrity and secret protection

On Windows, packaging always excludes:

- `node_modules`
- `.git`
- `.nodeview-webview`
- `build`
- `.env`, `.env.*`, `.npmrc`, and `.pypirc`
- private-key and credential files such as `*.pem`, `*.key`, `*.pfx`, `*.p12`, `credentials.json`, and `service-account*.json`
- JavaScript source maps (`*.map`)

Text package inputs up to 1 MiB are scanned for common private-key, access-key, token, and credential-assignment patterns. Warnings identify only the file and pattern category; they never print the matched value.

### Exe metadata

Windows exe metadata is compiled into the launcher during `npm run build`.

Set it in `package.json`:

```json
"nodeviewjs": {
  "metadata": {
    "companyName": "My Company",
    "fileDescription": "My App",
    "productName": "My App",
    "fileVersion": "1.0.0",
    "productVersion": "1.0.0",
    "copyright": "Copyright (C) 2026 My Company"
  }
}
```

Then rebuild and package:

```powershell
npm run build
npm run package
```

Metadata is embedded into the launcher exe. It is separate from code signing; unsigned exes can still show SmartScreen warnings.

### App icon

Set a window/taskbar icon with a Windows `.ico` file:

```json
"nodeviewjs": {
  "icon": "assets/app.ico",
  "include": ["assets"]
}
```

In your app entry, use the packaged icon path through `NODEVIEW_APP_ICON`:

```js
const app = new App({
  title: "My App",
  icon: process.env.NODEVIEW_APP_ICON,
  entry: path.join(__dirname, "index.html")
});
```

`nodeviewjs package` copies the icon into `resources/app` and sets `NODEVIEW_APP_ICON` before your app code runs.

This controls the native window/taskbar icon and embeds the same icon in the generated `.exe`.

### CLI commands

```powershell
nodeviewjs create MyApp
nodeviewjs setup
nodeviewjs build
nodeviewjs start app.js
nodeviewjs dev app.js
nodeviewjs package
nodeviewjs installer
nodeviewjs update-manifest https://updates.example.com/MyApp-1.2.0-setup.exe
nodeviewjs --help
```

You usually do not need to install the CLI globally. When you run it through an npm script, npm automatically finds `nodeviewjs` from `node_modules/.bin`.

## Build

```powershell
npm run build
```

The platform-aware `scripts/build.js` entrypoint:

1. prepares WebView2 SDK files on Windows;
2. generates the native bridge header from `runtime/bridge.js`;
3. builds the Windows/WebView2 or macOS/WKWebView native addon and launcher;
4. stages native outputs into `build/nodeview/`.

Build outputs are ignored by Git.

## Run the example app

```powershell
npm start
```

To open the app with DevTools enabled:

```powershell
npm run dev
```

You can also use the local CLI:

```powershell
npx nodeviewjs start
npx nodeviewjs create MyApp
npx nodeviewjs dev
npx nodeviewjs build
npx nodeviewjs package
```

When run from another project, `nodeviewjs package` packages that current project, not the NodeViewJS demo.

## Package the portable demo

```powershell
npm run package
```

Portable packaging reads the `nodeviewjs` block in `package.json`:

```json
{
  "nodeviewjs": {
    "name": "NodeViewDemo",
    "entry": "examples/basic/app.js",
    "icon": "examples/basic/assets/app.ico",
    "include": ["examples/basic/assets"],
    "exclude": []
  }
}
```

`name` controls the portable folder and exe name. `entry` points to the backend app entry file. The entry file is copied as `resources/app/app.js` inside the portable folder. Use `include` for asset folders outside the entry directory, and `exclude` for files that should not ship.

The portable app is written to:

```text
build/portable/NodeViewDemo/
```

Run:

```text
build/portable/NodeViewDemo/NodeViewDemo.exe
```

Portable folder layout:

```text
NodeViewDemo/
  NodeViewDemo.exe
  resources/
    app/
      app.js
      index.html
      __nodeview/
        bridge.js
    runtime/
      node.exe
      nodeview.js
      apply-update.ps1
      nodeview.node
    integrity.manifest
```

The generated exe starts the bundled Node runtime without opening a console window, waits for the app process, and writes runtime output to `resources/<AppName>.log`.

## Package a macOS app

On macOS, the same package command creates `build/macos/<AppName>.app` and a compressed `build/macos/<AppName>.dmg`:

```bash
npm run package
# or
npx nodeviewjs package
```

The bundle contains a native Mach-O launcher, bundled Node runtime, native addon, runtime JavaScript, and app assets. The DMG includes the app and an Applications shortcut. Packaging uses `nodeviewjs.appId` as `CFBundleIdentifier`, `nodeviewjs.macIcon` for an optional `.icns`, and writes backend output to `~/Library/Logs/<appId>/<AppName>.log`.

Set `NODEVIEW_MAC_SIGN_IDENTITY` to a Developer ID Application identity to sign the launcher, Node runtime, addon, and app with hardened-runtime options. Set `NODEVIEW_MAC_NOTARY_PROFILE` to a configured `notarytool` keychain profile to submit and staple the signed app before its DMG is generated. Successful macOS compile/live smoke evidence remains required before the macOS queue item is complete.

## Package a Linux app

On Linux, the package command creates `build/linux/<AppName>/` with one executable and one `resources/` directory:

```bash
npm run package
# or
npx nodeviewjs package
```

The output bundles the Node runtime, native addon, runtime JavaScript, and app files. The target system still needs compatible GTK 3 and WebKitGTK 4.1 runtime libraries.

## Package a Windows installer

```powershell
npm run package:installer
# or from an app project
npx nodeviewjs installer
```

The installer is written to `build/installer/<AppName>-<version>-setup.exe`. It installs for the current user under `%LOCALAPPDATA%\Programs\<AppName>`, creates a Start Menu shortcut, registers configured custom protocols and file types, and registers an uninstaller in Windows Installed Apps. Administrator access is not required. Association registration refuses to replace a protocol or app-specific file handler owned by another application, and uninstallation removes only registrations still owned by the installed executable.

### Windows code signing

Installers are unsigned by default. To sign the portable executable and installer with Windows SDK `signtool.exe`, set either `NODEVIEW_SIGN_CERTIFICATE` to a PFX path (and optionally `NODEVIEW_SIGN_PASSWORD`) or `NODEVIEW_SIGN_THUMBPRINT`. Set `NODEVIEW_SIGN_TIMESTAMP_URL` to add an RFC 3161 timestamp. Packaging embeds the integrity manifest before Authenticode signing, so the signature protects the launcher trust anchor. Signed update metadata then authenticates the complete installer containing that launcher/resources pair.

Installer replacement is transactional. Existing files are restored if extraction or registration fails.

## Signed auto-updates

NodeViewJS update manifests use Ed25519 signatures and bind the app id, semantic version, HTTPS installer URL, byte size, and SHA-256 digest. Keep the private key outside the project and ship only its public key in the app.

After building an installer, create `build/installer/update.json`:

```powershell
$env:NODEVIEW_UPDATE_PRIVATE_KEY = "C:\secure\my-app-update-private.pem"
npx nodeviewjs update-manifest https://updates.example.com/MyApp-1.2.0-setup.exe
```

Upload the generated manifest and installer to HTTPS endpoints. In the backend:

```js
const { App, Updater } = require("nodeviewjs");

const app = new App({
  title: "My App",
  appId: "com.example.my-app",
  entry: "index.html"
});

const updater = new Updater({
  appId: process.env.NODEVIEW_APP_ID,
  currentVersion: process.env.NODEVIEW_APP_VERSION,
  manifestUrl: "https://updates.example.com/update.json",
  publicKey: `-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----`
});

async function updateNow() {
  const update = await updater.checkForUpdates();
  if (!update) return false;
  await updater.downloadUpdate(update);
  await updater.installAndRestart(app);
  return true;
}

app.run();
updateNow().catch((error) => {
  console.error("Update failed:", error);
});
```

Checks reject unsigned metadata, wrong app identities, non-HTTPS URLs, downgrades, unexpected fields, oversized responses, and mismatched installer bytes. Downloads are staged under `%LOCALAPPDATA%\NodeViewJS\Updates`; installation waits for the app and launcher to exit, re-verifies the installer, applies it quietly, and restarts the app. Updater events include `checking`, `update-available`, `update-not-available`, `update-downloaded`, `update-installing`, and `updater-error`.

## Basic usage

Backend:

```js
const path = require("node:path");
const { App } = require("nodeviewjs");

const app = new App({
  title: "My App",
  width: 900,
  height: 600,
  startupTiming: false,
  entry: path.join(__dirname, "index.html")
});

app.command("greet", async (name) => {
  return `Hello ${name || "there"} from NodeViewJS`;
});

app.run();
```

Enable lightweight startup timing while tuning launch performance:

```js
const app = new App({
  entry: "index.html",
  startupTiming: true
});
```

Frontend:

```html
<input id="name" />
<button id="greet">Greet</button>
<p id="output"></p>

<script>
  const nameInput = document.querySelector("#name");
  const greetButton = document.querySelector("#greet");
  const output = document.querySelector("#output");

  greetButton.onclick = async () => {
    output.textContent = await NodeViewJS.invoke("greet", nameInput.value);
  };
</script>
```

The frontend does not need to include a bridge script. NodeViewJS provides `window.NodeViewJS` automatically.

`window.NodeView` is retained as a compatibility alias. New applications should use `window.NodeViewJS`.

## How the bridge is loaded

During portable packaging, NodeViewJS writes the bridge to `resources/app/__nodeview/bridge.js` and adds a relative external script reference to every copied `.html` file. Your source HTML is never changed. This avoids requiring `unsafe-inline`; WebView2 file pages can use a policy such as `script-src file:` while the native host limits resources to the app root. Packaged apps set an internal marker so the native host skips document-start script injection and navigates directly to the prepared HTML.

The bridge starts as normal editable JavaScript in:

```text
runtime/bridge.js
```

Development mode retains native document-start injection so live reload works without creating or modifying generated HTML beside your source. The same bridge remains embedded in the native addon as a development fallback.

The startup flow is:

```text
Node app starts
  -> native window opens
  -> WebView2 is created
  -> packaged HTML file is loaded directly
  -> its embedded NodeViewJS bridge starts during parsing
```

This is fast because:

- there is no local HTTP server;
- packaging performs the HTML rewrite once instead of at app startup;
- packaged native startup skips bridge registration;
- app pages load directly from local files.

Only files copied into the package are prepared. HTML generated dynamically after packaging must provide its own frontend bridge if it is used as a top-level app page.

For best startup speed, keep app startup work light before `app.run()`, avoid scanning large folders during launch, and lazy-load heavy data after the window is visible.

## Backend API

### `new App(options)`

Common options:

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
  frameOnHover: false,
  closable: true,
  minimizable: true,
  maximizable: true,
  center: true,
  maximized: false,
  alwaysOnTop: false,
  closeToHide: false,
  transparent: false,
  tray: false,
  menu: null,
  singleInstance: false,
  devtools: false,
  startupTiming: false,
  icon: "assets/icon.ico",
  entry: "index.html",
  permissions: ["fs:read"]
});
```

`entry` is required and should point to the local HTML file to load.

### App lifecycle

Call `app.run()` once after registering commands, plugins, and backend event handlers. It opens the main window and returns `true`; a secondary launch of a single-instance app returns `false` after forwarding its arguments. Use `app.quit()` to close every window and release native resources.

`app.show()` and `app.hide()` target the main window. Each `AppWindow` also provides `show()`, `hide()`, `reload()`, and `close()` for independent lifecycle control.

### WebView profiles and app data

`appId` identifies persistent web-view data for the app and defaults to `title`. Windows profiles are stored under `%LOCALAPPDATA%\NodeViewJS\<app-id>-<hash>\WebView2`; the macOS app-support path ends in `WebKit`. Keep `appId` stable across releases so the same profile is reused. Existing `.nodeview-webview` folders are left untouched and can be removed after confirming the new profile works.

Application JSON settings use the separate [Config helper](#config-helper), which stores files in the user's application-data directory by default.

### Window options and controls

Set `transparent: true` to make the WebView canvas and native client area fully transparent. Transparent pixels in the page then reveal windows behind the app, while opaque CSS backgrounds remain opaque. The standard Windows frame remains visible, partial opacity is not supported, and the reserved color `rgb(1, 0, 1)` should not be used in page content because Windows uses it internally as the transparency key.

Set `closeToHide: true` if clicking the window close button should hide the window instead of quitting the app. `app.quit()` still closes the app fully.

On Windows, set `frame: false` to hide the native title bar, system menu, and caption buttons. Set `frameOnHover: true` to reveal that native frame when the pointer reaches the top edge and hide it again when the pointer leaves. Enabling `frameOnHover` automatically sets `frame` to `false`, including when `frame: true` was supplied. Without `frameOnHover`, the window remains frameless. The `closable`, `minimizable`, and `maximizable` options independently control native window actions when the frame is visible. `closable: false` blocks the native close action, but `window.close()` and `app.quit()` remain available to backend code.

```js
const app = new App({
  entry: "index.html",
  frameOnHover: true
});
```

Runtime window controls are available through `app.mainWindow` and every window returned by `app.createWindow()`:

```js
const window = app.mainWindow;

window.minimize();
window.maximize();
window.restore();
window.setFullscreen(true);
window.setFullscreen(false);
window.setTitle("Updated title");
window.setSize(960, 640);
window.setPosition(100, 80);

console.log(window.getState());
```

### Windows taskbar integration

Windows taskbar progress, overlay icons, and attention requests are available after `app.run()`:

```js
app.setTaskbarProgress(0.65, "normal"); // normal, paused, error, or indeterminate
app.setTaskbarOverlay("assets/badge.ico", "New messages");
app.requestAttention("informational"); // informational, critical, or stop

app.setTaskbarProgress(null); // clear progress
app.setTaskbarOverlay(null);  // remove overlay
app.requestAttention("stop");
```

The same methods are available on each `AppWindow`. Progress values range from `0` to `1`, and taskbar overlay images must be existing `.ico` files.

### Custom title bars

For a custom title bar, register a permission-gated backend command and call `startDrag()` when the user presses its draggable area:

```js
app.command("window:startDrag", {
  permission: "window:control"
}, () => {
  app.mainWindow.startDrag();
});
```

The frontend can call `NodeViewJS.invoke("window:startDrag")`. Keep an explicit close control wired to trusted backend code, such as an app command that schedules `app.mainWindow.close()` after returning its response.

When using `closeToHide`, you can bring the window back with:

```js
app.show();
```

You can also hide it manually:

```js
app.hide();
```

### Single-instance applications

On Windows, set `singleInstance: true` to prevent a second backend and window from opening for the same `appId`:

```js
const app = new App({
  appId: "com.example.my-app",
  entry: "index.html",
  singleInstance: true
});

app.on("second-instance", ({ args, cwd }) => {
  console.log("Launched again with:", args);
  console.log("Working directory:", cwd);
});

const primary = app.run();
```

The primary `app.run()` returns `true`. A duplicate launch returns `false`, opens no window, forwards its arguments in the background, and exits naturally once delivery finishes. Do not force the duplicate process to exit immediately after `app.run()` because that would interrupt delivery.

The existing primary window is restored and shown before `second-instance` handlers run. `args` contains command-line values after the Node entry file, and packaged executables forward their own arguments into the same array. The stable `appId` identifies the instance lock. Messages are validated and limited to 64 KiB.

### Deep links and file associations

Configure the same protocols and extensions in the app during development. Packaged apps receive these values automatically from the `nodeviewjs` package configuration:

```js
const app = new App({
  appId: "com.example.my-app",
  entry: "index.html",
  singleInstance: true,
  protocols: ["my-app"],
  fileAssociations: [".myapp"]
});

app.on("open-url", ({ url, initial }) => {
  console.log("Open URL:", url, { initial });
});

app.on("open-file", ({ path, initial }) => {
  console.log("Open file:", path, { initial });
});

app.run();
```

`initial` is `true` when the URL or file started the primary process and `false` when it arrived from a later launch. File paths are resolved to absolute paths using the launching process's working directory. Use `singleInstance: true` when later launches should be routed into the existing app.

Custom schemes use lowercase letters, numbers, `+`, `.`, or `-`; `file`, `http`, `https`, and `mailto` cannot be claimed. File extensions must begin with a dot and use lowercase letters, numbers, or hyphens after normalization. Metadata is validated during development and packaging. Portable folders do not modify Windows registration by themselves—the per-user installer performs registration and uninstallation.

### Multiple windows

Create additional independent windows before or after `app.run()`:

```js
const settingsWindow = app.createWindow({
  title: "Settings",
  width: 560,
  height: 420,
  entry: "settings.html"
});

settingsWindow.on("settings-saved", (settings) => {
  console.log(settings);
});

app.run();
```

Unspecified secondary-window options inherit from the main window. Each window has its own native window, WebView, IPC handler, event methods, menus, and runtime window controls including `show()`, `hide()`, `reload()`, `close()`, `minimize()`, `maximize()`, `restore()`, `setFullscreen()`, `setTitle()`, `setSize()`, `setPosition()`, `startDrag()`, `setMenu()`, `showContextMenu()`, and `getState()`. `app.emit()` broadcasts to every open window, while `window.emit()` targets one window. `app.quit()` closes all windows.

### System tray

Add a basic system tray icon with:

```js
const app = new App({
  title: "My App",
  entry: "index.html",
  closeToHide: true,
  tray: {
    title: "My App",
    icon: "assets/app.ico"
  }
});
```

The tray icon uses a simple native menu with Show and Quit. Double-clicking the tray icon shows the app window.

### Native application menus

Windows application menus use declarative templates. Items contain bounded string IDs and emit events; templates cannot execute native commands or callbacks directly:

```js
const app = new App({
  entry: "index.html",
  menu: [
    {
      label: "File",
      submenu: [
        { id: "file.open", label: "Open", accelerator: "Ctrl+O" },
        { type: "separator" },
        {
          id: "file.autosave",
          label: "Auto save",
          type: "checkbox",
          checked: true
        }
      ]
    }
  ]
});

app.on("menu", ({ id, checked, window }) => {
  if (id === "file.open") {
    console.log("Open selected", window.id);
  }
  if (id === "file.autosave") {
    console.log("Auto save:", checked);
  }
});
```

Use `app.setMenu(template)` for the main window or `window.setMenu(template)` for another window. Passing `null` removes its application menu. Supported item types are `normal`, `checkbox`, `separator`, and nested `submenu`. Templates are limited to 256 items and eight levels; IDs and accelerators must be unique.

Show a context menu at the cursor or at client-area coordinates:

```js
app.mainWindow.showContextMenu([
  { id: "edit.copy", label: "Copy", accelerator: "Ctrl+C" },
  { id: "edit.delete", label: "Delete" }
]);

app.mainWindow.showContextMenu(contextItems, { x: 40, y: 80 });
```

Context selections emit the same backend `menu` event. If the WebView requests a context menu, route that request through a registered command requiring `window:control`; native menu APIs remain backend-only. Accelerators support Ctrl, Alt, Shift, letters, numbers, F1–F24, and common navigation keys.

### `app.command(name, handler)`

Registers a backend command callable from the frontend:

```js
app.command("ping", async () => "pong");
```

### `app.command(name, options, handler)`

Registers a command with permission metadata:

```js
const app = new App({
  entry: "index.html",
  permissions: {
    allow: ["fs:*", "dialog:open:settings"],
    deny: ["fs:write"]
  }
});

app.command("readConfig", {
  permission: "fs:read",
  scope: "config"
}, async () => {
  return { theme: "dark" };
});
```

Permission arrays such as `permissions: ["fs:read"]` remain supported as simple allow-lists. Policy objects add deny rules; deny entries always take precedence over allow entries.

Use a known group such as `fs:*` or `dialog:*` in an app policy to grant that permission family. Add a scope after a permission, such as `dialog:open:settings`, to grant one named resource scope. Commands can use `permission` with `scope`, or require several permissions:

```js
app.command("readSettings", {
  permissions: ["fs:read:config", "dialog:open:settings"]
}, handler);
```

Every command requirement must be allowed and not denied. Permission groups and wildcard scopes are accepted only in app policies, never as command requirements.

Command and event names must be non-empty strings. Invoking a command that the backend did not register rejects with an `Unknown command` error.

### `app.use(plugin, options)`

Backend plugins register namespaced commands and events without exposing Node.js to the frontend:

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

The frontend calls `NodeViewJS.invoke("example.settings:read")` and emits or listens to events such as `example.settings:refresh` and `example.settings:ready`. Plugin names must be lowercase dot-or-hyphen identifiers. Setup, start, stop, and cleanup hooks are synchronous; setup is transactional and runs before `app.run()`.

Every plugin permission must be granted by the app policy, and each plugin command can require only permissions declared by that plugin. These declarations control host admission and frontend command routing; backend plugin modules are trusted Node.js code and are not an operating-system sandbox. Plugins are loaded explicitly by backend code, never from the WebView.

Current permission names:

- `fs:read`
- `fs:write`
- `dialog:open`
- `dialog:save`
- `clipboard:read`
- `clipboard:write`
- `shell:open`
- `notification:show`
- `window:control`

### Shell API

The Windows backend can open a validated external URL or an existing local path:

```js
const { App, shell } = require("nodeviewjs");

const app = new App({
  entry: "index.html",
  permissions: ["shell:open"]
});

app.command("openWebsite", {
  permission: "shell:open"
}, ({ url }) => {
  return shell.openExternal(url);
});

app.command("showExport", {
  permission: "shell:open"
}, ({ file }) => {
  return shell.openPath(file);
});
```

`shell.openExternal(url)` accepts only absolute `http:`, `https:`, and `mailto:` URLs without embedded credentials. `shell.openPath(path)` resolves the path and rejects it unless the file or directory already exists. Both methods return `true` after Windows accepts the launch request and throw a descriptive error otherwise.

The `shell` helper is trusted backend code and is not exposed directly to the WebView. Frontend access must go through a registered command with the `shell:open` permission. NodeViewJS does not provide an arbitrary command or shell-execution method.

### Clipboard API

The Windows backend can read and write Unicode text:

```js
const { App, clipboard } = require("nodeviewjs");

const app = new App({
  entry: "index.html",
  permissions: ["clipboard:read", "clipboard:write"]
});

app.command("clipboard:read", {
  permission: "clipboard:read"
}, () => clipboard.readText());

app.command("clipboard:write", {
  permission: "clipboard:write"
}, ({ text }) => clipboard.writeText(text));
```

`clipboard.readText()` returns the current Unicode text, or an empty string when the clipboard does not contain text. `clipboard.writeText(text)` returns `true` after writing the text. Null characters are rejected because the Windows clipboard text format is null-terminated.

The helper is trusted backend code and is not exposed directly to the WebView. Frontend access should use registered commands with `clipboard:read` or `clipboard:write`; an app policy can grant both using `clipboard:*`.

### Events

Backend:

```js
app.on("ready", payload => {
  console.log(payload);
});

app.once("first-open", payload => {
  console.log(payload);
});

app.emit("theme-changed", {
  theme: "dark"
});

const onStatus = (status) => console.log(status);
app.on("status", onStatus);
app.off("status", onStatus);
```

Frontend:

```js
NodeViewJS.emit("ready", {
  page: "home"
});

NodeViewJS.on("theme-changed", data => {
  console.log(data.theme);
});

const off = NodeViewJS.once("saved", data => {
  console.log("Saved:", data);
});

off(); // cancel before the event, when needed
```

`app.emit()` broadcasts to every window. Use `app.mainWindow.emit()` or another `AppWindow.emit()` to target one window. `on()`, `once()`, and `off()` are available on both `App` and `AppWindow`; frontend `on()` and `once()` return unsubscribe functions.

## Runtime helpers

NodeViewJS exports:

```js
const {
  App,
  AppWindow,
  Updater,
  clipboard,
  config,
  dialog,
  ipc,
  notification,
  shell
} = require("nodeviewjs");
```

### Dialog helpers

Show a native message or ask the user to select an existing file or save destination:

```js
const { dialog } = require("nodeviewjs");

dialog.message({ title: "My App", message: "Finished loading." });

const sourcePath = dialog.openFile();
const destinationPath = dialog.saveFile();
```

File helpers return the selected absolute path, or `null` when the user cancels. The save dialog asks before replacing an existing file.

### Config helper

`runtime/config.js` provides small JSON read/write helpers for app settings.

```js
const { config } = require("nodeviewjs");

const settings = await config.read({
  appName: "MyApp",
  fileName: "settings.json",
  defaults: { theme: "light" }
});

await config.write({
  appName: "MyApp",
  fileName: "settings.json",
  data: { theme: "dark" }
});
```

Config file names must be simple `.json` file names, not arbitrary paths. By default, files are stored under the current user's application-data directory rather than beside the executable. A trusted backend may supply an explicit `directory` option.

### IPC helpers

The exported `ipc` object contains the versioned message parser, serializer, response/event constructors, validation helpers, and protocol limit constants used by the backend runtime. These helpers accept or return serialized protocol data; they do not register commands or expose backend privileges to the WebView.

Use `app.command()`, `app.on()`, and `app.emit()` for application IPC. Direct use of `ipc` is intended for protocol adapters and tests that need the same strict size, schema, name, depth, and node validation as the runtime.

### Notification helper

`notification.show()` displays a basic native Windows notification:

```js
const { notification } = require("nodeviewjs");

notification.show({
  title: "My App",
  message: "Finished loading."
});
```

Dialog and notification helpers are trusted backend APIs and are not exposed directly to the WebView. Frontend-triggered use should go through registered commands requiring the relevant `dialog:open`, `dialog:save`, or `notification:show` permission.

## Project structure

```text
nodeviewjs/
  bin/
    nodeviewjs.js
  examples/
    basic/
      app.js
      index.html
  runtime/
    app.js
    bridge.js
    clipboard.js
    config.js
    dialog.js
    updater.js
    notification.js
    index.js
    ipc.js
    native.js
  scripts/
    build.js
    package-inputs.js
    package-integrity.js
    package-portable.ps1
    package-installer.ps1
  src-nodeview/
    binding.gyp
    include/
    src/
      addon.cpp
      launcher.cpp
      linux.cpp
      macos.mm
      webview.cpp
      window.cpp
  test/
    bridge-integration.js
    package-input-security.js
    package-integrity.js
    runtime-api.js
    security-corpus.js
  .github/
    workflows/
      ci.yml
  LICENSE
  PLAN.md
  README.md
  SECURITY.md
```

## Tests

Full unit, packaging, and CLI regression suite:

```powershell
npm test
```

Windows dependency audit, warning-as-error native analysis, PE hardening, adversarial package checks, and installer smoke:

```powershell
npm run security:gate
```

Focused live native integration tests:

```powershell
npm run test:bridge
npm run test:multi-window
npm run test:trusted-document
npm run test:webview-capabilities
```

Live integration tests open native WebView windows briefly. `npm run test:installer` performs a per-user package, install, launch, replacement, rollback, and uninstall smoke test on Windows.

## Troubleshooting

### `node-gyp` cannot find Visual Studio

Install Visual Studio Build Tools 2022 and include the `Desktop development with C++` workload.

Visual Studio 2017 is not enough for newer Node versions. For example, Node.js 25 requires a newer supported MSVC toolchain.

### `node-gyp` cannot find Python

Set the `PYTHON` environment variable:

```powershell
$env:PYTHON = "C:\Users\robert\AppData\Local\Programs\Python\Python312\python.exe"
npm run build
```

### WebView2 initialization fails

Make sure Microsoft Edge WebView2 Runtime is installed. Also check that `%LOCALAPPDATA%\NodeViewJS` is writable because WebView2 stores its per-app profile there.

### Portable app opens and closes immediately

Check:

```text
build/portable/NodeViewDemo/resources/NodeViewDemo.log
```

The portable launcher writes Node runtime output there. If you change the package name, the log file uses the app name, for example `resources/MyApp.log`.

### App entry file cannot be loaded

Use an absolute or correctly resolved local file path for `entry`:

```js
entry: path.join(__dirname, "index.html")
```

## Security model

See [SECURITY.md](SECURITY.md) for vulnerability reporting, the threat model, current guarantees and limitations, and the security verification matrix.

NodeViewJS intentionally avoids exposing Node.js directly to the frontend.

Do not do this:

```js
window.require = require;
```

Use registered commands instead:

```js
app.command("loadData", async payload => {
  // validate payload here
  return result;
});
```

The frontend can only call commands that the backend registers.

Top-level WebView navigation is restricted to local files inside the configured `entry` file's directory. Remote URLs and local files outside that directory are blocked and logged to stderr.

On Windows, `window.NodeViewJS` is created only in the top-level document. Native IPC also verifies that each message came from the current canonical local document under the configured app root; child frames, outside-root files, unexpected origins, and stale pages cannot invoke backend commands or emit backend events. macOS and Linux parity for this boundary is deferred.

Windows also permits WebView resources only from the local app root. Remote fetches, images, scripts, and frame content receive blocked responses; popups, downloads, permission prompts, external URI schemes, and packaged DevTools are denied. WebView2 may initiate a remote frame request before cancellation, so sensitive values must not be placed in remote frame URLs. macOS and Linux parity is deferred.

IPC requires protocol version 1 and exact message schemas. Messages are limited to 256 KiB, 32 levels, 10,000 payload nodes, and 128-character command/event names; each window allows 64 active calls, applies a 30-second timeout, and rejects duplicate or recently replayed request IDs. Windows enforces the limit at the native forwarding boundary as well as in JavaScript; macOS and Linux native parity is deferred.

## Useful commands

```powershell
npm run build
npm start
npm run dev
npm run test:runtime
npm run test:native-lifecycle
npm run test:bridge
npm run test:installer
npm run test:updater
npm run test:plugins
npm run test:platform
npm run security:gate
npm run package
npm run package:installer
npm run package:macos
npm run package:linux
npm run update:manifest -- https://updates.example.com/MyApp-1.2.0-setup.exe
npx nodeviewjs package
npx nodeviewjs installer
npx nodeviewjs update-manifest https://updates.example.com/MyApp-1.2.0-setup.exe
```

Run `npm run security:gate` before a Windows release. It audits production dependencies, performs a warning-as-error MSVC analysis build, runs malformed-input and package-tamper tests, and exercises installer creation, installation, launch, and uninstall. Follow [SECURITY-CHECKLIST.md](./SECURITY-CHECKLIST.md) for signing and privileged-API review.

## Roadmap

See [PLAN.md](./PLAN.md) for the full implementation plan and improvement roadmap.
