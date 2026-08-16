"use strict";

// Valid-but-hostile workloads. Everything here is well formed and permitted;
// there is simply a great deal of it, or it arrives faster than it can be
// consumed. The assertion in every case is that the runtime's own bookkeeping
// stays bounded, so a page cannot grow the backend without limit just by being
// busy.

const assert = require("node:assert/strict");

const messageHandlers = new Map();
let nextWindowId = 1;

const fakeNative = {
  closeAllWindows() {},
  closeWindow() {},
  createWindow() { return nextWindowId++; },
  hideWindow() {},
  loadFile() {},
  postMessage() {},
  reload() {},
  run() {},
  setApplicationMenu() {},
  setMessageHandler(id, handler) { messageHandlers.set(id, handler); },
  setMenuHandler() {},
  setTray() {},
  showWindow() {}
};

const nativePath = require.resolve("../runtime/native");
require.cache[nativePath] = { exports: fakeNative };

const { App } = require("../runtime/app");
const ipc = require("../runtime/ipc");

const unhandledRejections = [];
process.on("unhandledRejection", (reason) => unhandledRejections.push(reason));

function startApp(configure) {
  const app = new App({ entry: __filename });
  app._reportError = () => {};
  configure?.(app);
  assert.equal(app.run(), true);
  const handleMessage = messageHandlers.get(app.mainWindow.id);
  const posted = [];
  app.mainWindow._post = (message) => posted.push(message);
  return { app, handleMessage, posted };
}

function invoke(id, command, payload) {
  const message = { version: 1, type: "invoke", id, command };
  if (payload !== undefined) message.payload = payload;
  return JSON.stringify(message);
}

async function settle() {
  for (let index = 0; index < 3; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function heapUsed() {
  if (global.gc) global.gc();
  return process.memoryUsage().heapUsed;
}

async function testThousandsOfCommands() {
  const { app, handleMessage, posted } = startApp((pending) => {
    pending.command("echo", (payload) => payload);
  });

  const total = 10_000;
  for (let id = 1; id <= total; id += 1) {
    await handleMessage(invoke(id, "echo", { id }));
  }
  await settle();

  assert.equal(posted.length, total, "not every command was answered");

  // The replay memo is what could grow without limit: it remembers completed
  // request ids so a replayed id is refused. It must stay at its cap.
  const stats = app._ipcRequestStats(app.mainWindow);
  assert.equal(stats.active, 0, `requests were left active: ${stats.active}`);
  assert.equal(
    stats.completed,
    ipc.IPC_MAX_COMPLETED_REQUEST_IDS,
    `the completed-request memo is unbounded: ${stats.completed}`
  );

  // A replayed recent id is still refused, so the bound did not cost the
  // protection it exists for.
  posted.length = 0;
  await handleMessage(invoke(total, "echo", { id: total }));
  assert.match(JSON.parse(posted[0]).error, /Duplicate or replayed/);

  app.quit();
}

async function testThousandsOfEvents() {
  const { app, handleMessage } = startApp();
  let delivered = 0;
  app.on("flood", () => { delivered += 1; });

  for (let index = 0; index < 10_000; index += 1) {
    await handleMessage(ipc.serialize(ipc.createEventMessage("flood", { index })));
  }
  await settle();

  assert.equal(delivered, 10_000, "events were dropped");
  // Events are not remembered at all, so nothing accumulates.
  assert.deepEqual(app._ipcRequestStats(app.mainWindow), { active: 0, completed: 0 });
  assert.deepEqual(app._eventNames(), ["flood"]);

  app.quit();
}

async function testMaximumSizeMessagesRepeatedly() {
  const { app, handleMessage, posted } = startApp((pending) => {
    pending.command("sink", () => "ok");
  });

  // A payload close to the protocol ceiling, sent over and over.
  const chunk = "x".repeat(200_000);
  const before = heapUsed();
  for (let id = 1; id <= 200; id += 1) {
    await handleMessage(invoke(id, "sink", { chunk }));
  }
  await settle();
  const after = heapUsed();

  assert.equal(posted.length, 200);
  const stats = app._ipcRequestStats(app.mainWindow);
  assert.equal(stats.active, 0);
  assert.ok(stats.completed <= ipc.IPC_MAX_COMPLETED_REQUEST_IDS);

  // 200 messages of 200 KB is 40 MB of traffic. None of it may be retained.
  if (global.gc) {
    const growth = after - before;
    assert.ok(
      growth < 24 * 1024 * 1024,
      `large messages were retained: heap grew by ${Math.round(growth / 1024 / 1024)} MB`
    );
  }

  // Anything past the protocol ceiling is rejected outright rather than buffered.
  const oversized = JSON.stringify({
    version: 1,
    type: "invoke",
    id: 999,
    command: "sink",
    payload: { chunk: "y".repeat(ipc.IPC_MAX_SERIALIZED_BYTES) }
  });
  posted.length = 0;
  await handleMessage(oversized);
  await settle();
  assert.deepEqual(posted, [], "an oversized message was answered instead of dropped");

  app.quit();
}

async function testSlowHandlersAreCapped() {
  const releases = [];
  const { app, handleMessage, posted } = startApp((pending) => {
    pending.command("slow", () => new Promise((resolve) => releases.push(resolve)));
  });

  // Fill the concurrency window with handlers that never finish on their own.
  const dispatches = [];
  for (let id = 1; id <= ipc.IPC_MAX_CONCURRENT_REQUESTS; id += 1) {
    dispatches.push(handleMessage(invoke(id, "slow")));
  }
  await settle();

  assert.equal(releases.length, ipc.IPC_MAX_CONCURRENT_REQUESTS, "not every slow command started");
  assert.equal(app._ipcRequestStats(app.mainWindow).active, ipc.IPC_MAX_CONCURRENT_REQUESTS);
  assert.deepEqual(posted, [], "a slow command answered early");

  // One more is refused rather than queued, so a page cannot make the backend
  // hold unbounded work by being slow.
  await handleMessage(invoke(1_000, "slow"));
  await settle();
  assert.equal(posted.length, 1);
  assert.match(JSON.parse(posted[0]).error, /Too many concurrent IPC requests/);
  assert.equal(releases.length, ipc.IPC_MAX_CONCURRENT_REQUESTS, "the refused command still ran");

  // Releasing them frees the window again.
  for (const release of releases) release("done");
  await Promise.all(dispatches);
  await settle();
  assert.equal(app._ipcRequestStats(app.mainWindow).active, 0, "slow commands stayed active");

  posted.length = 0;
  // Not awaited before the release: this command only settles once released,
  // so awaiting it first would deadlock the test rather than the runtime.
  const reopened = handleMessage(invoke(1_001, "slow"));
  await settle();
  assert.equal(releases.length, ipc.IPC_MAX_CONCURRENT_REQUESTS + 1, "the window did not reopen");
  releases.at(-1)("done");
  await reopened;
  await settle();

  app.quit();
}

async function testFrontendThatNeverBecomesReady() {
  // The page never signals readiness, so every event stays in the readiness
  // buffer. That buffer is the one place the backend holds page-bound data, and
  // it is capped by both count and bytes.
  const app = new App({ entry: __filename });
  app._reportError = () => {};
  app.run();
  app.mainWindow._resetBridgeReady();
  app.mainWindow._post = () => {
    throw new Error("the page must not receive anything before it is ready");
  };

  let accepted = 0;
  let limit;
  try {
    for (let index = 0; index < 5_000; index += 1) {
      app.emit("tick", { index });
      accepted += 1;
    }
  } catch (error) {
    limit = error;
  }

  assert.ok(limit instanceof RangeError, "the readiness buffer accepted unlimited events");
  assert.match(limit.message, /readiness buffer limit/);
  assert.ok(accepted <= 1_024, `the buffer exceeded its documented count: ${accepted}`);

  // The same applies by size rather than count.
  const bytes = new App({ entry: __filename });
  bytes._reportError = () => {};
  bytes.run();
  bytes.mainWindow._resetBridgeReady();
  bytes.mainWindow._post = () => {};
  let sizeLimited = false;
  try {
    for (let index = 0; index < 200; index += 1) {
      bytes.emit("chunk", "x".repeat(100_000));
    }
  } catch (error) {
    sizeLimited = error instanceof RangeError;
  }
  assert.ok(sizeLimited, "the readiness buffer accepted unlimited bytes");

  app.quit();
  bytes.quit();
}

async function testRapidWindowChurnUnderTraffic() {
  const { app } = startApp((pending) => {
    pending.command("echo", (payload) => payload);
  });

  // Windows opening and closing while each one carries IPC traffic. Per-window
  // state must go with the window rather than accumulating on the app.
  const before = heapUsed();
  for (let index = 0; index < 500; index += 1) {
    const transient = app.createWindow({ title: `Churn ${index}` });
    const handle = messageHandlers.get(transient.id);
    transient._post = () => {};
    await handle(invoke(index + 1, "echo", { index }));
    transient.close();
  }
  await settle();
  const after = heapUsed();

  assert.deepEqual(app.windows, [app.mainWindow], "transient windows accumulated");
  if (global.gc) {
    const growth = after - before;
    assert.ok(
      growth < 16 * 1024 * 1024,
      `window churn retained memory: heap grew by ${Math.round(growth / 1024 / 1024)} MB`
    );
  }

  app.quit();
}

async function main() {
  await testThousandsOfCommands();
  await testThousandsOfEvents();
  await testMaximumSizeMessagesRepeatedly();
  await testSlowHandlersAreCapped();
  await testFrontendThatNeverBecomesReady();
  await testRapidWindowChurnUnderTraffic();

  await settle();
  assert.deepEqual(unhandledRejections, []);
  console.log(
    global.gc
      ? "Resource limit test passed (with heap measurement)."
      : "Resource limit test passed (run with --expose-gc for heap measurement)."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
