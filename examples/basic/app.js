"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { App } = require("../../runtime");

const app = new App({
  title: "NodeViewJS Media Loader",
  appId: "nodeviewjs-demo",
  width: 900,
  height: 700,
  devtools: process.env.NODEVIEW_DEVTOOLS === "1",
  entry: path.join(__dirname, "index.html")
});
app.command("greet", async ( object ) => {
  console.log(object);
});
app.emit("hey", {msg:'Hello World!'});
app.run();
try {
  app.showNotification({
    title: "My App",
    message: "The application is ready."
  });
} catch (error) {
  console.warn(`[NodeViewJS demo] Notification unavailable: ${error.message}`);
}
