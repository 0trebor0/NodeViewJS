# Frontend Build Tools

NodeViewJS has no opinion about how the page is built. Anything that produces
static HTML, CSS, and JavaScript works: React, Vue, Svelte, Solid, or plain
files. The page is an ordinary document in a system WebView, so a framework
needs no NodeViewJS integration of its own — it talks to the backend through
`NodeViewJS.invoke()` and `NodeViewJS.on()` like any other script.

What does need care is the seam between the bundler's output and the runtime:
which file the window opens, what ends up in a package, when the bridge exists
relative to the code that mounts the application, and what reloads during
development. Those four are documented below and are covered by
`npm run test:frontend-build`.

## The two entries are different files

The word "entry" means two different things, and mixing them up is the most
common mistake in a bundler-based project.

| Setting | Points at | Used by |
| --- | --- | --- |
| `new App({ entry })` | The **HTML page** the window loads | The runtime, at startup |
| `nodeviewjs.entry` in `package.json` | The **backend script** | Packaging |

With a bundler, the window entry is the generated page, not the source one:

```js
const path = require("node:path");
const { App } = require("nodeviewjs");

const app = new App({
  title: "My App",
  entry: path.join(__dirname, "dist", "index.html")
});
```

The file must exist when the app starts, so the build runs before the app does:

```json
{
  "scripts": {
    "build:web": "<your bundler build>",
    "start": "npm run build:web && node app.js"
  },
  "nodeviewjs": {
    "name": "MyApp",
    "entry": "app.js"
  }
}
```

## What gets packaged

Packaging copies **everything in the backend entry's directory**, minus the
default exclusions, plus anything listed in `nodeviewjs.include`. With `app.js`
at the project root, the build output is picked up with no configuration at all:

```text
project/
  app.js            <- nodeviewjs.entry, so the project root is the base
  package.json
  src/              <- your framework sources, packaged but unused at runtime
  dist/
    index.html      <- new App({ entry })
    assets/app-a1b2c3.js
    assets/app-a1b2c3.css
```

Three details are worth knowing:

- `build/` is excluded by default, `dist/` is not. A bundler configured to emit
  into `build/` produces a package with no page in it. Either emit into `dist/`,
  or add the directory to `nodeviewjs.include`.
- `*.map` is excluded by default, so source maps never ship even when the
  bundler writes them next to the bundle. Nothing needs turning off.
- `node_modules/`, `.env` files, keys, and credential files are excluded too.
  Shrinking what the bundler emits is worthwhile, but keeping sources out of the
  package is not a security measure — see [Security Model](Security-Model.md).

If the sources are large and there is no reason to ship them, move the backend
entry into its own directory and use `include` for the build output instead:

```json
{
  "nodeviewjs": {
    "name": "MyApp",
    "entry": "backend/app.js",
    "include": ["dist"]
  }
}
```

## The bridge is ready before the application mounts

`window.NodeViewJS` is not something the page loads or waits for. In
development the runtime injects it before any document script runs; in a
package the bridge is written to `__nodeview/bridge.js` and a `<script>` tag for
it is inserted at the top of `<head>` in every packaged HTML file — ahead of the
bundle's own tags, whether those are `defer`, `type="module"`, or at the end of
`<body>`.

So a framework entry point can call the backend during its first render:

```js
import { createApp } from "./ui.js";

const settings = await NodeViewJS.invoke("settings:read");
createApp(settings).mount("#root");
```

Two constraints follow:

- The output must not contain a different file at `__nodeview/bridge.js`.
  Packaging fails rather than overwrite it.
- Do not add a `<script>` tag for the bridge yourself. A page that already
  carries the bridge marker is left alone, and a hand-written tag pointing
  somewhere else will not be corrected.

Events emitted by the backend before the page is ready are buffered and
delivered once it signals readiness, so a slow mount does not lose them. See
[Frontend Bridge](Frontend-Bridge.md).

## The page's directory is the web root

The WebView serves one directory: the one containing the window entry. It is
mapped to a private local origin, so with the page at `dist/index.html`, an
absolute URL such as `/assets/app-a1b2c3.js` resolves to `dist/assets/…` — the
default a bundler emits works unchanged, and a relative base works too.

The consequence is that nothing outside that directory is reachable from the
page. A build that emits the page into `dist/` but references assets from a
sibling directory will not load them; keep everything the page needs under the
directory the page is in. Requests to any other host are refused whatever the
markup says.

## Development reloads

`npm run dev` watches the directory containing the window entry and reloads the
window when an `.html`, `.css`, `.js`, or `.mjs` file under it changes. With the
window entry inside `dist/`, that is the build output directory — so the loop is
the bundler's own watch mode writing into `dist/`, and NodeViewJS reloading when
it does:

```json
{
  "scripts": {
    "dev:web": "<your bundler build> --watch",
    "dev": "nodeviewjs dev"
  }
}
```

Run the two side by side. Nested `build/` and `dist/` directories *below* the
watched directory are ignored, along with `node_modules` and `.git`; the watched
directory itself is not affected by its own name.

A bundler's hot module replacement is a different mechanism and is not
supported: it needs a dev server, and the WebView cannot reach the network
(see [Security Model](Security-Model.md)). Watch-and-reload is the supported
development loop.

## Checklist

- [ ] `new App({ entry })` points at the built HTML, not the source HTML.
- [ ] The build runs before the app starts.
- [ ] The output directory is packaged: it is under the backend entry's
      directory, or listed in `nodeviewjs.include`.
- [ ] The bundler does not emit into `build/`, or that directory is included
      explicitly.
- [ ] The output contains no `__nodeview/bridge.js`, and no hand-written bridge
      script tag.
- [ ] Every asset the page loads lives under the page's own directory.
