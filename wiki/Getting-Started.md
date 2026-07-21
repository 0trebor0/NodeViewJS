# Getting Started

## Requirements

- Node.js 20 or newer
- npm
- Windows: Visual Studio 2022 Build Tools with Desktop development with C++, Python 3, and Microsoft Edge WebView2 Runtime
- macOS: Xcode command-line tools and a supported WKWebView system
- Linux: GTK 3 and WebKitGTK 4.1 development/runtime packages

## Create an application

```powershell
npx nodeviewjs create MyApp
cd MyApp
npm install
npm run dev
```

For a manual application, install NodeViewJS and create two files.

`app.js`:

```js
"use strict";

const path = require("node:path");
const { App } = require("nodeviewjs");

const app = new App({
  title: "My App",
  appId: "com.example.my-app",
  width: 900,
  height: 600,
  entry: path.join(__dirname, "index.html")
});

app.command("greet", (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("greet requires an object payload.");
  }
  const { name } = payload;
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("name must be a non-empty string.");
  }
  return { message: `Hello ${name}` };
});

app.run();
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>My App</title>
  </head>
  <body>
    <button id="greet">Greet</button>
    <p id="output"></p>
    <script>
      document.querySelector("#greet").addEventListener("click", async () => {
        try {
          const result = await NodeViewJS.invoke("greet", { name: "World" });
          document.querySelector("#output").textContent = result.message;
        } catch (error) {
          document.querySelector("#output").textContent = error.message;
        }
      });
    </script>
  </body>
</html>
```

## Development

```powershell
npm run dev
```

Development mode enables frontend live reload, startup timing, backend error reporting, and DevTools. Packaged Windows applications intentionally disable DevTools.

## Build and package

```powershell
npm run build
npx nodeviewjs package
```

See [[Packaging and Distribution]] for installers, signing, and updates.
