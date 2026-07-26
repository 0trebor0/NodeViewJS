# Backend API

## Application

```js
const { App } = require("nodeviewjs");
const app = new App(options);
```

Common options include `title`, `appId`, `entry`, dimensions, frame/window controls, `devtools`, `startupTiming`, `singleInstance`, menu, tray, icon, transparency, and window colors.

Key methods:

- `app.run()` and `app.quit()`
- `app.command(name, handler)`
- `app.command(name, permissions, handler)`
- `app.on()`, `app.once()`, `app.off()`, and `app.emit()`
- `app.createWindow(options)`
- `app.use(plugin, options)`
- menu, tray, taskbar, notification, and window-control methods

## Permission-gated commands

```js
const app = new App({
  entry: "index.html",
  permissions: {
    allow: ["fs:read:config", "dialog:open:settings"],
    deny: ["fs:write"]
  }
});

app.command("config:read", {
  permission: "fs:read",
  scope: "config"
}, async () => ({ theme: "dark" }));
```

Deny rules take precedence. Permissions control command admission; handlers must still validate application-specific semantics.

Window options can include `permissions` to narrow the app policy for that window:

```js
app.createWindow({
  title: "Preview",
  entry: "preview.html",
  permissions: ["fs:read:config"]
});
```

The app policy remains the maximum permission set. A command invoked from a window must satisfy both policies.

## Windows

`AppWindow` instances support show, hide, close, reload, minimize, maximize, restore, fullscreen, title, size, position, drag, menus, taskbar state, notifications, tray integration, and state inspection.

See [[Windows and Multiple Windows]].

## Helpers

NodeViewJS exports trusted backend helpers for:

- constrained shell URL/path opening
- Unicode clipboard text
- native dialogs
- notifications
- AppData JSON configuration
- signed updates

Expose helper behavior to a frontend only through explicit, permission-gated commands.

## Plugins

Plugins are trusted backend modules with namespaced commands/events, declared permissions, transactional setup, deterministic start/stop, and cleanup hooks.

```js
app.use({
  name: "example.settings",
  version: "1.0.0",
  permissions: ["fs:read"],
  setup(context) {
    context.command("read", { permission: "fs:read" }, readSettings);
  }
});
```

