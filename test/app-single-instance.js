"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const nativePath = require.resolve("../runtime/native");
const coordinatorPath = require.resolve("../runtime/single-instance");
const appPath = require.resolve("../runtime/app");
const calls = [];
let secondInstanceHandler;
let menuHandler;

require.cache[nativePath] = {
  id: nativePath,
  filename: nativePath,
  loaded: true,
  exports: {
    createWindow(options) {
      calls.push(["createWindow", options.title, options.bridgeEmbedded]);
      return 1;
    },
    setMessageHandler() {},
    setMenuHandler(_id, handler) { menuHandler = handler; },
    setApplicationMenu(_id, menu) { calls.push(["setMenu", menu]); },
    loadFile() {},
    run() { calls.push(["run"]); },
    restoreWindow(id) { calls.push(["restore", id]); },
    showWindow(id) { calls.push(["show", id]); },
    closeWindow(id) { calls.push(["close", id]); },
    closeAllWindows() { calls.push(["closeAll"]); }
  }
};

class FakeSingleInstanceCoordinator {
  request(_payload, handler) {
    secondInstanceHandler = handler;
    return { primary: true, forwarded: Promise.resolve() };
  }

  close() {
    calls.push(["coordinatorClose"]);
  }
}

require.cache[coordinatorPath] = {
  id: coordinatorPath,
  filename: coordinatorPath,
  loaded: true,
  exports: { SingleInstanceCoordinator: FakeSingleInstanceCoordinator }
};
delete require.cache[appPath];

const { App } = require("../runtime/app");

async function main() {
  const app = new App({
    entry: __filename,
    singleInstance: true,
    protocols: ["test-app"],
    fileAssociations: [".testdoc"],
    menu: [{ id: "test.command", label: "Test command", accelerator: "Ctrl+T" }]
  });
  let received;
  const openedUrls = [];
  let openedFile;
  let selectedMenu;
  app.on("second-instance", (payload) => {
    received = payload;
  });
  app.on("open-url", (payload) => { openedUrls.push(payload); });
  app.on("open-file", (payload) => { openedFile = payload; });
  app.on("menu", (payload) => { selectedMenu = payload; });

  process.argv.push("test-app://open/initial");
  process.env.NODEVIEW_BRIDGE_EMBEDDED = "1";
  assert.equal(app.run(), true);
  delete process.env.NODEVIEW_BRIDGE_EMBEDDED;
  process.argv.pop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(openedUrls, [{ url: "test-app://open/initial", initial: true }]);
  assert.equal(typeof secondInstanceHandler, "function");
  assert.equal(typeof menuHandler, "function");
  assert.ok(calls.some(([name, _title, bridgeEmbedded]) => name === "createWindow" && bridgeEmbedded));
  menuHandler({ id: "test.command", checked: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(selectedMenu.id, "test.command");
  assert.equal(selectedMenu.checked, true);
  assert.equal(selectedMenu.window, app.mainWindow);
  const launchCwd = path.join(path.parse(process.cwd()).root, "Example");
  const payload = {
    args: ["test-app://open/example", "document.testdoc"],
    cwd: launchCwd
  };
  await secondInstanceHandler(payload);
  assert.deepEqual(received, payload);
  assert.deepEqual(openedUrls.at(-1), { url: "test-app://open/example", initial: false });
  assert.deepEqual(openedFile, {
    path: path.resolve(launchCwd, "document.testdoc"),
    initial: false
  });
  assert.ok(calls.some(([name]) => name === "restore"));
  assert.ok(calls.some(([name]) => name === "show"));

  app.quit();
  assert.ok(calls.some(([name]) => name === "coordinatorClose"));
  console.log("App single-instance lifecycle test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
