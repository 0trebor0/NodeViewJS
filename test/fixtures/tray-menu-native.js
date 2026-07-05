"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { App } = require("../../runtime");

const app = new App({
  title: "NodeViewJS Tray Menu Integration Test",
  appId: "nodeviewjs-tray-menu-integration-test",
  entry: path.join(__dirname, "menu-native.html"),
  tray: {
    title: "NodeViewJS Tray Test",
    menu: [
      {
        id: "tray.enabled",
        label: "Enabled",
        type: "checkbox",
        checked: false
      },
      { type: "separator" },
      { id: "tray.quit", label: "Quit" }
    ]
  }
});

app.on("tray-menu", ({ id, checked }) => {
  fs.writeFileSync(process.env.NODEVIEW_TRAY_MENU_RESULT, JSON.stringify({ id, checked }));
  app.quit();
});

app.run();
