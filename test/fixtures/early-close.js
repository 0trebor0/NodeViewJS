"use strict";

const path = require("node:path");
const { App } = require("../../runtime");

const app = new App({
  title: "NodeViewJS Early Close Test",
  entry: path.join(__dirname, "bridge.html")
});

app.run();
setImmediate(() => app.quit());
