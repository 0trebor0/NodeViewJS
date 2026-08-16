# Changelog

## Unreleased

### Added

- `nodeviewjs doctor` reports whether this machine can build, run, and package an app: Node.js version, whether the native addon is present and loadable, Python 3 for `node-gyp`, the platform C++ toolchain, the system WebView runtime, and packaging prerequisites. Each failure names the install command that fixes it, and the command exits non-zero when a required check fails so it can gate a script. `--signing` adds the release signing prerequisites, which stay off the default report; `--json` prints machine-readable output.
- TypeScript declarations for the whole public API ship with the package (`types/index.d.ts`, `types/ipc.d.ts`) and are wired into `package.json`, so editors type `App`, `AppWindow`, `Updater`, the runtime helpers, options, events, and payloads without any extra install. `types/bridge.d.ts` declares the frontend `NodeViewJS` global. `npm run test:types` type-checks a usage file against them.
- `package.json` declares an explicit `exports` map. `nodeviewjs` resolves the public API and `nodeviewjs/ipc` the advanced protocol helpers; every other internal runtime file is no longer importable through a deep path. `npm run test:exports` verifies resolution from an installed package.
- `AppWindow.lifecycleState` reports `configured`, `open`, `closed`, or `disposed`.
- `npm run test:tarball` installs the packed npm tarball into a clean project and checks that the public entry points, type declarations, and CLI resolve there.
- CI now runs the Windows job on Node 20 as well as Node 22 — 20 is the minimum version `package.json` supports — and adds a Node 20 job that packs the artifact and runs the export, type, and tarball-install checks.
- `wiki/Lifecycle.md` documents startup and shutdown order, the window state table, handler attachment, and what happens when a callback throws.

### Removed

- The `window.NodeView` compatibility alias. `window.NodeViewJS` is the only browser global. Applications that used the alias must switch to `window.NodeViewJS`.

- Backend commands can call HTTP APIs through `app.fetch()` and the exported `net` helper, gated by a new `net:fetch` permission and an `allowedOrigins` application option. The WebView itself stays sandboxed; only the backend performs the request. Both `http` and `https` origins are accepted, including private and internal addresses, because listing an origin is the deliberate act that grants it; other schemes are rejected, and an app with no `allowedOrigins` cannot make requests. Requests are validated before they leave the process: method and header allowlists, a 2048-character URL limit, no credentials in the URL, a 1 MiB request body limit, an 8 MiB response ceiling counted from the bytes actually received, and a 30-second default timeout. Redirects are re-checked against the allowlist on every hop and capped at three, so an allowed origin cannot hand the request to another host, and `set-cookie` is stripped from responses.
- `setup.bat` installs missing Windows prerequisites through `winget` and then runs `npm install`. It checks Node.js 20 or newer, Python 3, the Visual Studio 2022 Desktop development with C++ workload, and the Microsoft Edge WebView2 Runtime, installing only what is absent. `/check` reports status without changing anything and `/deps` skips the project install.
- `AppWindow.isClosed` reports whether a window has been closed. It is distinct from `!isOpen`: a window that has not been opened yet is not closed, so it still buffers events emitted before `app.run()`.
- `npm run test:native`, `npm run test:native-ui`, and `npm run test:full` group the native and WebView suites that previously had no aggregate runner.
- `docs/index.html` is a complete single-page project guide covering setup, CLI, the frontend bridge, the backend API, packaging, updates, security, and troubleshooting.

### Fixed

- Native callbacks no longer leak unhandled promise rejections. The window message handler started an async dispatch whose rejection had no consumer, so a failing frontend event handler surfaced as an unhandled rejection instead of a reported error. Every promise started from a native callback is now consumed inside the runtime.
- Application and window event handler failures are now isolated. A handler that throws or rejects is reported to the backend log and the remaining handlers still run; previously the first failure aborted the rest of the dispatch for that event. Command handlers are unchanged: their failures are still returned to the frontend, where `invoke()` rejects.
- Windows closed while the app is running are removed from `app.windows` and their event handlers and buffered messages are released. A long-running app that opened a transient window per document previously retained every one of them for the life of the process. Windows closed before `app.run()` still stay listed so a failed startup can retry them.
- The unsubscribe function returned by `on()` and `once()` now runs the same cleanup as `off()`, on `App`, `AppWindow`, and the frontend bridge. It previously removed the handler but left an empty entry behind for that event name, so subscribing and unsubscribing many distinct names grew the internal maps without bound. Calling it more than once is harmless.
- `app.emit()` no longer queues broadcasts into closed windows. A closed window can never flush its readiness buffer, so events accumulated there until the buffer limit threw out of `app.emit()` and broke app-wide events for the remaining open windows.
- `AppWindow.emit()` on a closed window now throws `Window has been closed.` immediately instead of queueing events that can never be delivered. `app.emit()` continues to broadcast to the open windows and skips closed ones.
- `notification.show()` validates its options before loading the native addon. Invalid arguments previously surfaced as a native addon load failure on machines where the addon had not been built.
- `config.resolveConfigPath()` rejects file names longer than 255 characters. An over-long name previously reached the filesystem and failed as `ENOENT`, which reads as a missing directory rather than an over-long file name.

### Security

- `undici` is pinned to 6.28.0 through a dependency override. The version `node-gyp` resolved carried advisories for response desynchronization, CRLF injection, and cookie attribute injection.

### Changed

- The root `README.md` is now an onboarding document: positioning, install, a runnable example, a platform maturity table, a feature summary, a security summary, and links. The reference material it carried moved into the wiki pages for getting started, the backend API, the frontend bridge, packaging, security, and testing, where it is now more complete.
- Windows native build and packaging now fail early with a clear Python 3 prerequisite message before `node-gyp` runs.
- Command permissions can now be narrowed per window while the app-level permission policy remains the maximum grant.
- Documentation now shows backend error log locations and keeps generated starter and packaged demo `greet` examples aligned on the string payload API.
- Packaged apps now ignore inherited CLI development flags for DevTools, file watching, and startup timing defaults; explicit application options remain authoritative.
- Windows local app pages now use a private, per-WebView `https://app.nodeview.example/` mapping instead of direct `file:` navigation. The mapping exists only in memory for the lifetime of the WebView, performs no network or global system configuration, retains canonical app-root security checks, and removes Chromium unique-file-origin console warnings.
- Windows WebView2 profile directories now use explicit Win32 directory creation so access failures are reported instead of terminating the process; live bridge diagnostics use isolated temporary profile roots that are removed after each child test exits.
- Windows tray icons can now use validated custom menus with commands, checkboxes, separators, disabled items, submenus, and dedicated `tray-menu` events. The built-in Show/Quit menu remains the default.
- Windows notifications now register the app title against its per-user AppUserModelID and use the AUMID-addressed Windows toast API instead of inheriting `Node.js JavaScript Runtime` from the legacy host-process balloon.
- Windows 11 apps can configure native title-bar, title-text, and border colors at startup or runtime through `windowColors` and `setWindowColors()`; state reports whether the OS supports native chrome colors.
