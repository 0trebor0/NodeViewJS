# Changelog

## Unreleased

### Added

- `setup.bat` installs missing Windows prerequisites through `winget` and then runs `npm install`. It checks Node.js 20 or newer, Python 3, the Visual Studio 2022 Desktop development with C++ workload, and the Microsoft Edge WebView2 Runtime, installing only what is absent. `/check` reports status without changing anything and `/deps` skips the project install.
- `AppWindow.isClosed` reports whether a window has been closed. It is distinct from `!isOpen`: a window that has not been opened yet is not closed, so it still buffers events emitted before `app.run()`.
- `npm run test:native`, `npm run test:native-ui`, and `npm run test:full` group the native and WebView suites that previously had no aggregate runner.
- `docs/index.html` is a complete single-page project guide covering setup, CLI, the frontend bridge, the backend API, packaging, updates, security, and troubleshooting.

### Fixed

- `app.emit()` no longer queues broadcasts into closed windows. A closed window can never flush its readiness buffer, so events accumulated there until the buffer limit threw out of `app.emit()` and broke app-wide events for the remaining open windows.
- `AppWindow.emit()` on a closed window now throws `Window has been closed.` immediately instead of queueing events that can never be delivered. `app.emit()` continues to broadcast to the open windows and skips closed ones.
- `notification.show()` validates its options before loading the native addon. Invalid arguments previously surfaced as a native addon load failure on machines where the addon had not been built.
- `config.resolveConfigPath()` rejects file names longer than 255 characters. An over-long name previously reached the filesystem and failed as `ENOENT`, which reads as a missing directory rather than an over-long file name.

### Security

- `undici` is pinned to 6.28.0 through a dependency override. The version `node-gyp` resolved carried advisories for response desynchronization, CRLF injection, and cookie attribute injection.

### Changed

- Windows native build and packaging now fail early with a clear Python 3 prerequisite message before `node-gyp` runs.
- Command permissions can now be narrowed per window while the app-level permission policy remains the maximum grant.
- Documentation now shows backend error log locations and keeps generated starter and packaged demo `greet` examples aligned on the string payload API.
- Packaged apps now ignore inherited CLI development flags for DevTools, file watching, and startup timing defaults; explicit application options remain authoritative.
- Windows local app pages now use a private, per-WebView `https://app.nodeview.example/` mapping instead of direct `file:` navigation. The mapping exists only in memory for the lifetime of the WebView, performs no network or global system configuration, retains canonical app-root security checks, and removes Chromium unique-file-origin console warnings.
- Windows WebView2 profile directories now use explicit Win32 directory creation so access failures are reported instead of terminating the process; live bridge diagnostics use isolated temporary profile roots that are removed after each child test exits.
- Windows tray icons can now use validated custom menus with commands, checkboxes, separators, disabled items, submenus, and dedicated `tray-menu` events. The built-in Show/Quit menu remains the default.
- Windows notifications now register the app title against its per-user AppUserModelID and use the AUMID-addressed Windows toast API instead of inheriting `Node.js JavaScript Runtime` from the legacy host-process balloon.
- Windows 11 apps can configure native title-bar, title-text, and border colors at startup or runtime through `windowColors` and `setWindowColors()`; state reports whether the OS supports native chrome colors.
