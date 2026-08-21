"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { App } = require("../../runtime");

// "plain" registers only shortcuts. "menu-cleared" registers a menu as well and
// then removes it, because the menu and the shortcuts share one native
// accelerator table and rebuilding it must not drop the shortcut.
const withMenu = process.env.NODEVIEW_SHORTCUT_CASE === "menu-cleared";

const app = new App({
  title: "NodeViewJS Shortcut Integration Test",
  appId: "nodeviewjs-shortcut-integration-test",
  entry: path.join(__dirname, "menu-native.html"),
  menu: withMenu
    ? [{ label: "File", submenu: [{ id: "file.open", label: "Open", accelerator: "Ctrl+O" }] }]
    : undefined
});

// A function key needs no modifier, so the accelerator table can be exercised
// by posting a single key message instead of synthesising modifier state.
app.setShortcuts([{ id: "test.shortcut", accelerator: "F9" }]);

app.on("shortcut", ({ id }) => {
  fs.writeFileSync(process.env.NODEVIEW_SHORTCUT_RESULT, JSON.stringify({ id }));
  app.quit();
});

app.run();

if (withMenu) app.setMenu(null);
