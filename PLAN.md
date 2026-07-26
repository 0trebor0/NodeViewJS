# NodeViewJS Project Plan

> This project plan and its initial implementation were created with GPT assistance.

## Project Naming

- Project name: `NodeViewJS`
- npm package name: `nodeviewjs`
- Frontend global API: `window.NodeViewJS`
- CLI name: `nodeviewjs`


## Implementation Status

| Plan area | Status | Notes |
| --- | --- | --- |
| Project plan and architecture | Complete | Windows-first design, WebView2 direction, IPC contract, and improvement roadmap are defined below. |
| Phase 1: Native Window | Complete | N-API addon scaffold, Win32 window creation, message loop, and basic example are implemented and build successfully. |
| Phase 2: WebView2 Integration | Complete | WebView2 loads the local entry file, resizes with the window, and the example has been smoke-tested. |
| Phase 3: Native JavaScript Bridge | Complete | The native `window.NodeViewJS` API supports `invoke()`, events, message routing, and command responses. |
| Phase 4: Runtime Wrapper | Complete | `App` supports command registration, events, window options, entry-file resolution, and `run()`. |
| Phase 5: Fit-for-purpose features | Complete | Window controls, icons, DevTools, dialogs, notifications, system tray support, config storage, and open/save file pickers are implemented. |
| Phase 6: Packaging | Complete | Portable app folders and per-user Windows installers include the runtime, app assets, target metadata, and optional embedded icon. Build, launch, install, and uninstall paths are verified. |

## Execution Status

The Windows implementation queues below are complete. macOS and Linux security parity remains deferred. The active release work is tracked separately so implementation status is not confused with external publishing prerequisites.

### Live-Test Diagnostics

| ID | Issue | Status | Evidence / next step |
| --- | --- | --- | --- |
| DBG-01 | Live WebView bridge tests time out inside restricted sandboxes | Resolved | `npm run test:raw-webmessage` uses an isolated temporary WebView2 profile root and opt-in native tracing. Restricted runs can create the controller but cannot complete browser navigation. With normal system access, both injected and embedded bridge paths complete navigation and deliver trusted raw WebMessages; `npm run test:bridge` passes the lifecycle, bridge, and parameter-matrix integrations. |

### Release Queue

| ID | Work item | Status | Completion target |
| --- | --- | --- | --- |
| REL-01 | `v0.1.0` release-candidate audit | CI validation pending | The npm tarball includes the MIT license and intended source/runtime files without build output, tests, secrets, keys, certificates, source maps, or environment files. An isolated tarball install builds native outputs, loads the public API, and runs the installed CLI. The Windows, macOS 14, and Ubuntu 24.04 GitHub Actions jobs are configured; their first run must pass before this item returns to Complete. |
| REL-02 | Sign, tag, and publish `v0.1.0` | Blocked on release configuration | Choose npm, GitHub Releases, or both; configure the required publishing credentials. Any distributed Windows launcher/installer must use a production Authenticode certificate and timestamp. Apps publishing signed update metadata must keep their Ed25519 private key outside the repository. |

### Remaining Runtime Work

| ID | Work item | Status | Completion evidence |
| --- | --- | --- | --- |
| R-01 | Audit roadmap statuses | Complete | Sections 24.1, 24.8, and 24.10 now reflect the implemented module split, event API, and public API. |
| R-02 | Replace singleton native state with instance-owned `NodeViewJSRuntime`, `NativeWindow`, `WebViewHost`, and `IpcBridge` objects | Complete | `NodeViewJSRuntime` owns native windows and their WebView/IPC dependencies; native lifecycle and bridge tests pass. Per-window callback routing is complete in L-01. |
| R-03 | Finish window options, including a precisely defined `transparent` mode | Complete | `transparent` is documented and implemented with a transparent WebView2 canvas plus Win32 color-key client composition. Runtime coverage, native build, and a focused window-render smoke test pass. |
| R-04 | Final runtime hardening and release audit | Complete | Build, runtime, CLI, lifecycle, bridge, portable packaging, packaged launch, npm pack surface, isolated clean install, and production dependency audit all pass. CLI packaging also auto-builds missing native artifacts. |

### Long-Term Queue

| ID | Work item | Status | Dependency / completion target |
| --- | --- | --- | --- |
| L-01 | Multi-window support | Complete | `app.createWindow()` provides independent native windows, WebViews, IPC handlers, targeted events, shared broadcasts, and lifecycle control. The two-window integration test verifies routing and teardown. |
| L-02 | Advanced permission hardening | Complete | Backward-compatible policies support known groups, named scopes, multiple command requirements, per-window narrowing, and deny-first evaluation. Unit and live bridge tests cover allowed and denied paths. |
| L-03 | Embedded executable icon and Windows installer | Complete | Target-specific icon/version resources are compiled into the launcher. `npm run test:installer` verifies package, quiet install, metadata/registration, installed launch, and clean uninstall. |
| L-04 | Auto-update support | Complete | HTTPS-only Ed25519 manifests bind app id, version, URL, size, and SHA-256. The updater rejects downgrades/tampering, stages atomically, re-verifies at handoff, waits for old processes, applies transactionally, restarts, and has focused updater plus installer rollback tests. |
| L-05 | Plugin system | Complete | `app.use()` provides explicit backend-only plugins, namespaced commands/events, host and command permission checks, transactional setup, lifecycle cleanup, immutable metadata, and focused routing/lifecycle tests. |
| L-06 | macOS support | CI validation pending | The macOS 14 CI lane compiles the WKWebView host and Mach-O launcher, packages `.app`/DMG output, and runs unit, live bridge, and multi-window tests. Optional Developer ID signing/notarization remains configuration-dependent. |
| L-07 | Linux support | CI validation pending | The Ubuntu 24.04 CI lane compiles the GTK 3/WebKitGTK 4.1 host and POSIX launcher, packages the portable app folder, and runs unit, live bridge under Xvfb, and multi-window tests. |

Basic file dialogs, notifications, system tray support, and command permissions are already complete and are not duplicated as future work.

### Next Windows Feature Queue

Work proceeds from top to bottom. New APIs must retain safe defaults, remain permission-gated where they expose privileged operating-system behavior, and include runtime plus live integration coverage.

| ID | Work item | Status | Completion target |
| --- | --- | --- | --- |
| W-01 | Shell API | Complete | Permission-gated commands can use backend `shell.openExternal(url)` and `shell.openPath(path)` helpers. URLs are limited to credential-free HTTP, HTTPS, and mailto schemes; paths must exist; native and runtime validation tests cover rejection and routing. |
| W-02 | Runtime window and chrome controls | Complete | Windows supports minimize, maximize, restore, fullscreen, title, size, position, state-query, custom-title-bar drag methods, and Windows 11 native title-bar/text/border colors. `frame: false` hides native chrome; `closable`, `minimizable`, and `maximizable` control native actions while backend close and quit paths remain available. Runtime and native lifecycle tests cover the contract. |
| W-03 | Clipboard API | Complete | Windows backend `clipboard.readText()` and `clipboard.writeText(text)` helpers use Unicode text, reject embedded nulls, retry transient clipboard locks, and support permission-gated frontend commands through `clipboard:read`, `clipboard:write`, or `clipboard:*`. Build, runtime, native validation, and non-destructive read coverage pass; image support stays separate. |
| W-04 | Single-instance applications | Complete | Opt-in `singleInstance` uses a per-app native Windows mutex to suppress duplicate windows, restores and shows the primary window, and delivers validated second-launch arguments plus the working directory through `app.on("second-instance", handler)`. The portable launcher forwards arguments, and native build, lifecycle, race-retry, Unicode, spacing, and real multi-process tests pass. |
| W-05 | Deep links and file associations | Complete | Validated `protocols` and `fileAssociations` metadata is injected into portable apps and registered per user by the Windows installer without overwriting handlers owned by another app. Initial and later launches route absolute file paths and normalized custom URLs through `open-file` and `open-url`; later launches use the single-instance channel. Isolated registry, ownership conflict, runtime routing, packaging, native build, full-suite, installer replacement/rollback, launch, and uninstall cleanup tests pass. |
| W-06 | Native application menus | Complete | Windows supports validated declarative application and context menus with normal, checkbox, separator, and nested submenu items; bounded IDs emit backend `menu` events, accelerator tables route keyboard commands, and no template can execute arbitrary native code. Runtime validation, callback lifecycle, native attachment/removal, real Win32 command dispatch with checkbox state, source boundary, build, and regression tests cover the contract. |
| W-07 | Windows taskbar integration | Complete | `App` and `AppWindow` expose validated taskbar progress states, `.ico` overlay badges, and informational/critical/stop attention requests. Native state, source boundaries, runtime validation, and a live Windows integration test cover the contract. |

### Future Windows Improvements

| ID | Work item | Status | Target |
| --- | --- | --- | --- |
| FW-01 | Hover-revealed native frame | Deferred | Revisit a `frameOnHover`-style option only after the native frame transition can be proven not to blank, resize, or repaint the WebView incorrectly. The replacement needs live visual/integration coverage before it is documented as supported. |

### Security-First Queue

The Windows security queue is complete. Future security changes must preserve deny-by-default behavior, cover JavaScript and native boundaries, and include adversarial regression tests rather than source assertions alone.

macOS and Linux security-parity work is deferred for now, and each cross-platform remainder stays visible rather than being marked complete without evidence.

| ID | Work item | Status | Completion target |
| --- | --- | --- | --- |
| SEC-01 | Threat model and trust-boundary audit | Complete | `SECURITY.md` defines disclosure guidance, supported versions, assets, trusted and untrusted components, current guarantees, explicit limitations, developer rules, and an abuse-case matrix mapping each boundary to existing tests or its next security work item. |
| SEC-02 | Trusted-document and IPC source isolation | Windows complete; parity deferred | Windows exposes the bridge only to the top frame and natively requires sender/current/trusted canonical document equality. Live tests prove local, outside-root, `srcdoc`, and data-URL frames plus stale pagehide IPC cannot reach handlers. macOS/Linux parity is deferred. |
| SEC-03 | Strict IPC validation and resource limits | Windows complete; parity deferred | Windows requires protocol version 1 and exact schemas; bounds messages to 256 KiB, depth to 32, payload nodes to 10,000, names to 128 characters, and active calls to 64 per window. Calls time out after 30 seconds and 1,024 completed IDs are retained against replay. Native, parser/fuzz, bridge, and live malformed/duplicate/concurrency tests pass. macOS/Linux native parity is deferred. |
| SEC-04 | WebView capability and network lockdown | Windows complete; parity deferred | Windows permits app-root resources and denies remote resource responses, remote/outside-root frame content, popups, downloads, permission prompts, external schemes, and packaged DevTools. Live loopback tests cover fetch, image, script, frame, popup, notification permission, blob download, and external navigation attempts. WebView2 may initiate a remote frame request before cancellation; no response content executes. macOS/Linux parity is deferred. |
| SEC-05 | Package-input containment and secret protection | Windows complete; parity deferred | Windows portable and installer inputs require relative traversal-free configuration, canonical project containment, link/reparse-point-free sources and destinations, collision-free output mapping, and safe app names/version filenames. Default exclusions cover environment files, credentials, private-key containers, and source maps; optional redacted secret-pattern warnings scan bounded text files. Hostile path/link tests, the full suite, real CLI packaging/launch, and installer smoke tests pass. macOS/Linux parity is deferred. |
| SEC-06 | Packaged bridge and application integrity | Windows complete; parity deferred | Windows packaging creates a deterministic SHA-256/size manifest for every app and runtime file, embeds the exact manifest into the launcher as a trust anchor, and verifies canonical paths, reparse points, missing/extra files, sizes, and hashes before Node starts. The bridge is an external local script compatible with strict no-inline CSP. Baseline/repeat launch and backend, HTML, bridge, runtime, addon, Node, manifest rewrite, missing/extra file, missing-anchor, and junction tamper tests pass. Authenticode signs the already-bound launcher; signed updates authenticate the installer containing the matching launcher/resources pair. macOS/Linux parity is deferred. |
| SEC-07 | Security release gate | Windows complete; parity deferred | Windows CI runs the repeatable `security:gate`: repository and package-surface secret and hidden-character scanning before and after generated native build files exist, production dependency audit, warning-as-error MSVC analysis, PE hardening verification, malformed IPC/integrity corpora, updater/package-input/package-tamper tests, and installer smoke. `SECURITY-CHECKLIST.md` inventories privileged APIs and blocks releases with high/critical findings or undocumented capabilities. macOS/Linux parity is deferred. |

### Completed artifacts

- `package.json` and `src-nodeview/binding.gyp` define the native addon build.
- `src-nodeview/src/addon.cpp` exports the native Node N-API surface.
- `src-nodeview/src/window.cpp` creates one validated Win32 window and runs its event loop.
- `examples/basic/app.js` exercises the Phase 1 native API.
- `src-nodeview/src/webview.cpp` hosts the WebView2 control and navigates to a local app file.
- `runtime/bridge.js` owns the editable frontend `NodeViewJS` bridge source.
- `scripts/generate-bridge-header.js` embeds the bridge source into `src-nodeview/generated/bridge_script.h` for the native addon.
- `src-nodeview/src/bridge.cpp` exposes the embedded bridge script to the WebView layer.
- `examples/basic/index.html` is rendered by WebView2 without a local HTTP server.
- `window.NodeViewJS` provides the native frontend `invoke()`, `on()`, and `emit()` APIs.
- `runtime/app.js` exposes the developer-facing `App` API and routes IPC commands safely.
- `runtime/app.js` supports optional command permission metadata while keeping the original command registration API.
- `runtime/config.js` provides simple backend JSON config read/write helpers.
- `runtime/ipc.js` owns IPC version checks and backend message formatting.
- `src-nodeview/src/ipc.cpp` owns native WebView message extraction and forwarding to Node.
- WebView native state is grouped in an internal `WebViewState` struct as a first step away from loose globals.
- `NodeViewJSRuntime` owns `IpcBridge` and `WebViewHost`, with IPC injected into the WebView host.
- Window native state is grouped in an internal `WindowState` struct as a first step away from loose globals.
- Window options include opt-in `center`, `maximized`, `alwaysOnTop`, and `closeToHide` support.
- IPC messages require protocol `version: 1`, exact message schemas, bounded JSON structures, and per-window request limits.
- Windows portable builds expose one root executable plus one `resources/` folder containing `app/`, `runtime/`, and the launcher-bound `integrity.manifest`; the runtime log is the only permitted unlisted resource file. Editable runtime modules are bundled into `runtime/nodeview.js`, and the native addon is staged beside it.
- Project commands are wrapped by small scripts so setup, build, dev, clean, and packaging stay easy to run.
- Portable packaging copies the bridge as a local external script, references it from copied HTML, and makes packaged native hosts skip document-start injection; development keeps the in-memory fallback without modifying source HTML.
- Windows maps each app root to a private in-memory `https://app.nodeview.example/` WebView origin, avoiding `file:` unique-origin warnings without DNS, a server, persistence, or access outside the canonical app root.
- The `nodeviewjs` CLI can create starter apps and run setup/build/start/dev/package commands, including packaging external projects from their current working directory.
- Portable packaging reads app name and entry from the target project's `nodeviewjs` block in `package.json`.
- Portable packaging supports `include` and `exclude` config for app assets.
- Portable packaging supports optional `.ico` app window/taskbar icon config.
- Launcher exe metadata is generated from `package.json` and compiled into the Windows version resource.
- `app.show()` and `app.hide()` support restoring windows hidden by `closeToHide`.
- Optional startup timing logs help measure launch overhead during development.
- `notification.show()`, `app.showNotification()`, and `window.showNotification()` display validated AUMID-addressed Windows toast notifications using an app-specific identity and display name, with a legacy notification-area fallback and click-to-restore behavior.
- `tray` app options and `app.setTray()` add a system tray icon with default Show/Quit actions or validated custom menu items, checkboxes, separators, disabled items, submenus, and `tray-menu` events.
- `dialog.openFile()` and `dialog.saveFile()` provide native open/save file pickers.
- Top-level WebView navigation is restricted to the local app directory; remote and outside-file navigations are blocked.
- Native window teardown balances COM, timer, and icon ownership and allows a clean retry after failed window creation.
- `App.run()` cleans up partial startup state and allows retrying the same app instance after configuration errors.
- WebView initialization callbacks are generation-guarded so late async results cannot repopulate state after teardown.
- WebView cookies, cache, and profile data are isolated per app under the user's Local AppData directory.
- Signed update manifests, bounded downloads, atomic staging, transactional installer replacement, and restart handoff provide the Windows auto-update path.
- Backend-only plugins use explicit registration, namespaced bridge surfaces, permission admission, and deterministic lifecycle hooks.
- The Windows backend shell helper opens validated external URLs and existing paths through `ShellExecuteW`; frontend access remains gated by registered `shell:open` commands.
- The Windows clipboard helper reads and writes Unicode text through permission-gated backend commands without exposing native clipboard operations directly to the WebView.
- Opt-in Windows single-instance apps use a native mutex plus bounded local named-pipe messages to focus the primary window and deliver subsequent launch arguments.
- Windows installers register validated custom protocols and file types per user, while runtime launch routing emits `open-url` and `open-file` for cold starts and later single-instance launches.
- Windows application and context menus use bounded declarative templates, native accelerator tables, and backend-only ID events rather than executable menu callbacks.
- The macOS implementation includes a WKWebView host, native launcher, `.app` and DMG packaging, WebKit bridge transport, and multi-window routing; hosted CI validation is pending.
- Linux includes a GTK 3/WebKitGTK 4.1 native host, POSIX launcher, and portable app-folder packager; hosted CI validation is pending. Runtime paths use `XDG_DATA_HOME` (or `~/.local/share`) and isolate WebKitGTK profiles by stable app id.

### Current blocker

There is no active Windows implementation blocker. Release publication is waiting on the selected publishing channel and external credentials; no production signing keys belong in this repository. macOS and Linux security-parity work is intentionally deferred. If `node-gyp` cannot discover Python on a new machine, set `PYTHON` to the installed Python 3 path before building.

## 1. Project Goal

Build a lightweight desktop app runtime using Node.js backend logic and a native system WebView.

The project should let developers build desktop apps using:

- Vanilla HTML, CSS, and JavaScript for the frontend
- Node.js for backend logic
- A native system WebView instead of bundled Chromium
- A simple `invoke()` bridge between frontend and backend
- A small, clean runtime API

The goal is to create a fit-for-purpose runtime for small to medium desktop apps.

---

## 2. Core Idea

### Runtime model

```text
Frontend JavaScript
    ↓ invoke()
Node.js runtime
    ↓ native binding
C++ WebView layer
    ↓
Operating system WebView
```

### Runtime implementation

```text
HTML/CSS/JS frontend → Node.js backend → C++ native WebView
```

---

## 3. Design Principles

1. Keep the frontend simple.
2. Keep the backend in Node.js.
3. Do not bundle Chromium.
4. Use the operating system WebView.
5. Avoid running a local HTTP server.
6. Load local app files directly.
7. Expose a clean runtime API.
8. Keep C++ hidden behind a small Node API.
9. Build only what is needed first.
10. Add frontend bridge scripts automatically during packaging.

---

## 3.1 Native Bridge Decision

NodeViewJS should provide a native-feeling WebView API. Packaging adds the bridge to copied HTML automatically; app pages must not manually include a bridge file.

Preferred frontend API:

```js
NodeViewJS.invoke("commandName", payload);
```

Avoid:

```html
<script src="bridge.js"></script>
```

Also avoid exposing raw Node.js APIs to the frontend:

```js
window.require = require;
```

The native layer should create a safe global object:

```js
window.NodeViewJS
```

This keeps the runtime natural for vanilla JavaScript developers.

---

## 4. Target Platforms

### Phase 1

Windows only.

Use:

- C++
- Node N-API
- WebView2
- Vanilla JavaScript frontend

### Later phases

Possible future platform support:

- macOS using WKWebView
- Linux using WebKitGTK

Cross-platform support should come after the Windows version is stable.

---

## 5. Project Structure

```text
nodeviewjs/
  build/
    native/
    portable/
  package.json
  src-nodeview/
    binding.gyp
    include/
    src/
  examples/
    basic/
      app.js
      index.html
      style.css
  runtime/
    index.js
    app.js
    window.js
    ipc.js
  docs/
    architecture.md
    api.md
    security.md
  vendor/
    webview2/
```

---

## 6. Developer Experience Goal

A developer should be able to create an app like this:

```js
const { App } = require("nodeviewjs");

const app = new App({
  title: "My App",
  width: 900,
  height: 600,
  entry: "index.html"
});

app.command("greet", async (name) => {
  return `Hello ${name || "there"} from Node.js`;
});

app.run();
```

Frontend code:

```html
<input id="name" />
<button id="btn">Greet</button>
<p id="output"></p>

<script>
  btn.onclick = async () => {
    const message = await NodeViewJS.invoke("greet", name.value);

    output.textContent = message;
  };
</script>
```

---

## 7. Runtime API

### App creation

```js
const app = new App({
  title: "My App",
  width: 900,
  height: 600,
  entry: "index.html"
});
```

### Register backend command

```js
app.command("commandName", async (payload) => {
  return result;
});
```

### Start app

```js
app.run();
```

### Send event to frontend

```js
app.emit("event-name", data);
```

### Listen to frontend events

```js
app.on("event-name", handler);
```

---

## 8. Frontend API

The frontend should get one native global object provided by the WebView runtime:

```js
window.NodeViewJS
```

This object should be provided by the runtime automatically. App pages should not manually import, inject, or include a bridge file.

### Invoke backend command

```js
const result = await NodeViewJS.invoke("greet", "Robert");
```

### Listen for backend event

```js
NodeViewJS.on("theme-changed", function (data) {
  console.log(data);
});
```

### Emit frontend event

```js
NodeViewJS.emit("ready", {
  page: "home"
});
```

### Design rule

Application pages should not need this:

```html
<script src="bridge.js"></script>
```

The runtime itself should provide `window.NodeViewJS`.


---

## 9. Native Layer Responsibilities

The C++ layer should only handle native responsibilities.

It should provide:

- Create native window
- Create WebView2 instance
- Load local HTML file
- Provide `window.NodeViewJS` to JavaScript automatically
- Receive WebView messages from the runtime bridge
- Send messages back into WebView JavaScript
- Handle resize events
- Handle close events

The C++ layer should not contain app business logic.

---

## 10. Node Runtime Responsibilities

The Node.js runtime should handle:

- App lifecycle
- Command registry
- Event registry
- Message routing
- JSON serialization
- Error handling
- File path resolution
- Developer-facing API

This keeps the project natural for Node.js developers.

---

## 11. IPC Design

### Frontend to Node

```json
{
  "type": "invoke",
  "id": 1,
  "command": "greet",
  "payload": {
    "name": "Robert"
  }
}
```

### Node to frontend success response

```json
{
  "type": "response",
  "id": 1,
  "ok": true,
  "result": "Hello Robert from Node.js"
}
```

### Node to frontend error response

```json
{
  "type": "response",
  "id": 1,
  "ok": false,
  "error": "Unknown command: greet"
}
```

### Event message

```json
{
  "type": "event",
  "event": "theme-changed",
  "payload": {
    "theme": "dark"
  }
}
```

---

## 12. Security Rules

This project should not expose full Node.js access directly to the frontend.

Avoid this:

```js
window.require = require;
```

Instead, expose only safe commands:

```js
app.command("readConfig", async () => {
  return readConfigFile();
});
```

Security rules:

- No direct `require()` in frontend
- No direct filesystem access from frontend
- No direct shell execution from frontend
- All privileged actions go through registered commands
- Commands should validate input
- Local files should be loaded from the app directory only
- Remote URLs should be disabled by default

---

## 13. MVP Features

The first working version should include:

- Native Windows window
- WebView2 rendering
- Load local `index.html`
- Expose native `window.NodeViewJS` object
- `NodeViewJS.invoke()` from frontend to Node
- Return result from Node to frontend
- Basic error handling
- Window title, width, and height options

MVP example:

```js
const { App } = require("nodeviewjs");

const app = new App({
  title: "Hello NodeViewJS",
  width: 800,
  height: 500,
  entry: "index.html"
});

app.command("hello", async () => {
  return "Hello from Node";
});

app.run();
```

---

## 14. Phase 1: Native Window

Goal:

Create a basic Windows desktop window from a Node native addon.

Tasks:

- Set up Node N-API
- Set up `binding.gyp`
- Create C++ window using Win32 API
- Expose `createWindow()` to Node
- Expose `run()` to Node
- Handle close event

Success criteria:

```js
native.createWindow({
  title: "Test",
  width: 800,
  height: 600
});

native.run();
```

This should open a real native desktop window.

---

## 15. Phase 2: WebView2 Integration

Goal:

Render web content inside the native window.

Tasks:

- Add WebView2 SDK
- Create WebView2 environment
- Create WebView2 controller
- Attach WebView2 to the native window
- Resize WebView2 when the window resizes
- Navigate to local HTML file

Success criteria:

```js
native.createWindow({
  title: "Test",
  width: 800,
  height: 600
});

native.loadFile("index.html");
native.run();
```

This should open a desktop app displaying local HTML.

---

## 16. Phase 3: Native JavaScript Bridge

Goal:

Allow frontend JavaScript to communicate with Node through a native WebView-provided object.

The frontend should call:

```js
NodeViewJS.invoke("greet", "Robert");
```

The frontend should not need to import, inject, or include a bridge file.

Tasks:

- Provide `window.NodeViewJS` from the WebView runtime
- Add `NodeViewJS.invoke(command, payload)`
- Add `NodeViewJS.on(eventName, handler)`
- Add `NodeViewJS.emit(eventName, payload)`
- Capture native WebView messages in C++
- Forward messages from C++ to Node callback
- Send responses from Node back to WebView
- Match responses using message IDs
- Handle rejected command promises cleanly

Success criteria:

Frontend:

```js
NodeViewJS.invoke("greet", "Robert").then(function (message) {
  console.log(message);
});
```

Backend:

```js
app.command("greet", function (name) {
  return "Hello " + (name || "there");
});
```

---

## 17. Phase 4: Runtime Wrapper

Goal:

Hide native complexity behind a clean JavaScript API.

Tasks:

- Create `App` class
- Create command registry
- Create event system
- Add lifecycle handling
- Add path resolver
- Add friendly errors
- Add basic logging

Success criteria:

```js
const { App } = require("nodeviewjs");

const app = new App({
  title: "My App",
  entry: "index.html"
});

app.command("ping", async () => "pong");

app.run();
```

---

## 18. Phase 5: Fit-for-Purpose Features

Only add features that are useful for real small desktop apps.

Priority features:

- App icon
- Window title
- Window size
- Min/max window size
- Resizable option
- DevTools option
- Basic dialog API
- Basic file picker API
- Basic notification API
- System tray support
- Simple config file support

Avoid early:

- Tabs
- Browser-like navigation
- Complex plugin system
- Full browser APIs
- Full Electron compatibility
- Background update services and mandatory update policy
- Complex multi-process architecture

---

## 19. Phase 6: Packaging

Goal:

Package a NodeViewJS app as a normal desktop app.

Tasks:

- Bundle JavaScript files
- Include native addon
- Include Node runtime or use a packager
- Include app assets
- Generate Windows `.exe`
- Generate a per-user Windows installer

Possible tools:

- `pkg`
- `nexe`
- `node-gyp-build`
- `electron-builder` style packaging ideas
- Built-in IExpress packaging with PowerShell install/uninstall scripts

Packaging should be solved after the runtime works.

---

## 20. Example Commands

### Create project

```bash
mkdir nodeviewjs
cd nodeviewjs
npm init -y
npm install node-addon-api
npm install -D node-gyp
```

### Build native addon

```bash
npm run build
```

### Run example app

```bash
node examples/basic/app.js
```

---

## 21. What This Project Should Not Be

This project should not become:

- A full browser
- A full Electron replacement
- A huge plugin ecosystem
- A framework with too many opinions
- A complex multi-process runtime too early

It should be:

```text
A small desktop runtime for Node.js developers.
```

It should not require every frontend page to manually include a bridge script.

---

## 22. Technical Risks

### Risk: WebView2 setup is complicated

Mitigation:

Start with Windows only and keep the native layer small.

### Risk: IPC becomes messy

Mitigation:

Use one JSON message format from the beginning.

### Risk: Frontend gets unsafe Node access

Mitigation:

Never expose raw Node APIs to the frontend.

### Risk: Packaging becomes difficult

Mitigation:

Leave packaging until the core runtime works.

### Risk: Project becomes too broad

Mitigation:

Stick to the MVP until it works well.

---

## 23. MVP Definition

The MVP is complete when this works:

Backend:

```js
const { App } = require("nodeviewjs");

const app = new App({
  title: "NodeViewJS Demo",
  width: 900,
  height: 600,
  entry: "index.html"
});

app.command("greet", async (name) => {
  return `Hello ${name || "there"} from NodeViewJS`;
});

app.run();
```

Frontend:

```html
<input id="name" />
<button id="btn">Greet</button>
<p id="out"></p>

<script>
  btn.onclick = function () {
    NodeViewJS.invoke("greet", name.value).then(function (result) {
      out.textContent = result;
    });
  };
</script>
```

Expected result:

A native desktop window opens, displays local HTML, and the frontend can call Node.js through a safe `invoke()` system.

---

---

## 24. Improvement Roadmap

These improvements should be added after the current working runtime is stable. They are designed to keep NodeViewJS fit for purpose rather than turning it into a full Electron clone.

### 24.1 Split the C++ native layer into focused modules

Status: Implemented. Native window, WebView, bridge source, IPC, launcher, and addon exports live in focused translation units. Runtime object ownership remains tracked separately in 24.2 and 24.3.

The current native layer should be split into smaller files/classes so each part has one job.

Recommended structure:

```text
src-nodeview/
  include/
    app.h
    window.h
    webview.h
    bridge.h
    ipc.h
  src/
    addon.cpp
    app.cpp
    window.cpp
    webview.cpp
    bridge.cpp
    ipc.cpp
```

Responsibilities:

- `window.cpp`: Win32 window creation, sizing, icons, close/minimize/maximize behavior
- `webview.cpp`: WebView2 environment, controller, navigation, resize handling
- `bridge.cpp`: JavaScript bridge registration and frontend API setup
- `ipc.cpp`: message parsing, response formatting, event routing
- `addon.cpp`: Node N-API exports only
- `app.cpp`: instance-owned native runtime composition and dependency wiring

The goal is to keep C++ small, boring, and maintainable.

### 24.2 Remove global native state

Status: Implemented. `NodeViewJSRuntime` owns `IpcBridge`, `WebViewHost`, and each `NativeWindow`, with dependencies injected explicitly. WebView and window state are held by their owning objects instead of file-global instances. Window teardown resets lifecycle fields and balances COM, timer, and icon ownership, while generation checks discard late WebView initialization callbacks. Per-window callback routing is covered by the completed multi-window work in L-01.

Avoid long-term use of globals such as:

```cpp
HWND g_window;
ComPtr<ICoreWebView2> g_webview;
```

Prefer instance-owned state:

```cpp
class WebViewHost {
public:
  bool Initialize(HWND window, const std::wstring& entry_file);
  void Resize();
  void PostMessage(const std::wstring& json);
  void Close();

private:
  HWND window_ = nullptr;
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webview_;
};
```

This will make future multi-window support much easier.

### 24.3 Add a runtime/app class

Status: Implemented. `NodeViewJSRuntime` and its build module own `IpcBridge`, `WebViewHost`, and `NativeWindow`; the existing N-API-compatible free functions delegate to the runtime-owned objects.

Create a native runtime object instead of many free functions.

Example shape:

```cpp
class NodeViewJSRuntime {
public:
  bool CreateWindow(const WindowOptions& options);
  bool LoadFile(const std::wstring& path);
  void Run();
  void Close();

private:
  NativeWindow window_;
  WebViewHost webview_;
  IpcBridge ipc_;
};
```

This makes the native code easier to reason about and test.

### 24.4 Version the IPC protocol

Status: Implemented for the current bridge messages using `version: 1`.
Runtime message parsing and backend response/event formatting now live in `runtime/ipc.js`.

Update all IPC messages to include a protocol version.

Example:

```json
{
  "version": 1,
  "type": "invoke",
  "id": 1,
  "command": "greet",
  "payload": {
    "name": "Robert"
  }
}
```

This allows the protocol to evolve later without breaking older apps.

### 24.5 Move the bridge JavaScript out of large C++ strings

Status: Implemented. The editable bridge lives in `runtime/bridge.js` and the build generates `src-nodeview/generated/bridge_script.h`.

Do not maintain a large bridge script directly inside `webview.cpp`.

Recommended source file:

```text
runtime/bridge.js
```

Build step:

```text
runtime/bridge.js
  ↓
generated/bridge_script.h
  ↓
compiled into native addon
```

This gives the developer a normal JavaScript file to edit while still embedding the bridge into the runtime.

Performance note: packaging rewrites copied HTML once and marks the packaged runtime to skip native bridge injection. Source files are never changed, development retains the document-start fallback, and no local HTTP server is required.

### 24.6 Add a permission model

Status: Implemented. Apps can use a simple `permissions: [...]` allow-list or an `{ allow, deny }` policy. Policies support known groups such as `fs:*`, named scopes such as `dialog:open:settings`, and deny-first evaluation. Commands can declare one permission with an optional scope or require several permissions; every requirement is checked before backend code runs. Unregistered commands are also rejected without running backend code.

NodeViewJS should not expose dangerous actions by default.

Future API:

```js
app.command("readConfig", {
  permission: "fs:read"
}, function () {
  return readConfig();
});
```

Possible permissions:

- `fs:read`
- `fs:write`
- `dialog:open`
- `dialog:save`
- `shell:open`
- `notification:show`
- `window:control`

Initial rule:

Only registered commands are callable from the frontend.

Later rule:

Commands can also be grouped by declared permissions.

### 24.7 Improve window options

Status: Implemented. `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `resizable`, `icon`, `devtools`, `center`, `maximized`, `alwaysOnTop`, `closeToHide`, and `transparent` are implemented. Transparent mode makes the WebView2 canvas and native client area fully transparent while preserving opaque page content and the standard Windows frame; partial opacity is intentionally unsupported.

Support a more polished app configuration API:

```js
const app = new App({
  title: "My App",
  width: 900,
  height: 600,
  minWidth: 500,
  minHeight: 300,
  resizable: true,
  maximized: false,
  center: true,
  alwaysOnTop: false,
  closeToHide: false,
  transparent: false,
  icon: "assets/icon.ico",
  devtools: true,
  entry: "index.html"
});
```

These options should be handled in the native window layer, not in app business logic.

### 24.8 Expand the frontend event API

Status: Implemented. Frontend and backend APIs support `on`, `once`, `off`, and `emit`, including integration coverage for one-shot and removed handlers.

Keep the frontend API familiar for JavaScript developers.

Recommended API:

```js
NodeViewJS.on("themeChanged", handler);
NodeViewJS.once("ready", handler);
NodeViewJS.off("themeChanged", handler);
NodeViewJS.emit("ready", data);
```

Backend equivalent:

```js
app.on("ready", function (data) {});
app.once("ready", function (data) {});
app.off("ready", handler);
app.emit("themeChanged", data);
```

### 24.9 Add a development mode

Development mode should improve the workflow without adding Electron-like weight.

Future command:

```bash
nodeviewjs dev
```

Expected behavior:

- Launch the app
- Open DevTools when configured
- Watch HTML, CSS, and JS files
- Reload the WebView when frontend files change
- Show clearer native/runtime errors
- Keep the API the same as production

Status: Implemented. The app launches with DevTools and startup timing enabled, watches frontend HTML/CSS/JavaScript files, and reloads the WebView without restarting the Node.js backend. Missing entries, backend crashes, native addon loading failures, child-process launch failures, and asynchronous WebView failures now include clearer diagnostics.

### 24.10 Design the public API before expanding internals

Status: Implemented for the current multi-window runtime. `App`, `AppWindow`, registered commands, events, permissions, plugins, updater, helpers, and frontend `NodeViewJS` methods follow the documented API; future additions must update this contract first.

The public API should guide the implementation.

Preferred backend style:

```js
const { App } = require("nodeviewjs");

const app = new App({
  title: "My App",
  entry: "index.html"
});

app.command("greet", function (name) {
  return "Hello " + (name || "there");
});

app.run();
```

Preferred frontend style:

```js
NodeViewJS.invoke("greet", "Robert").then(function (message) {
  console.log(message);
});
```

Implementation details should support this developer experience, not leak through it.

---

## 25. Long-Term Vision

The ordered status for long-term work is tracked in the Active Execution Queue. The project can grow into a lightweight NodeViewJS desktop runtime with:

- Multi-window support
- Secure permissions
- Plugins
- Advanced file dialogs
- Advanced notifications
- Advanced system tray behavior
- Auto-update support
- Signed installer and update distribution hardening
- macOS and Linux support

But the first version should stay small, focused, and useful.
