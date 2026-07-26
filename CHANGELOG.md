# Changelog

## Unreleased

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
