"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { App } = require("../../runtime");

const resultPath = process.env.NODEVIEW_RECOVERY_RESULT;
if (!resultPath) {
  throw new Error("NODEVIEW_RECOVERY_RESULT is required.");
}

const app = new App({
  title: "NodeViewJS Recovery Test",
  icon: path.join(__dirname, "missing-icon.ico"),
  entry: path.join(__dirname, "bridge.html")
});

try {
  app.run();
  throw new Error("App unexpectedly started with a missing icon.");
} catch (error) {
  if (!/Could not load the window icon/.test(String(error?.message))) {
    throw error;
  }
  app.options.icon = undefined;
}

setTimeout(() => {
  fs.writeFileSync(resultPath, "recovered");
  app.quit();
}, 250);

app.run();
