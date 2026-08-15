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

## Network access

The WebView cannot reach the network. Grant `net:fetch`, list the origins the app may reach, and perform the request in a command:

```js
const app = new App({
  entry: "index.html",
  permissions: ["net:fetch"],
  allowedOrigins: ["https://api.example.com"]
});

app.command("api:get", { permission: "net:fetch" }, async ({ path }) => {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new TypeError("path must start with /.");
  }
  const response = await app.fetch({ url: `https://api.example.com${path}` });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return JSON.parse(response.body);
});
```

`app.fetch()` binds the app's allowlist, so a command cannot widen it. It returns `{ url, status, ok, headers, body }` with `body` as text. Options are `url`, `method`, `headers`, `body`, `timeoutMs`, and `maxResponseBytes`.

`allowedOrigins` takes origins only, with no path, query, or fragment. Both `http` and `https` are accepted, including private and internal addresses, because listing an origin is the deliberate act that grants it. Prefer `https` for anything leaving the machine. An app with no `allowedOrigins` cannot make requests.

Redirects are re-checked against the allowlist on every hop. Transport and credential headers such as `Host` and `Cookie` cannot be set by the caller, and `set-cookie` is stripped from responses.

When a command builds a request entirely from its own constants, the global `fetch()` is equivalent and simpler. `app.fetch()` earns its place when any part of the request comes from the frontend. See [[Security Model]] for what the allowlist does and does not protect.

## Windows

`AppWindow` instances support show, hide, close, reload, minimize, maximize, restore, fullscreen, title, size, position, drag, menus, taskbar state, notifications, tray integration, and state inspection. `isOpen` reports whether a window is currently open, and `isClosed` reports whether it has been closed; a window that has not been opened yet is neither open nor closed.

See [[Windows and Multiple Windows]].

## Helpers

NodeViewJS exports trusted backend helpers for:

- constrained shell URL/path opening
- Unicode clipboard text
- native dialogs
- notifications
- AppData JSON configuration
- signed updates
- validated outbound HTTP (`net`)

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

