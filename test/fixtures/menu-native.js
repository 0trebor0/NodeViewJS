"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { App } = require("../../runtime");

const app = new App({
  title: "NodeViewJS Menu Integration Test",
  appId: "nodeviewjs-menu-integration-test",
  entry: path.join(__dirname, "menu-native.html"),
  menu: [
    {
      label: "Test",
      submenu: [
        {
          id: "test.checkbox",
          label: "Checked",
          type: "checkbox",
          checked: false,
          accelerator: "Ctrl+T"
        }
      ]
    }
  ]
});

app.on("menu", ({ id, checked }) => {
  fs.writeFileSync(process.env.NODEVIEW_MENU_RESULT, JSON.stringify({ id, checked }));
  app.quit();
});

app.run();
