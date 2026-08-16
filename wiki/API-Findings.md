# API findings from dogfooding

Three applications were built against the public API to find out whether the
primitives stay pleasant at real size, rather than to demonstrate features:

| Shape | Example | What it leans on |
| --- | --- | --- |
| Simple utility | `examples/digest` | One window, one command, no permissions at all |
| Multi-window app | `examples/tasks` | Two windows, broadcast events, per-window permission narrowing, persistence |
| Plugin and OS integration | `examples/focus` | A plugin, tray, taskbar progress, notifications, single instance, deep links |

Each is covered by an integration test that drives it through the IPC layer.
What follows is what building them actually surfaced. Nothing here is a bug: the
runtime behaves as designed in every case. They are the places where the design
made an application awkward, recorded before deciding whether to change
anything.

## 1. There is no backend-side event bus

`app.emit()` delivers to windows. `app.on()` receives events from windows.
Together they are a backend-to-page channel, not an event bus, and nothing in
their names says so.

The consequence appears as soon as an application has a plugin. A plugin's
`context.emit()` also addresses windows, so **a host cannot subscribe to its own
plugin's events**, and a plugin cannot notify its host. `examples/focus` needs
exactly that: the timer must drive taskbar progress and notifications, which are
the host's job.

The workaround is for the plugin to accept a listener from its host:

```js
const { plugin, controls } = createTimerPlugin({
  onEvent: (name, payload) => onTimerEvent(name, payload)
});
app.use(plugin);
```

That works, but it means a plugin has two notification mechanisms — one for
pages, one for its host — and only one of them is part of the API.

## 2. Backend code cannot invoke a registered command

Commands are reachable from a page through `NodeViewJS.invoke()`. There is no
`app.invoke()`, so a menu item, a tray item, a deep link, or a
`second-instance` handler cannot reach one.

In `examples/focus`, "Start" appears in the menu, in the tray, from a
`focus://` link, and as a button in the page. The page path goes through a
command; the other three cannot, so the plugin hands the host direct controls:

```js
app.on("menu", ({ id }) => {
  if (id === "session.start") controls.start();
});
```

The application ends up with two ways to invoke the same operation, which is
where the validation in one path and not the other can drift apart. The example
avoids that by having the command call the same function the controls expose.

## 3. Accelerators accept no punctuation

Menu accelerators support Ctrl, Alt, Shift, letters, numbers, F1–F24, and named
navigation keys. Common real shortcuts — `Ctrl+.`, `Ctrl+,`, `Ctrl+/` — are
rejected. `examples/focus` wanted `Ctrl+.` for Stop and uses `Ctrl+E` instead.

## 4. `app.quit()` being synchronous shapes the application

Shutdown is synchronous by design, and `before-quit` handlers cannot be awaited.
Every one of these applications therefore has to write as it goes rather than
flushing at exit. That is defensible — and arguably better — but it is a
constraint on application design that only becomes obvious when writing one.
`examples/tasks` persists on every mutation for this reason.

## 5. The simplest application wants no ceremony, the testable one wants some

`examples/digest` is the whole application in one file, ending in `app.run()`.
That is the right shape for a utility, and it is also untestable without loading
and running the module.

`examples/tasks` and `examples/focus` split into `create-app.js`, which builds
the application and returns it, and a four-line `app.js` that runs it. That split
is what makes their integration tests possible. It is worth documenting as the
recommended structure for anything beyond a single command, because nothing in
the API suggests it.

## What was deliberately not changed

These findings are recorded rather than acted on, because the current phase is a
feature freeze: the value of dogfooding is lost if the API changes under the
applications testing it. Items 1 and 2 are the ones worth revisiting before
1.0, and both would be additions rather than breaking changes.
