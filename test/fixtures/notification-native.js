"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { App } = require("../../runtime");

const app = new App({
  title: "NodeViewJS Notification Integration Test",
  appId: "nodeviewjs-notification-integration-test",
  entry: path.join(__dirname, "taskbar-native.html")
});

app.run();
app.showNotification({
  title: "NodeViewJS Notification Test",
  message: "Native notification delivery was accepted by Windows."
});

const state = app.mainWindow.getState();
fs.writeFileSync(process.env.NODEVIEW_NOTIFICATION_RESULT, JSON.stringify({
  notificationCount: state.notificationCount,
  appUserModelId: state.appUserModelId,
  notificationTransport: state.notificationTransport
}));
app.quit();
