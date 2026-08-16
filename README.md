# NodeViewJS

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

NodeViewJS lets you build desktop applications with Node.js and web technologies using the system WebView, without bundling Chromium or exposing Node.js directly to page JavaScript.

## Why it exists

Desktop web runtimes usually ship a browser engine per app and then spend their security budget fencing the page off from Node.js. NodeViewJS takes the other route:

- **System WebView, not bundled Chromium.** WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux. Apps stay small and inherit the OS engine's updates.
- **An explicit backend command bridge.** Pages call named commands. There is no `require()`, no Node.js globals, and no arbitrary shell execution in the WebView.
- **Permission-aware IPC.** Every command can declare required permissions; the app policy is the ceiling and a per-window policy can narrow it further. Deny always beats allow.
- **Native packaging and updates.** Portable folders, a per-user Windows installer, macOS `.app`/DMG, Linux folders, integrity-verified launchers, and Ed25519-signed updates.
- **Security boundaries documented from the start.** What is guaranteed, and what is not, is written down in [SECURITY.md](SECURITY.md) and the [Security Model](wiki/Security-Model.md).

## Platform status

Maturity differs by platform, and the labels below track what is actually verified rather than what compiles.

| Platform | Status | What that means |
| --- | --- | --- |
| Windows 10/11 (x64) | **Hardened / primary** | Native build, live WebView2 bridge, IPC security, multi-window, menus, tray, taskbar, notifications, packaging, installer, integrity, and the security gate all pass locally and in CI. |
| macOS 12+ | **Experimental / validation ongoing** | Compiles and packages; trusted-document checks, capability lockdown, native IPC limits, package containment, and integrity verification do not yet have Windows parity. |
| Linux (GTK 3 + WebKitGTK 4.1) | **Experimental / validation ongoing** | Compiles and packages; the same parity gaps as macOS apply. |

Independent macOS and Linux reports are welcome — see [PLATFORM-TESTING.md](PLATFORM-TESTING.md). Per-platform gaps are listed in [Known Limitations](wiki/Known-Limitations.md).

`v0.1.0` has not been tagged or published. Installing today builds the native host from source, so a compiler toolchain is required. The prebuilt-binary install path — download, checksum verification against digests that ship inside the package, and source fallback — is implemented and tested; what remains is publishing the artifacts. See [Packaging and Distribution](wiki/Packaging-and-Distribution.md).

## Install

```powershell
npm install github:0trebor0/NodeViewJS
npx nodeviewjs create MyApp
cd MyApp
npm install
npm run dev
```

Requirements: Node.js 20 or newer, Python 3, and the platform build tools listed in [Getting Started](wiki/Getting-Started.md). On Windows, `setup.bat` installs anything missing through `winget`.

If anything goes wrong, ask the machine what it is missing:

```powershell
npx nodeviewjs doctor
```

It checks the Node.js version, native addon, Python 3, C++ toolchain, system WebView runtime, and packaging prerequisites, and prints the exact install command for each failure.

## A 30-second app

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

app.command("greet", (name) => {
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("name must be a non-empty string.");
  }
  return `Hello ${name} from NodeViewJS`;
});

app.run();
```

`index.html`:

```html
<!doctype html>
<html>
  <body>
    <input id="name" value="World" />
    <button id="greet">Greet</button>
    <p id="output"></p>

    <script>
      document.querySelector("#greet").onclick = async () => {
        const name = document.querySelector("#name").value;
        document.querySelector("#output").textContent =
          await NodeViewJS.invoke("greet", name);
      };
    </script>
  </body>
</html>
```

No bridge `<script>` tag is needed: NodeViewJS provides `window.NodeViewJS` automatically.

## Backend and frontend communication

Commands are request/response. Events are one-way, in both directions, and are buffered until the page is ready.

```js
// Backend
app.command("settings:read", { permission: "fs:read", scope: "config" }, async () => {
  return { theme: "dark" };
});

app.emit("theme-changed", { theme: "dark" }); // every live window
app.mainWindow.emit("focus-search");          // one window

app.on("page:opened", ({ page }) => console.log("Opened:", page));
```

```js
// Frontend
const settings = await NodeViewJS.invoke("settings:read");

const off = NodeViewJS.on("theme-changed", ({ theme }) => {
  document.documentElement.dataset.theme = theme;
});

NodeViewJS.emit("page:opened", { page: "home" });
off();
```

TypeScript declarations for the whole public API ship with the package, so this is fully typed without installing anything extra.

## What you get

| Area | Summary |
| --- | --- |
| Windows and UI | Multiple independent windows, custom or native frames, Windows 11 title-bar colors, transparency, native and context menus, system tray, taskbar progress/overlay/attention, notifications |
| IPC | Versioned, schema-checked, size-bounded commands and events with per-window request state |
| Permissions | Ten command permissions with groups, scopes, deny rules, and per-window narrowing |
| Backend helpers | Constrained shell open, clipboard, dialogs, notifications, AppData JSON config, and an origin-allowlisted HTTP client |
| Plugins | Trusted backend plugins with namespaced commands and events, declared permissions, and transactional setup |
| Packaging | Portable folders, per-user Windows installer, macOS `.app`/DMG, Linux folders, integrity manifests, Authenticode and Developer ID signing |
| Updates | Ed25519-signed manifests, HTTPS downloads, transactional install, rollback, and restart |

## Security model in one paragraph

The page is untrusted; the Node.js backend is trusted. The WebView gets no `require()`, no Node.js globals, and no direct native-addon access — only the commands the backend registers, gated by permissions that are checked before the handler runs. IPC is versioned, schema-exact, and bounded in size, depth, and rate. The WebView cannot reach the network at all; outbound HTTP goes through a backend command holding `net:fetch`, restricted to an explicit origin allowlist that is re-checked on every redirect hop. Packaged Windows apps verify every shipped file against an integrity manifest embedded in the launcher before Node starts. Backend code and plugins are trusted: NodeViewJS is not an OS sandbox for them, and command handlers must still validate their own payloads. Full detail and the current guarantee matrix are in [SECURITY.md](SECURITY.md).

## Documentation

- [Getting Started](wiki/Getting-Started.md) — requirements, project setup, CLI, development, build
- [Frontend Bridge](wiki/Frontend-Bridge.md) — commands, events, readiness, payload rules, bridge loading
- [Backend API](wiki/Backend-API.md) — app and window options, permissions, menus, tray, taskbar, helpers, plugins
- [Lifecycle](wiki/Lifecycle.md) — startup and shutdown order, window states, and what happens when a callback throws
- [Windows and Multiple Windows](wiki/Windows-and-Multiple-Windows.md)
- [Packaging and Distribution](wiki/Packaging-and-Distribution.md) — portable, installer, macOS, Linux, signing, updates
- [Security Model](wiki/Security-Model.md) and [Known Limitations](wiki/Known-Limitations.md)
- [Testing](wiki/Testing.md) — unit, native, bridge, packaging, and security suites
- [Troubleshooting](wiki/Troubleshooting.md)
- [The starter app](examples/basic) — the canonical sample, and exactly what `nodeviewjs create` generates
- [The Tasks app](examples/tasks) — a small real application used to dogfood the API: two windows, narrowed per-window permissions, persistence, menu, tray, and updates
- [Single-page guide](docs/index.html) — the same material in one HTML file
- [PLAN.md](PLAN.md) — roadmap and improvement plan

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and [AGENTS.md](AGENTS.md) for the engineering rules this repository enforces.

```powershell
npm install
npm run build
npm test
```

`npm test` covers the runtime, IPC, packaging, and CLI suites. `npm run test:full` adds the live WebView and native UI suites and needs an interactive Windows desktop session. `npm run security:gate` is required before a Windows release. Details are in [Testing](wiki/Testing.md).

macOS and Linux verification reports are the most useful contribution right now: follow [PLATFORM-TESTING.md](PLATFORM-TESTING.md) and open an issue titled `[Platform test]: <platform and version>`.

## License

MIT — see [LICENSE](LICENSE).
