"use strict";

// Covers the three runtime-correctness contracts that need a running app and
// therefore cannot live in test/runtime-api.js: native callback error
// isolation, window lifecycle retention, and event subscription cleanup.

const assert = require("node:assert/strict");

const messageHandlers = new Map();
const menuHandlers = new Map();
const closedWindows = [];
let closedAllWindows = 0;
let nextWindowId = 1;

const fakeNative = {
  closeAllWindows() { closedAllWindows += 1; },
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

  // The page gets the terse form. Guidance must not travel over IPC: it would
  // tell an untrusted page about the backend's configuration.
  assert.deepEqual(responses, [
    { version: 1, type: "response", id: 11, ok: false, error: "command failed" },
    { version: 1, type: "response", id: 12, ok: false, error: "Unknown command: missing" }
  ]);
  assert.deepEqual(reports.map((report) => report.context), [
    "IPC command 'boom' failed",
    "Unknown command 'missing'"
  ]);

  // The developer gets the explanation in the backend log: what failed, why,
  // and what to do next.
  const unknownCommandHelp = reports.at(-1).error.message;
  assert.match(unknownCommandHelp, /no backend command handles/);
  assert.match(unknownCommandHelp, /app\.command\("missing"/);
  assert.match(unknownCommandHelp, /Registered commands: boom/);

  assert.deepEqual(unhandledRejections, []);

  app.quit();
}

async function testPermissionDiagnostics() {
  // Denied by the app policy.
  {
    const { app, reports, handleMessage } = startApp((pending) => {
      pending.command("write", { permission: "fs:write" }, () => "ok");
    });
    const restoreConsole = silenceConsoleError();
    const responses = [];
    app.mainWindow._post = (message) => responses.push(JSON.parse(message));

    await handleMessage(JSON.stringify({ version: 1, type: "invoke", id: 21, command: "write" }));
    await settle();
    restoreConsole();

    assert.equal(responses[0].error, "Permission not granted for command 'write': fs:write");
    const help = reports.at(-1).error.message;
    assert.equal(reports.at(-1).context, "Permission denied for command 'write'");
    assert.match(help, /the app permission policy does not grant/);
    assert.match(help, /permissions: \["fs:write"\]/);
    app.quit();
  }

  // Granted by the app but narrowed away by the window it came from. Saying
  // which policy denied it is the whole point of the diagnostic.
  {
    const app = new App({ entry: __filename, permissions: ["fs:read", "fs:write"] });
    const reports = captureReports(app);
    app.command("write", { permission: "fs:write" }, () => "ok");
    const narrowed = app.createWindow({ title: "Narrowed", permissions: ["fs:read"] });
    assert.equal(app.run(), true);
    const restoreConsole = silenceConsoleError();
    const responses = [];
    narrowed._post = (message) => responses.push(JSON.parse(message));

    await app._handleWindowMessage(
      narrowed,
      JSON.stringify({ version: 1, type: "invoke", id: 22, command: "write" })
    );
    await settle();
    restoreConsole();

    assert.equal(responses[0].ok, false);
    const help = reports.at(-1).error.message;
    assert.match(help, /the window permission policy does not grant/);
    assert.match(help, /the window this call came from narrows it/);
    assert.match(help, /Window policy: allow \[fs:read\]/);
    app.quit();
  }
}

async function testMalformedMessageDiagnostics() {
  const { app, reports, handleMessage } = startApp();
  const restoreConsole = silenceConsoleError();

  // Garbage gets no reply, but the developer is told once — and only a bounded
  // number of times, so a hostile page cannot flood the log.
  for (let index = 0; index < 20; index += 1) {
    await handleMessage(`{"version": 99, "type": "nonsense", "index": ${index}}`);
  }
  await settle();
  restoreConsole();

  const malformed = reports.filter(
    (report) => report.context === "Malformed frontend message rejected"
  );
  assert.equal(malformed.length, 5, "malformed message reports must be rate limited");
  assert.match(malformed[0].error.message, /did not match the IPC schema/);
  assert.match(malformed[0].error.message, /NodeViewJS\.invoke\(\)/);
  assert.match(malformed.at(-1).error.message, /will not be reported/);

  // The quoted message is bounded, whatever the page sent.
  const { app: floodApp, reports: floodReports, handleMessage: floodHandle } = startApp();
  const quiet = silenceConsoleError();
  await floodHandle(`{"junk": "${"x".repeat(50_000)}"}`);
  await settle();
  quiet();
  assert.ok(
    floodReports.at(-1).error.message.length < 1000,
    "the quoted message must be bounded"
  );

  app.quit();
  floodApp.quit();
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

async function testLifecycleTransitions() {
  // configured -> open -> closed/disposed, and every way of leaving the path.
  const app = new App({ entry: __filename });
  captureReports(app);

  const beforeRun = app.createWindow({ title: "Before run" });
  assert.equal(beforeRun.lifecycleState, "configured");
  assert.equal(beforeRun.isOpen, false);
  assert.equal(beforeRun.isClosed, false);
  assert.equal(beforeRun.id, undefined);

  assert.equal(app.run(), true);
  assert.equal(beforeRun.lifecycleState, "open");
  assert.equal(beforeRun.isOpen, true);
  assert.equal(typeof beforeRun.id, "number");

  beforeRun.close();
  assert.equal(beforeRun.lifecycleState, "disposed");
  assert.equal(beforeRun.isOpen, false);
  assert.equal(beforeRun.isClosed, true);
  assert.equal(beforeRun.id, undefined);

  // Double, triple, and quadruple close stay harmless and do not re-enter the
  // native host.
  const closedBefore = closedWindows.length;
  for (let index = 0; index < 4; index += 1) {
    assert.equal(beforeRun.close(), beforeRun);
  }
  assert.equal(closedWindows.length, closedBefore, "closing again reached the native host");
  assert.equal(beforeRun.lifecycleState, "disposed");

  // Use after dispose: reads stay answerable, writes and sends refuse, and
  // nothing crashes.
  assert.deepEqual(beforeRun.getState(), { isOpen: false });
  assert.deepEqual(beforeRun._eventNames(), []);
  assert.equal(beforeRun.on("late", () => {}) instanceof Function, true);
  assert.throws(() => beforeRun.emit("late"), /disposed/);
  assert.throws(() => beforeRun._open(true), /cannot be reopened/);
  // Window controls on a disposed window are no-ops rather than crashes.
  for (const method of ["show", "hide", "reload", "minimize", "maximize", "restore"]) {
    assert.equal(beforeRun[method](), beforeRun, `${method}() should stay chainable`);
  }
  assert.equal(beforeRun.setTitle("Renamed"), beforeRun);
  // Operations that need a live window say so instead of failing obscurely.
  assert.throws(() => beforeRun.showContextMenu([{ id: "a", label: "A" }]), /has not been opened/);

  app.quit();
}

async function testFailedNativeCreation() {
  const app = new App({ entry: __filename });
  const reports = captureReports(app);
  assert.equal(app.run(), true);
  const restoreConsole = silenceConsoleError();

  // A window whose native creation fails must not be left half-registered.
  const originalCreate = fakeNative.createWindow;
  fakeNative.createWindow = () => { throw new Error("native window creation failed"); };
  try {
    assert.throws(() => app.createWindow({ title: "Doomed" }), /native window creation failed/);
  } finally {
    fakeNative.createWindow = originalCreate;
  }
  restoreConsole();

  assert.deepEqual(app.windows, [app.mainWindow], "a failed window stayed in the collection");

  // A failure after the id is assigned must also roll back: the window is
  // closed, disposed, and removed.
  let failedWindow;
  const originalLoad = fakeNative.loadFile;
  fakeNative.loadFile = () => { throw new Error("entry could not be loaded"); };
  try {
    assert.throws(() => { failedWindow = app.createWindow({ title: "Half open" }); },
      /entry could not be loaded/);
  } finally {
    fakeNative.loadFile = originalLoad;
  }
  assert.deepEqual(app.windows, [app.mainWindow], "a half-opened window stayed in the collection");

  // The app keeps working afterwards.
  const healthy = app.createWindow({ title: "Healthy" });
  assert.equal(healthy.lifecycleState, "open");
  healthy.close();
  assert.deepEqual(app.windows, [app.mainWindow]);
  assert.equal(reports.length >= 0, true);
  app.quit();
}

async function testShutdownDuringWindowCreation() {
  const app = new App({ entry: __filename });
  captureReports(app);
  assert.equal(app.run(), true);
  const restoreConsole = silenceConsoleError();

  // The application quits from inside native window creation, which is the
  // worst moment for it: the window is mid-open when its owner shuts down.
  const originalCreate = fakeNative.createWindow;
  let quitDuringCreate;
  fakeNative.createWindow = (...args) => {
    const id = originalCreate(...args);
    if (!quitDuringCreate) {
      quitDuringCreate = true;
      app.quit();
    }
    return id;
  };
  try {
    app.createWindow({ title: "Created during shutdown" });
  } catch (error) {
    // Either outcome is acceptable; what matters is the state afterwards.
    assert.ok(error instanceof Error);
  } finally {
    fakeNative.createWindow = originalCreate;
    restoreConsole();
  }

  // Whatever happened, the app must not be left holding a live window.
  for (const window of app.windows) {
    assert.notEqual(window.lifecycleState, "open", "a window survived shutdown as open");
  }
  assert.equal(app.mainWindow.lifecycleState, "disposed");
  // Quitting again after that is still harmless.
  assert.doesNotThrow(() => app.quit());
}

async function testPendingIpcIsReleasedOnClose() {
  let release;
  const { app, handleMessage } = startApp((pending) => {
    pending.command("slow", () => new Promise((resolve) => { release = resolve; }));
  });
  const restoreConsole = silenceConsoleError();
  const responses = [];
  app.mainWindow._post = (message) => responses.push(JSON.parse(message));

  // A command is still running when its window closes.
  const dispatched = handleMessage(
    JSON.stringify({ version: 1, type: "invoke", id: 31, command: "slow" })
  );
  await settle();
  assert.deepEqual(responses, [], "the slow command answered too early");

  app.mainWindow.close();
  assert.equal(app.mainWindow.lifecycleState, "disposed");

  // Completing afterwards must not throw out of the dispatch, and must not try
  // to deliver an answer to a window that is gone.
  release({ done: true });
  await dispatched;
  await settle();
  restoreConsole();

  assert.deepEqual(responses, [], "a response was delivered to a closed window");
  assert.deepEqual(unhandledRejections, []);

  // Buffered events and handlers went with it.
  assert.deepEqual(app.mainWindow._eventNames(), []);
  app.quit();
}

async function testShutdownOrder() {
  const order = [];
  const app = new App({ entry: __filename });
  captureReports(app);

  app.use({
    name: "shutdown.plugin",
    version: "1.0.0",
    setup() {
      order.push("plugin-setup");
      return () => order.push("plugin-cleanup");
    },
    start() { order.push("plugin-start"); },
    stop() { order.push("plugin-stop"); }
  });

  app.on("before-quit", (payload) => {
    order.push(`before-quit:${payload.windows}`);
    // New work is already refused at this point.
    assert.equal(app.isQuitting, true);
    assert.throws(() => app.createWindow({ title: "Too late" }), /shutting down/);
  });

  assert.equal(app.run(), true);
  const second = app.createWindow({ title: "Second" });
  assert.equal(app.isQuitting, false);

  app.quit();

  // The documented order: notify the app, then plugins, then close windows.
  assert.deepEqual(order, [
    "plugin-setup",
    "plugin-start",
    "before-quit:2",
    "plugin-stop",
    "plugin-cleanup"
  ]);
  assert.equal(app.isQuitting, true);
  assert.deepEqual(app.windows, []);
  assert.equal(app.mainWindow.lifecycleState, "disposed");
  assert.equal(second.lifecycleState, "disposed");
  assert.ok(closedAllWindows > 0, "native resources were not released");

  // Quitting again is a no-op: handlers do not run twice.
  const closedAllBefore = closedAllWindows;
  app.quit();
  assert.deepEqual(order.filter((entry) => entry.startsWith("before-quit")), ["before-quit:2"]);
  assert.equal(closedAllWindows, closedAllBefore, "the second quit reached the native host");
}

async function testShutdownWhileWorkIsInFlight() {
  let release;
  const { app, handleMessage } = startApp((pending) => {
    pending.command("slow", () => new Promise((resolve) => { release = resolve; }));
  });
  const restoreConsole = silenceConsoleError();
  const responses = [];
  app.mainWindow._post = (message) => responses.push(JSON.parse(message));

  let eventHandlerRan = 0;
  app.on("in-flight", () => { eventHandlerRan += 1; });

  // A command is running and an event is about to be delivered when the app
  // quits underneath both of them.
  const slowDispatch = handleMessage(
    JSON.stringify({ version: 1, type: "invoke", id: 41, command: "slow" })
  );
  await settle();

  app.quit();

  // Work arriving after shutdown began is ignored rather than started.
  await handleMessage(JSON.stringify({ version: 1, type: "invoke", id: 42, command: "slow" }));
  await handleMessage(ipc.serialize(ipc.createEventMessage("in-flight")));
  await settle();
  assert.equal(eventHandlerRan, 0, "an event was dispatched after shutdown began");

  // The in-flight command still settles, without throwing and without trying
  // to answer a window that no longer exists.
  release({ done: true });
  await slowDispatch;
  await settle();
  restoreConsole();

  assert.deepEqual(responses, [], "a response was delivered during or after shutdown");
  assert.deepEqual(unhandledRejections, []);
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
  await testPermissionDiagnostics();
  await testMalformedMessageDiagnostics();
  await testFailingErrorReporterDoesNotEscape();
  await testTransientWindowsAreNotRetained();
  await testLifecycleTransitions();
  await testFailedNativeCreation();
  await testShutdownDuringWindowCreation();
  await testPendingIpcIsReleasedOnClose();
  await testShutdownOrder();
  await testShutdownWhileWorkIsInFlight();
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
