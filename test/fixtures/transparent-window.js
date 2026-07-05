"use strict";

const path = require("node:path");
const { App } = require("../../runtime");

const app = new App({
  title: "NodeViewJS Transparency Test",
  width: 520,
  height: 360,
  center: true,
  alwaysOnTop: true,
  transparent: true,
  entry: path.join(__dirname, "transparent.html")
});

app.run();
setTimeout(() => app.quit(), 10_000);
