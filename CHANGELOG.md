# Changelog

## Unreleased

### Changed

- Windows local app pages now use a private, per-WebView `https://app.nodeview.local/` mapping instead of direct `file:` navigation. The mapping exists only in memory for the lifetime of the WebView, performs no network or global system configuration, retains canonical app-root security checks, and removes Chromium unique-file-origin console warnings.
