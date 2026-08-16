# Getting Started

## Requirements

- Node.js 20 or newer
- npm
- Python 3, discoverable by `node-gyp`
- Windows 10 or newer: Visual Studio 2022 Build Tools with Desktop development with C++, and the Microsoft Edge WebView2 Runtime
- macOS 12 or newer: Xcode command-line tools with the macOS SDK
- Linux: GTK 3 and WebKitGTK 4.1 development/runtime packages, and `pkg-config`

NodeViewJS installs its native host in one of two ways. If the release publishes
a prebuilt binary for your platform, `npm install` downloads and verifies it and
no compiler is needed. Otherwise it compiles from source, which needs the
toolchain listed above.

**No prebuilt binaries are published yet**, so every install currently compiles.
The install path itself is in place and tested; what remains is publishing the
artifacts. See [[Packaging and Distribution]] for how verification works and what
a maintainer publishes.

To force a source build even when a binary is available:

```powershell
$env:NODEVIEW_BUILD_FROM_SOURCE = "1"
npm install
```

On Ubuntu 24.04:

```bash
sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config
```

The build script downloads and stages the WebView2 SDK into `vendor/` when
needed.

On Windows, `setup.bat` in the repository root installs any missing prerequisite through `winget` and then runs `npm install`. Use `setup.bat /check` to report what is missing without changing anything, or `setup.bat /deps` to install prerequisites without running `npm install`. Open a new terminal after anything is installed so `PATH` updates are visible.

To install manually, or on macOS and Linux:

```powershell
npm install
npm run setup
```

To check a machine before or after installing, run:

```powershell
npx nodeviewjs doctor
```

It reports the Node.js version, native addon state, Python 3, C++ toolchain,
system WebView runtime, and packaging prerequisites, and prints the install
command for anything missing.

If `node-gyp` cannot find Python, install it or set `PYTHON` before building:

```powershell
winget install Python.Python.3.12
$env:PYTHON = "C:\Path\To\Python\python.exe"
npm run build
```

## Create an application

```powershell
npx nodeviewjs create MyApp
cd MyApp
npm install
npm run dev
```

This generates the canonical starter: a small notes application that exercises
the recommended architecture end to end — window creation, a declared permission
policy, one validated backend command per privileged operation, a
backend-to-frontend event, a native menu, packaging configuration, error
handling, and a commented update stub showing where `Updater` is wired in.

The same application lives in the repository at `examples/basic`, runs with
`npm start`, and is what the packaging smoke test exercises. It is the one
sample to read; the snippets elsewhere in these pages are extracts, not
alternatives.

For the smallest possible application, install NodeViewJS and create two files.

`app.js`:

```js
"use strict";

const path = require("node:path");
const { App } = require("nodeviewjs");

const app = new App({
  title: "My App",
  appId: "com.example.my-app",
  width: 900,
  height: 600,
  entry: path.join(__dirname, "index.html")
});

app.command("greet", (name) => {
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("name must be a non-empty string.");
  }
  return `Hello ${name}`;
});

app.run();
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>My App</title>
  </head>
  <body>
    <button id="greet">Greet</button>
    <p id="output"></p>
    <script>
      document.querySelector("#greet").addEventListener("click", async () => {
        try {
          document.querySelector("#output").textContent =
            await NodeViewJS.invoke("greet", "World");
        } catch (error) {
          document.querySelector("#output").textContent = error.message;
        }
      });
    </script>
  </body>
</html>
```

## Configure the app package

Packaging and launch registration read a `nodeviewjs` block from your project's
`package.json`:

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
    "secretWarnings": true,
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
  }
}
```

- `name` becomes the portable folder name and exe name.
- `appId` is the stable identity used for app data, notifications, and signed updates.
- `entry` is your backend app entry file.
- `icon` is an optional Windows `.ico` used as the window/taskbar and exe icon.
- `macIcon` is an optional macOS `.icns` bundle icon.
- `protocols` registers custom URL schemes in the per-user Windows installer.
- `fileAssociations` registers extensions with Windows Open With and Default Apps.
- `include` copies extra files or folders into `resources/app`.
- `exclude` removes files or folders from the bundle.
- `secretWarnings` defaults to `true` on Windows; set `false` to disable redacted credential-pattern warnings.
- `metadata` sets Windows version metadata when the launcher is built.

On Windows, `entry`, `icon`, `include`, and `exclude` values must be relative and
traversal-free. Packaging rejects inputs or destinations containing symbolic
links, junctions, or other reparse-point escapes.

## Development

```powershell
npm run dev
```

Development mode enables DevTools, startup timing, and backend error reporting,
and watches the entry file's directory so the WebView reloads when frontend
`.html`, `.css`, or `.js` files change. Generated folders such as `node_modules`,
`build`, and `.nodeview-webview` are ignored. Frontend reloads keep the Node.js
backend running — restart dev mode after changing backend code.

`nodeviewjs dev` manages `NODEVIEW_DEVTOOLS`, `NODEVIEW_DEV_WATCH`, and
`NODEVIEW_STARTUP_TIMING` internally. Packaged apps ignore inherited values for
those, and packaged Windows apps disable DevTools even when `devtools: true` is
set.

## CLI commands

```powershell
nodeviewjs create MyApp
nodeviewjs doctor
nodeviewjs setup
nodeviewjs build
nodeviewjs start app.js
nodeviewjs dev app.js
nodeviewjs package
nodeviewjs installer
nodeviewjs update-manifest https://updates.example.com/MyApp-1.2.0-setup.exe
nodeviewjs --help
```

The CLI does not need to be installed globally: npm finds `nodeviewjs` in
`node_modules/.bin` when it is run from an npm script.

## Build

```powershell
npm run build
```

The platform-aware `scripts/build.js` entry point prepares the WebView2 SDK on
Windows, generates the native bridge header from `runtime/bridge.js`, builds the
native addon and launcher for the host platform, and stages the outputs into
`build/nodeview/`. Build outputs are ignored by Git.

## Package

```powershell
npx nodeviewjs package
```

See [[Packaging and Distribution]] for installers, signing, and updates.

## TypeScript

Type declarations ship with the package, so `import { App } from "nodeviewjs"`
is typed without installing anything else. For frontend files, reference the
bridge declarations:

```ts
/// <reference path="./node_modules/nodeviewjs/types/bridge.d.ts" />

const answer = await NodeViewJS.invoke<string>("greet", "World");
```
