"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { App } = require("../runtime");

if (process.platform !== "win32") {
  console.log("IPC security integration test skipped outside Windows.");
  process.exit(0);
}

const app = new App({
  title: "NodeViewJS IPC Security Test",
  appId: "NodeViewJS.IpcSecurityTest",
  entry: path.join(__dirname, "fixtures", "ipc-security.html")
});

let sensitiveCalls = 0;
let malformedEvents = 0;
let duplicateCalls = 0;
let concurrentCalls = 0;

app.command("sensitiveCommand", () => { sensitiveCalls++; });
app.command("duplicateProbe", async () => {
  duplicateCalls++;
  await new Promise((resolve) => setTimeout(resolve, 100));
});
app.command("concurrencyProbe", async () => {
  concurrentCalls++;
  await new Promise((resolve) => setTimeout(resolve, 400));
});
app.command("getIpcSecurityStatus", () => ({
  sensitiveCalls,
  malformedEvents,
  duplicateCalls,
  concurrentCalls
}));
app.on("malformed-security-event", () => { malformedEvents++; });

const timeout = setTimeout(() => {
  console.error("IPC security integration test timed out.");
  process.exit(1);
}, 15_000);

app.once("ipc-security-result", (result) => {
  clearTimeout(timeout);
  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(result, {
    sensitiveCalls: 0,
    malformedEvents: 0,
    duplicateCalls: 1,
    concurrentCalls: 64
  });
  console.log("IPC security integration test passed.");
  app.quit();
});

app.run();
