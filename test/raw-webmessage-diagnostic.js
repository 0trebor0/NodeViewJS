"use strict";

const path = require("node:path");
const { App } = require("../runtime");
const { runWithTemporaryWebViewProfile } = require("./temporary-webview-profile");

if (process.platform !== "win32") {
  console.log("Raw WebView message diagnostic skipped outside Windows.");
  process.exit(0);
}

runWithTemporaryWebViewProfile("nodeviewjs-raw-webmessage-", 25_000);

const app = new App({
  appId: `NodeViewJS.RawWebMessageDiagnostic.${process.pid}`,
  title: "NodeViewJS Raw WebMessage Diagnostic",
  entry: path.join(__dirname, "fixtures", "raw-webmessage.html"),
  startupTiming: true
});

let completed = false;
process.on("exit", (code) => {
  if (!completed) {
    console.error(`Raw WebView message diagnostic exited before receiving a message (code ${code}).`);
    process.exitCode = 1;
  }
});

const timeout = setTimeout(() => {
  completed = true;
  console.error("Raw WebView message diagnostic timed out.");
  app.quit();
  process.exit(1);
}, 10_000);

app.once("raw-webmessage-ready", (payload) => {
  completed = true;
  clearTimeout(timeout);
  console.log(JSON.stringify(payload));
  app.quit();
});

app.run();
