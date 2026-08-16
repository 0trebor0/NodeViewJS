"use strict";

// Covers the three runtime-correctness contracts that need a running app and
// therefore cannot live in test/runtime-api.js: native callback error
// isolation, window lifecycle retention, and event subscription cleanup.

const assert = require("node:assert/strict");

const messageHandlers = new Map();
const menuHandlers = new Map();
const closedWindows = [];
let nextWindowId = 1;

const fakeNative = {
  closeAllWindows() {},
  closeWindow(id) { closedWindows.push(id); },
  createWindow() { return nextWindowId++; },
  hideWindow() {},
  loadFile() {},
  postMessage() {},
  reload() {},
  run() {},
  setApplicationMenu() {},
  setMessageHandler(id, handler) { messageHandlers.set(id, handler); },
  setMenuHandler(id, handler) { menuHandlers.set(id, handler); },
  setTray() {},
  showWindow() {}
};

const nativePath = require.resolve("../runtime/native");
require.cache[nativePath] = { exports: fakeNative };

const { App } = require("../runtime/app");
const ipc = require("../runtime/ipc");

const unhandledRejections = [];
process.on("unhandledRejection", (reason) => unhandledRejections.push(reason));

// Keeps the reported failures inspectable and off the real log file.
function captureReports(app) {
  const reports = [];
  app._reportError = (context, error) => reports.push({ context, error });
  return reports;
}

const originalConsoleError = console.error;

function silenceConsoleError() {
  console.error = () => {};
  return () => { console.error = originalConsoleError; };
}

async function settle() {
  for (let index = 0; index < 3; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function startApp(configure) {
  const app = new App({ entry: __filename });
  const reports = captureReports(app);
  configure?.(app);
  assert.equal(app.run(), true);
  const handleMessage = messageHandlers.get(app.mainWindow.id);
  assert.equal(typeof handleMessage, "function");
  return { app, reports, handleMessage };
}

async function testHandlerFailuresAreIsolated() {
  const { app, reports, handleMessage } = startApp();
  const restoreConsole = silenceConsoleError();
  const calls = [];

  // A synchronous throw, an async rejection, and a healthy handler on the same
  // event: every handler must still run and each failure must be reported.
  app.mainWindow.on("frontend-event", () => {
    calls.push("window-sync");
    throw new Error("window handler failed");
  });
  app.mainWindow.on("frontend-event", async () => {
    calls.push("window-async");
    throw new Error("window handler rejected");
  });
  app.mainWindow.on("frontend-event", () => { calls.push("window-ok"); });
  app.on("frontend-event", async () => {
    calls.push("app-async");
    throw new Error("app handler rejected");
  });
  app.on("frontend-event", () => { calls.push("app-ok"); });

  // Invoked the way the native binding does: fire and forget. Anything the
  // dispatch rejects with has nowhere to go but the unhandled-rejection hook.
  handleMessage(ipc.serialize(ipc.createEventMessage("frontend-event", { ok: true })));
  await settle();
  restoreConsole();

  assert.deepEqual(calls, [
    "window-sync",
    "window-async",
    "window-ok",
    "app-async",
    "app-ok"
  ]);
  assert.deepEqual(reports.map((report) => report.context), [
    "Window event 'frontend-event' failed",
    "Window event 'frontend-event' failed",
    "App event 'frontend-event' failed"
  ]);
  assert.deepEqual(unhandledRejections, []);

  app.quit();
}

async function testMenuCallbackFailureIsIsolated() {
  const { app, reports } = startApp();
  const restoreConsole = silenceConsoleError();
  const handleMenu = menuHandlers.get(app.mainWindow.id);
  assert.equal(typeof handleMenu, "function");

  const seen = [];
  app.mainWindow.on("menu", () => {
    seen.push("window");
    throw new Error("menu handler failed");
  });
  app.on("menu", () => { seen.push("app"); });

  handleMenu({ id: "file.open" });
  await settle();
  restoreConsole();

  assert.deepEqual(seen, ["window", "app"]);
  assert.deepEqual(reports.map((report) => report.context), ["Window event 'menu' failed"]);
  assert.deepEqual(unhandledRejections, []);

  app.quit();
}

async function testCommandFailureAnswersTheFrontend() {
  const { app, reports, handleMessage } = startApp((pending) => {
    pending.command("boom", () => { throw new Error("command failed"); });
  });
  const restoreConsole = silenceConsoleError();
  const responses = [];
  app.mainWindow._post = (message) => responses.push(JSON.parse(message));

  await handleMessage(JSON.stringify({ version: 1, type: "invoke", id: 11, command: "boom" }));
  await handleMessage(JSON.stringify({ version: 1, type: "invoke", id: 12, command: "missing" }));
  await settle();
  restoreConsole();

  assert.deepEqual(responses, [
    { version: 1, type: "response", id: 11, ok: false, error: "command failed" },
    { version: 1, type: "response", id: 12, ok: false, error: "Unknown command: missing" }
  ]);
  assert.deepEqual(reports.map((report) => report.context), ["IPC command 'boom' failed"]);
  assert.deepEqual(unhandledRejections, []);

  app.quit();
}

async function testFailingErrorReporterDoesNotEscape() {
  const { app, handleMessage } = startApp();
  const restoreConsole = silenceConsoleError();

  // The reporter is the last line of defence on a native callback boundary, so
  // its own failure must not become an unhandled rejection.
  app._reportError = () => { throw new Error("error logger failed"); };
  app.on("hostile", () => { throw new Error("handler failed"); });

  handleMessage(ipc.serialize(ipc.createEventMessage("hostile")));
  await settle();
  restoreConsole();

  assert.deepEqual(unhandledRejections, []);
  app._reportError = () => {};
  app.quit();
}

async function testTransientWindowsAreNotRetained() {
  const { app } = startApp();
  assert.deepEqual(app.windows, [app.mainWindow]);
  assert.equal(app.mainWindow.lifecycleState, "open");

  const closedWindowCountBefore = closedWindows.length;
  let lastWindow;
  for (let index = 0; index < 2000; index += 1) {
    const transient = app.createWindow({ title: `Transient ${index}` });
    transient.on("noop", () => {});
    assert.equal(transient.lifecycleState, "open");
    transient.close();
    lastWindow = transient;
  }

  // A long-running app must not accumulate its transient windows.
  assert.deepEqual(app.windows, [app.mainWindow]);
  assert.equal(closedWindows.length - closedWindowCountBefore, 2000);

  // The disposed window releases its handlers and refuses further use.
  assert.equal(lastWindow.lifecycleState, "disposed");
  assert.equal(lastWindow.isOpen, false);
  assert.equal(lastWindow.isClosed, true);
  assert.deepEqual(lastWindow._eventNames(), []);
  assert.throws(() => lastWindow.emit("late"), /Window has been disposed/);
  assert.throws(() => lastWindow._open(true), /cannot be reopened/);
  // close() stays idempotent after disposal.
  assert.equal(lastWindow.close(), lastWindow);

  // A broadcast reaches the live window and no longer visits disposed ones.
  let liveDeliveries = 0;
  let disposedDeliveries = 0;
  const liveEmit = app.mainWindow.emit.bind(app.mainWindow);
  app.mainWindow.emit = (...args) => { liveDeliveries += 1; return liveEmit(...args); };
  lastWindow.emit = () => { disposedDeliveries += 1; };
  app.emit("broadcast", { ok: true });
  assert.equal(liveDeliveries, 1);
  assert.equal(disposedDeliveries, 0);
  delete app.mainWindow.emit;

  app.quit();
  assert.deepEqual(app.windows, []);
  assert.equal(app.mainWindow.lifecycleState, "disposed");
}

function testStartupWindowsSurviveAFailedRun() {
  const app = new App({ entry: __filename });
  captureReports(app);
  const secondary = app.createWindow({ title: "Configured" });
  assert.equal(secondary.lifecycleState, "configured");

  // Before run() a close is part of startup recovery, so the window stays
  // listed and reopenable rather than being disposed.
  secondary.close();
  assert.equal(secondary.lifecycleState, "closed");
  assert.deepEqual(app.windows, [app.mainWindow, secondary]);

  assert.equal(app.run(), true);
  assert.equal(secondary.lifecycleState, "open");
  app.quit();
}

function testEventSubscriptionCleanup() {
  const app = new App({ entry: __filename });
  const window = app.mainWindow;

  for (const target of [app, window]) {
    assert.deepEqual(target._eventNames(), []);

    // The returned unsubscribe function must clean up exactly like off(),
    // including removing the now-empty event name.
    for (let index = 0; index < 5000; index += 1) {
      const off = target.on(`event-${index}`, () => {});
      off();
    }
    assert.deepEqual(target._eventNames(), []);

    // Unsubscribing twice is harmless.
    const handler = () => {};
    const off = target.on("repeated", handler);
    off();
    off();
    target.off("repeated", handler);
    assert.deepEqual(target._eventNames(), []);

    // off() only removes the event name once the last handler is gone.
    const first = () => {};
    const second = () => {};
    const offFirst = target.on("shared", first);
    target.on("shared", second);
    offFirst();
    assert.deepEqual(target._eventNames(), ["shared"]);
    target.off("shared", second);
    assert.deepEqual(target._eventNames(), []);
  }
}

async function testOnceReleasesItsWrapper() {
  const { app, handleMessage } = startApp();

  app.mainWindow.once("single", () => {});
  app.once("single", () => {});
  assert.deepEqual(app.mainWindow._eventNames(), ["single"]);
  assert.deepEqual(app._eventNames(), ["single"]);

  await handleMessage(ipc.serialize(ipc.createEventMessage("single")));

  // once() unsubscribes through the same path, so the event name goes too.
  assert.deepEqual(app.mainWindow._eventNames(), []);
  assert.deepEqual(app._eventNames(), []);

  app.quit();
}

async function main() {
  await testHandlerFailuresAreIsolated();
  await testMenuCallbackFailureIsIsolated();
  await testCommandFailureAnswersTheFrontend();
  await testFailingErrorReporterDoesNotEscape();
  await testTransientWindowsAreNotRetained();
  testStartupWindowsSurviveAFailedRun();
  testEventSubscriptionCleanup();
  await testOnceReleasesItsWrapper();
  await settle();
  assert.deepEqual(unhandledRejections, []);
  console.log("Window lifecycle and callback isolation test passed.");
}

main().catch((error) => {
  console.error = originalConsoleError;
  console.error(error);
  process.exit(1);
});
