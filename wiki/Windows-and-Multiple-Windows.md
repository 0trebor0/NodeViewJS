# Windows and Multiple Windows

## Create another window

```js
const settingsWindow = app.createWindow({
  title: "Settings",
  entry: path.join(__dirname, "settings.html"),
  width: 640,
  height: 480
});
```

Secondary windows inherit unspecified main-window options. Each has an independent WebView, readiness queue, IPC request state, event handlers, and native controls.

## Target events

```js
app.emit("theme:changed", theme);             // all open windows
settingsWindow.emit("settings:changed", data); // one window
```

A closed window can never flush its readiness queue, so the two paths treat it differently. `app.emit()` addresses whichever windows are live and skips closed ones silently. `AppWindow.emit()` names one specific window, so emitting at a closed one throws `Window has been closed.` immediately rather than queueing events that will never arrive.

Check `window.isClosed` when a window may already be gone. It is distinct from `!isOpen`: a window that has not been opened yet is not closed, so it still buffers events emitted before `app.run()`.

```js
if (!settingsWindow.isClosed) {
  settingsWindow.emit("settings:changed", data);
}
```

## Window controls

```js
settingsWindow.show();
settingsWindow.setTitle("Preferences");
settingsWindow.setSize(720, 560);
settingsWindow.setPosition(100, 100);
settingsWindow.minimize();
settingsWindow.restore();
settingsWindow.setFullscreen(true);
settingsWindow.reload();
settingsWindow.close();
```

Use registered, permission-gated backend commands when frontend UI needs to request native window operations.

## Menus, tray, and taskbar

Windows supports native application menus, context menus, custom tray menus, taskbar progress/overlay state, attention requests, notifications, and Windows 11 title-bar colors. Menu and tray templates are validated and bounded before native creation.

## Single instance and launch routing

Set `singleInstance: true` to forward later launches to the primary application. Protocol and file-association launch targets are normalized and validated before delivery.

