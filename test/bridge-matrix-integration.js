"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { App } = require("../runtime");

if (process.platform !== "win32") {
  console.log("Bridge parameter matrix integration test skipped outside Windows.");
  process.exit(0);
}

const app = new App({
  title: "NodeViewJS Bridge Matrix Test",
  appId: "NodeViewJS.BridgeMatrixTest",
  entry: path.join(__dirname, "fixtures", "bridge-matrix.html")
});

let activeSlowCalls = 0;
let maximumSlowCalls = 0;
let clientEvents = 0;
let reloadCycles = 0;

app.command("matrix:echo", (payload) => payload);
app.command("matrix:noPayload", (payload) => payload === undefined);
app.command("matrix:undefinedResult", () => undefined);
app.command("matrix:throw", () => { throw new Error("matrix boom"); });
app.command("matrix:slow", async ({ index }) => {
  activeSlowCalls++;
  maximumSlowCalls = Math.max(maximumSlowCalls, activeSlowCalls);
  await new Promise((resolve) => setTimeout(resolve, 100));
  activeSlowCalls--;
  return index;
});
app.command("matrix:requestServerEvent", () => {
  app.emit("matrix:server-event", { source: "backend", values: [null, true, 3] });
  return true;
});
app.command("matrix:status", () => ({
  clientEvents,
  maximumSlowCalls,
  reloadCycles
}));

app.on("matrix:client-event", ({ source }) => {
  assert.equal(source, "frontend");
  clientEvents++;
  app.emit("matrix:client-event-ack", { received: true });
});
app.on("matrix:cycle", ({ cycle }) => {
  reloadCycles++;
  app.emit("matrix:cycle-ack", { cycle });
});

const timeout = setTimeout(() => {
  console.error("Bridge parameter matrix integration test timed out.");
  process.exit(1);
}, 30_000);

app.once("matrix:result", (result) => {
  clearTimeout(timeout);
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result.values, [
    null,
    true,
    false,
    0,
    -1,
    1.5,
    "Hello \u20ac \ud83d\ude00",
    [],
    {},
    { nested: [1, "two", false, null] }
  ]);
  assert.equal(result.noPayload, true);
  assert.equal(result.undefinedResult, true);
  assert.match(result.thrownError, /matrix boom/);
  assert.deepEqual(result.invalidErrors.map((error) => /size or complexity limit/.test(error)), [
    true, true, true, true, true, true
  ]);
  assert.equal(result.largeLength, 250_000);
  assert.deepEqual(result.slowResults, Array.from({ length: 64 }, (_, index) => index));
  assert.match(result.overflowError, /Too many pending/);
  assert.deepEqual(result.preReadyEvent, { queued: true, order: 1 });
  assert.deepEqual(result.serverEvent, {
    source: "backend",
    values: [null, true, 3]
  });
  assert.deepEqual(result.status, {
    clientEvents: 1,
    maximumSlowCalls: 64,
    reloadCycles: 3
  });
  console.log("Bridge parameter matrix integration test passed.");
  app.quit();
});

app.emit("matrix:pre-ready", { queued: true, order: 1 });
app.run();
