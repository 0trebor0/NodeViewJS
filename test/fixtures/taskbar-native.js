"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { App } = require("../../runtime");

const app = new App({
  title: "NodeViewJS Taskbar Integration Test",
  appId: "nodeviewjs-taskbar-integration-test",
  entry: path.join(__dirname, "taskbar-native.html")
});

app.run();
app.setTaskbarProgress(0.5, "paused");
app.setTaskbarOverlay(process.env.NODEVIEW_TASKBAR_ICON, "Taskbar test");
app.requestAttention("informational");

const state = app.mainWindow.getState();
fs.writeFileSync(process.env.NODEVIEW_TASKBAR_RESULT, JSON.stringify({
  progressState: state.taskbarProgressState,
  progressValue: state.taskbarProgressValue,
  hasOverlay: state.hasTaskbarOverlay
}));

app.setTaskbarProgress(null);
app.setTaskbarOverlay(null);
app.requestAttention("stop");
app.quit();
