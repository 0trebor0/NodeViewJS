# Changelog

## Unreleased

### Changed

- Windows local app pages now use a private, per-WebView `https://app.nodeview.local/` mapping instead of direct `file:` navigation. The mapping exists only in memory for the lifetime of the WebView, performs no network or global system configuration, retains canonical app-root security checks, and removes Chromium unique-file-origin console warnings.
- Windows tray icons can now use validated custom menus with commands, checkboxes, separators, disabled items, submenus, and dedicated `tray-menu` events. The built-in Show/Quit menu remains the default.
