"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { App } = require("../runtime");

if (process.platform !== "win32") {
  console.log("WebView capability integration test skipped outside Windows.");
  process.exit(0);
}

const downloadPrefix = `nodeviewjs-sec04-${process.pid}-${Date.now()}`;
const downloadName = `${downloadPrefix}.txt`;
const downloadsDirectory = path.join(os.homedir(), "Downloads");

function matchingDownloads() {
  if (!fs.existsSync(downloadsDirectory)) return new Set();
  return new Set(fs.readdirSync(downloadsDirectory).filter((name) => name.startsWith(downloadPrefix)));
}

const downloadsBefore = matchingDownloads();
const serverRequestUrls = [];
let remoteBaseUrl;
const progress = [];
const server = http.createServer((request, response) => {
  serverRequestUrls.push(request.url);
  if (request.url === "/script.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" });
    response.end("window.remoteCapabilityScriptLoaded = true;");
    return;
  }
  if (request.url === "/frame") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<script>parent.postMessage("nodeviewjs-remote-frame-executed", "*")</script>');
    return;
  }
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("This response must never reach the WebView.");
});

const app = new App({
  appId: "NodeViewJS.WebViewCapabilityTest",
  title: "NodeViewJS WebView Capability Test",
  entry: path.join(__dirname, "fixtures", "webview-capabilities.html")
});

app.command("getCapabilityTestConfig", () => ({ remoteBaseUrl, downloadName }));
app.on("webview-capability-progress", ({ step }) => { progress.push(step); });

const timeout = setTimeout(() => {
  console.error(`WebView capability integration test timed out after: ${progress.join(", ")}`);
  app.quit();
  server.close(() => process.exit(1));
}, 20_000);

app.once("webview-capability-result", async (result) => {
  clearTimeout(timeout);
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const downloadsAfter = matchingDownloads();
    const createdDownloads = [...downloadsAfter].filter((name) => !downloadsBefore.has(name));

    assert.equal(result.error, undefined, result.error);
    const unexpectedRequests = serverRequestUrls.filter((url) => url !== "/frame");
    assert.deepEqual(
      unexpectedRequests,
      [],
      `Blocked remote subresources reached the loopback server: ${unexpectedRequests.join(", ")}`
    );
    assert.deepEqual(result, {
      localScriptLoaded: true,
      remoteScriptBlocked: true,
      remoteFetchBlocked: true,
      remoteImageBlocked: true,
      remoteFrameBlocked: true,
      permissionDenied: true,
      downloadAttempted: true,
      popupAttempted: true,
      externalNavigationBlocked: true
    });
    assert.deepEqual(createdDownloads, [], "A canceled WebView download wrote a file.");
    assert.equal(app.windows.length, 1, "A popup created an additional application window.");
    console.log("WebView capability integration test passed.");
  } finally {
    app.quit();
    server.close();
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  remoteBaseUrl = `http://127.0.0.1:${address.port}`;
  app.run();
});
