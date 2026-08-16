# Frontend Bridge

NodeViewJS provides `window.NodeViewJS` automatically. Do not add a bridge `<script>` tag to application source files.

`window.NodeViewJS` is the only browser global. The former `window.NodeView`
alias was removed before the first public release; update any page that used it.

## How the bridge is loaded

During portable packaging, NodeViewJS writes the bridge to
`resources/app/__nodeview/bridge.js` and adds a relative external script
reference to every copied `.html` file. Your source HTML is never modified. This
avoids requiring `unsafe-inline`, so Windows pages can use a policy such as
`script-src 'self'` while the native host limits resources to the app root.
Packaged apps set an internal marker so the native host skips document-start
injection and navigates directly to the prepared HTML.

The bridge source is ordinary editable JavaScript in `runtime/bridge.js`, and the
same script stays embedded in the native addon as a development fallback.
Development mode keeps native document-start injection so live reload works
without generating files beside your source.

```text
Node app starts
  -> native window opens
  -> the system WebView is created
  -> the packaged HTML file is loaded directly
  -> its NodeViewJS bridge starts during parsing
```

There is no local HTTP server: the HTML rewrite happens once at packaging time,
and app pages load from local files through a private per-WebView mapping. Only
files copied into the package are prepared — HTML generated after packaging must
provide its own bridge if it is used as a top-level app page.

## Commands

Use `invoke()` when the frontend needs a result or acknowledgement.

```js
const result = await NodeViewJS.invoke("settings:read", {
  section: "editor"
});
```

Backend:

```js
app.command("settings:read", (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("settings:read requires an object payload.");
  }
  const { section } = payload;
  if (typeof section !== "string" || section.trim() === "") {
    throw new TypeError("section must be a non-empty string.");
  }
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

On the backend, `app.emit()` reaches whichever windows are live and skips closed ones. `AppWindow.emit()` targets one window and throws `Window has been closed.` if that window is gone, rather than queueing events it can never deliver.

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
