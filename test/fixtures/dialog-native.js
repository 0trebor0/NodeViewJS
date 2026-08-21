"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { App, dialog } = require("../../runtime");

const kind = process.env.NODEVIEW_DIALOG_KIND;

const app = new App({
  title: "NodeViewJS Dialog Integration Test",
  appId: "nodeviewjs-dialog-integration-test",
  entry: path.join(__dirname, "menu-native.html")
});

app.run();

// The dialog blocks in its own modal loop, so it is opened once the window is
// up and the harness has something to close.
setTimeout(() => {
  let result;
  try {
    const selection = kind === "directory"
      ? dialog.openDirectory()
      : dialog.openFile({ multiple: true });
    result = { kind, selection, type: typeof selection };
  } catch (error) {
    result = { kind, error: String(error?.message ?? error) };
  }
  fs.writeFileSync(process.env.NODEVIEW_DIALOG_RESULT, JSON.stringify(result));
  app.quit();
}, 1000);
