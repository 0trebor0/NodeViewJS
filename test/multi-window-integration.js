"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { App } = require("../runtime");

const app = new App({
  title: "NodeViewJS Multi-window Main",
  entry: path.join(__dirname, "fixtures", "multi-main.html")
});
const secondary = app.createWindow({
  title: "NodeViewJS Multi-window Secondary",
  entry: path.join(__dirname, "fixtures", "multi-secondary.html")
});

const ready = new Map();
const broadcasts = new Set();
const mainEvents = [];
const secondaryEvents = [];
let broadcastStarted = false;
let completed = false;

const timeout = setTimeout(() => {
  console.error("Multi-window integration test timed out.");
  process.exit(1);
}, 20_000);

app.command("identifyWindow", ({ label }) => `response:${label}`);
app.mainWindow.on("window-ready", ({ label }) => mainEvents.push(label));
secondary.on("window-ready", ({ label }) => secondaryEvents.push(label));

app.on("window-ready", ({ label, result }) => {
  ready.set(label, result);
  if (ready.size === 2 && !broadcastStarted) {
    broadcastStarted = true;
    assert.equal(ready.get("main"), "response:main");
    assert.equal(ready.get("secondary"), "response:secondary");
    assert.deepEqual(mainEvents, ["main"]);
    assert.deepEqual(secondaryEvents, ["secondary"]);
    assert.notEqual(app.mainWindow.id, secondary.id);
    app.emit("broadcast-check", { ok: true });
  }
});

app.on("broadcast-received", ({ label }) => {
  broadcasts.add(label);
  if (broadcasts.size !== 2 || completed) return;
  completed = true;
  clearTimeout(timeout);
  assert.deepEqual([...broadcasts].sort(), ["main", "secondary"]);
  secondary.close();
  app.quit();
  console.log("Multi-window integration test passed.");
});

app.run();
