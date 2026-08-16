"use strict";

// Integration tests for the two remaining dogfood shapes: a simple utility with
// no permissions at all, and an application built around a plugin and OS
// integration. Both are driven through the IPC layer, as a page would.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const messageHandlers = new Map();
const trayCalls = [];
const taskbarProgress = [];
const notifications = [];
const attention = [];
let nextWindowId = 1;

const fakeNative = {
  closeAllWindows() {},
  closeWindow() {},
  createWindow() { return nextWindowId++; },
  hideWindow() {},
  loadFile() {},
  postMessage() {},
  reload() {},
  requestWindowAttention(id, type) { attention.push(type); },
  run() {},
  setApplicationMenu() {},
  setMessageHandler(id, handler) { messageHandlers.set(id, handler); },
  setMenuHandler() {},
  setTaskbarProgress(id, value, state) { taskbarProgress.push({ value, state }); },
  setTray(id, tray) { trayCalls.push(tray); },
  // singleInstance: the example claims the lock, so the fake host grants it.
  claimSingleInstance() { return true; },
  releaseSingleInstance() {},
  showNotification(id, notification) { notifications.push(notification); },
  showWindow() {}
};

const nativePath = require.resolve("../runtime/native");
require.cache[nativePath] = { exports: fakeNative };

let nextRequestId = 1;

function createClient(app, window) {
  const responses = new Map();
  window._post = (message) => {
    const parsed = JSON.parse(message);
    if (parsed.type === "response") responses.set(parsed.id, parsed);
  };
  return async function invoke(command, payload) {
    const id = nextRequestId++;
    const message = { version: 1, type: "invoke", id, command };
    if (payload !== undefined) message.payload = payload;
    await app._handleWindowMessage(window, JSON.stringify(message));
    const response = responses.get(id);
    assert.ok(response, `no response for ${command}`);
    if (!response.ok) throw new Error(response.error);
    return response.result;
  };
}

/* ------------------------------------------ shape one: a simple utility */

async function testDigestUtility() {
  // Requiring the example runs it, which is what the simplest shape looks like:
  // no factory, no split, just an app and one command.
  const { app } = require("../examples/digest/app");
  app._reportError = () => {};
  const invoke = createClient(app, app.mainWindow);

  // An application that grants no permissions at all is a valid application.
  assert.deepEqual(app.options.permissions, undefined);

  const result = await invoke("digest:compute", { text: "nodeviewjs", algorithm: "sha256" });
  assert.equal(result.algorithm, "sha256");
  assert.equal(result.bytes, 10);
  assert.equal(
    result.hex,
    crypto.createHash("sha256").update("nodeviewjs").digest("hex"),
    "the digest is wrong"
  );
  assert.equal(result.base64, Buffer.from("nodeviewjs", "utf8").toString("base64"));

  // Unicode is measured in bytes, not characters.
  const unicode = await invoke("digest:compute", { text: "héllo 🌍", algorithm: "sha512" });
  assert.equal(unicode.bytes, Buffer.byteLength("héllo 🌍", "utf8"));

  for (const [payload, pattern] of [
    [{ text: 5, algorithm: "sha256" }, /must be a string/],
    [{ text: "x", algorithm: "rot13" }, /Algorithm must be one of/],
    [{ text: "x" }, /Algorithm must be one of/],
    [{ text: "x".repeat(100_001), algorithm: "sha256" }, /at most/],
    [undefined, /requires an object payload/]
  ]) {
    await assert.rejects(() => invoke("digest:compute", payload), pattern);
  }

  app.quit();
}

/* ------------------------ shape three: a plugin and OS integration */

async function testFocusTimer() {
  const { createFocusApp } = require("../examples/focus/create-app");

  // Time and the interval are injected, so a 25 minute session takes no time.
  let clock = 1_000_000;
  const ticks = [];
  const { app, controls } = createFocusApp({
    timer: {
      now: () => clock,
      setInterval: (handler) => { ticks.push(handler); return { unref() {} }; },
      clearInterval: () => { ticks.length = 0; }
    }
  });
  app._reportError = () => {};
  assert.equal(app.run(), true);
  const invoke = createClient(app, app.mainWindow);

  // The plugin registered itself with the permission it declared.
  assert.deepEqual(app.plugins, [{
    name: "focus.timer",
    version: "1.0.0",
    permissions: ["notification:show"]
  }]);

  // The tray was configured from the application options.
  assert.equal(trayCalls.length >= 1, true, "the tray was never configured");
  assert.deepEqual(
    trayCalls.at(-1).menu.map((item) => item.id ?? item.type),
    ["tray.show", "tray.start", "tray.stop", "separator", "tray.quit"]
  );

  /* ---------------------------------------------- the page drives it */

  const started = await invoke("focus.timer:start", { minutes: 25 });
  assert.deepEqual(started, { running: true, minutes: 25, remaining: 25 * 60 });

  // Starting a session is announced to the OS.
  assert.deepEqual(taskbarProgress.at(-1), { value: 0, state: "normal" });
  assert.match(notifications.at(-1).message, /25 minutes/);

  // Advance the clock and run a tick: progress follows the session.
  clock += 5 * 60_000;
  ticks[0]();
  assert.equal(taskbarProgress.at(-1).value.toFixed(2), "0.20");

  // Running out finishes the session, clears progress, and asks for attention.
  clock += 20 * 60_000;
  ticks[0]();
  assert.deepEqual(taskbarProgress.at(-1), { value: 0, state: "none" });
  assert.equal(attention.at(-1), "informational");
  assert.match(notifications.at(-1).message, /25 minute session complete/);
  assert.deepEqual(await invoke("focus.timer:state"), {
    running: false,
    minutes: 25,
    remaining: 0
  });

  /* ------------------------------------ validation at the plugin edge */

  for (const [payload, pattern] of [
    [{ minutes: 0 }, /between 1 and 180/],
    [{ minutes: 181 }, /between 1 and 180/],
    [{ minutes: 1.5 }, /between 1 and 180/],
    [{ minutes: "25" }, /between 1 and 180/],
    [[], /requires an object payload/]
  ]) {
    await assert.rejects(() => invoke("focus.timer:start", payload), pattern);
  }

  /* -------------------------------- the OS drives it: menu, tray, links */

  // A menu item starts a session without the page being involved.
  await app._handleMenuCommand(app.mainWindow, { id: "session.start" });
  assert.equal((await invoke("focus.timer:state")).running, true);
  assert.match(notifications.at(-1).message, /session started/);

  // A tray item stops it.
  await app._handleMenuCommand(app.mainWindow, { id: "tray.stop", source: "tray" });
  assert.equal((await invoke("focus.timer:state")).running, false);

  app.quit();
  assert.equal(app.isQuitting, true);
  // Shutdown cleared the taskbar and released the plugin's interval.
  assert.deepEqual(taskbarProgress.at(-1), { value: 0, state: "none" });
  assert.equal(ticks.length, 0, "the plugin's interval outlived the app");
}

// A focus:// link starts a session of the requested length. This goes through
// the runtime's real launch routing rather than calling the handler directly:
// run() routes the process arguments on the next microtask.
async function testDeepLinkStartsASession() {
  const { createFocusApp } = require("../examples/focus/create-app");

  let clock = 2_000_000;
  const { app, controls } = createFocusApp({
    timer: {
      now: () => clock,
      setInterval: () => ({ unref() {} }),
      clearInterval: () => {}
    }
  });
  app._reportError = () => {};

  const originalArgv = process.argv;
  process.argv = [process.argv[0], "app.js", "focus://start/45"];
  try {
    assert.equal(app.run(), true);
    // Launch routing is scheduled with queueMicrotask and awaits its handlers.
    for (let index = 0; index < 5; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    process.argv = originalArgv;
  }

  const state = controls.snapshot();
  assert.equal(state.running, true, "the focus:// link did not start a session");
  assert.equal(state.minutes, 45, `the link's duration was ignored: ${state.minutes}`);
  assert.match(notifications.at(-1).message, /45 minutes/);

  app.quit();
}

async function main() {
  await testDigestUtility();
  await testFocusTimer();
  await testDeepLinkStartsASession();
  console.log("Example application shapes test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
