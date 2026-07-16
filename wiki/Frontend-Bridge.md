# Frontend Bridge

NodeViewJS provides `window.NodeViewJS` automatically. Do not add a bridge `<script>` tag to application source files.

## Commands

Use `invoke()` when the frontend needs a result or acknowledgement.

```js
const result = await NodeViewJS.invoke("settings:read", {
  section: "editor"
});
```

Backend:

```js
app.command("settings:read", async ({ section }) => {
  return { section, theme: "dark" };
});
```

`invoke()` rejects when the command is unknown, unauthorized, throws, times out, or receives an invalid payload. Always handle rejection.

```js
try {
  const result = await NodeViewJS.invoke("files:open", { id: 42 });
} catch (error) {
  console.error("Command failed:", error);
}
```

An `async` backend command without an explicit return value resolves to `undefined`.

## Events

Events are one-way notifications.

```js
const unsubscribe = NodeViewJS.on("status:changed", ({ status }) => {
  document.querySelector("#status").textContent = status;
});

NodeViewJS.once("saved", ({ id }) => {
  console.log("Saved", id);
});

NodeViewJS.emit("page:opened", { page: "home" });

unsubscribe();
```

Backend:

```js
app.on("page:opened", ({ page }) => {
  console.log("Opened:", page);
});

app.emit("status:changed", { status: "ready" });
```

`emit()` does not acknowledge handler completion. Use `invoke()` for request/response dependencies, or emit a separate acknowledgement event.

## Readiness and buffering

Events in both directions are buffered until the frontend is ready. This makes the following safe:

```js
app.emit("app:state", { ready: true });
app.run();
```

The bridge flushes automatically after page load handlers. For advanced startup control, register listeners and call the idempotent readiness method:

```js
NodeViewJS.on("app:state", renderState);
await NodeViewJS.ready();
```

Readiness resets across reloads. Each direction buffers at most 1,024 events or 1 MiB per window and preserves queue order.

## Supported payloads

Payloads and results support JSON-style data:

- `null`
- booleans
- finite numbers
- strings, including Unicode
- arrays
- plain objects

Unsupported values include functions, symbols, `BigInt`, `NaN`, infinity, DOM elements, cyclic objects, class instances, streams, and native Node.js objects. Convert these to plain data first.

Messages are limited to 256 KiB, 32 levels, 10,000 payload nodes, and 128-character command/event names. Each window permits 64 pending frontend calls and applies a 30-second request timeout.

Before transport, the bridge creates and revalidates a detached JSON snapshot. Stateful getters cannot change a payload after validation.

## Console output

- Frontend `console.log()` appears in WebView DevTools during development.
- Backend `console.log()` appears in the terminal or backend log.
- Packaged Windows apps disable DevTools.

