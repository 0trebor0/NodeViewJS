"use strict";

const assert = require("node:assert/strict");

const messageHandlers = new Map();
const postedMessages = [];
const closedWindows = [];
let nextWindowId = 1;

const fakeNative = {
  closeAllWindows() {},
  closeWindow(id) { closedWindows.push(id); },
  createWindow() { return nextWindowId++; },
  hideWindow() {},
  loadFile() {},
  postMessage(id, message) { postedMessages.push({ id, message: JSON.parse(message) }); },
  reload() {},
  run() {},
  setMessageHandler(id, handler) { messageHandlers.set(id, handler); },
  setMenuHandler() {},
  setTray() {},
  showWindow() {}
};

const nativePath = require.resolve("../runtime/native");
require.cache[nativePath] = { exports: fakeNative };

const { App } = require("../runtime/app");

async function main() {
  const lifecycle = [];
  let context;
  let receivedEvent;
  const app = new App({ entry: __filename, permissions: ["fs:read"] });
  const plugin = {
    name: "example.settings",
    version: "1.0.0",
    permissions: ["fs:read"],
    setup(pluginContext, options) {
      context = pluginContext;
      assert.equal(Object.isFrozen(pluginContext), true);
      assert.equal(Object.isFrozen(options), true);
      assert.equal(options.prefix, "settings");
      pluginContext.command("read", {
        permission: "fs:read",
        scope: "config"
      }, ({ key }) => ({ key, source: options.prefix }));
      pluginContext.on("changed", (payload) => { receivedEvent = payload; });
      lifecycle.push("setup");
      return () => lifecycle.push("cleanup");
    },
    start(pluginContext) {
      assert.equal(pluginContext, context);
      lifecycle.push("start");
    },
    stop(pluginContext) {
      assert.equal(pluginContext, context);
      lifecycle.push("stop");
    }
  };

  assert.equal(app.use(plugin, { prefix: "settings" }), app);
  assert.deepEqual(app.plugins, [{
    name: "example.settings",
    version: "1.0.0",
    permissions: ["fs:read"]
  }]);
  assert.equal(Object.isFrozen(app.plugins[0]), true);
  assert.throws(() => context.command("late", () => {}), /during setup/);

  app.run();
  assert.deepEqual(lifecycle, ["setup", "start"]);
  const windowId = app.mainWindow.id;
  const handleMessage = messageHandlers.get(windowId);
  await handleMessage(JSON.stringify({
    version: 1,
    type: "event",
    event: "nodeview:ready"
  }));
  await handleMessage(JSON.stringify({
    version: 1,
    type: "invoke",
    id: 7,
    command: "example.settings:read",
    payload: { key: "theme" }
  }));
  assert.deepEqual(postedMessages.at(-1).message, {
    version: 1,
    type: "response",
    id: 7,
    ok: true,
    result: { key: "theme", source: "settings" }
  });

  await handleMessage(JSON.stringify({
    version: 1,
    type: "event",
    event: "example.settings:changed",
    payload: { theme: "dark" }
  }));
  assert.deepEqual(receivedEvent, { theme: "dark" });

  context.emit("ready", { loaded: true });
  assert.deepEqual(postedMessages.at(-1).message, {
    version: 1,
    type: "event",
    event: "example.settings:ready",
    payload: { loaded: true }
  });

  app.quit();
  assert.deepEqual(lifecycle, ["setup", "start", "stop", "cleanup"]);
  assert.ok(closedWindows.includes(windowId));
  assert.throws(() => context.emit("late"), /disposed/);

  let deniedSetup = false;
  const deniedApp = new App({ entry: __filename });
  assert.throws(() => deniedApp.use({
    name: "denied.plugin",
    permissions: ["fs:write"],
    setup() { deniedSetup = true; }
  }), /Permission not granted/);
  assert.equal(deniedSetup, false);

  const undeclaredApp = new App({ entry: __filename, permissions: ["fs:read"] });
  assert.throws(() => undeclaredApp.use({
    name: "scoped.plugin",
    permissions: [],
    setup(pluginContext) {
      pluginContext.command("read", { permission: "fs:read" }, () => null);
    }
  }), /did not declare permission/);
  assert.deepEqual(undeclaredApp.plugins, []);
  assert.equal(undeclaredApp.use({ name: "scoped.plugin" }), undeclaredApp);
  assert.throws(() => undeclaredApp.use({ name: "scoped.plugin" }), /already registered/);

  let rolledBack = false;
  const collisionApp = new App({ entry: __filename });
  collisionApp.command("collision.plugin:read", () => null);
  assert.throws(() => collisionApp.use({
    name: "collision.plugin",
    setup(pluginContext) {
      pluginContext.command("read", () => null);
      return () => { rolledBack = true; };
    }
  }), /Command already registered/);
  assert.equal(rolledBack, true);
  assert.deepEqual(collisionApp.plugins, []);

  const asyncApp = new App({ entry: __filename });
  assert.throws(() => asyncApp.use({
    name: "async.plugin",
    async setup() {}
  }), /must be synchronous/);
  assert.deepEqual(asyncApp.plugins, []);

  assert.throws(
    () => new App({ entry: __filename }).use({ name: "Invalid Plugin" }),
    /lowercase dot-or-hyphen/
  );
  assert.throws(
    () => new App({ entry: __filename }).use({ name: "valid", permissions: "fs:read" }),
    /permissions must be an array/
  );

  console.log("Plugin test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
