# Changelog

## Unreleased

### Changed

- Windows local app pages now use a private, per-WebView `https://app.nodeview.local/` mapping instead of direct `file:` navigation. The mapping exists only in memory for the lifetime of the WebView, performs no network or global system configuration, retains canonical app-root security checks, and removes Chromium unique-file-origin console warnings.
- Windows tray icons can now use validated custom menus with commands, checkboxes, separators, disabled items, submenus, and dedicated `tray-menu` events. The built-in Show/Quit menu remains the default.
- Windows notifications now register the app title against its per-user AppUserModelID and use the AUMID-addressed Windows toast API instead of inheriting `Node.js JavaScript Runtime` from the legacy host-process balloon.
- Windows 11 apps can configure native title-bar, title-text, and border colors at startup or runtime through `windowColors` and `setWindowColors()`; state reports whether the OS supports native chrome colors.
