"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { App } = require("../runtime");

const app = new App({
  title: "NodeViewJS Trusted Document Test",
  entry: path.join(__dirname, "fixtures", "trusted-main.html")
});

const trustedCalls = [];
let hostileCommands = 0;
let hostileEvents = 0;
let staleCommands = 0;
let staleEvents = 0;

app.command("trustedCaller", ({ page }) => {
  trustedCalls.push(page);
  return `trusted:${page}`;
});
app.command("hostileFrameCommand", () => {
  hostileCommands++;
  return "unexpected";
});
app.command("staleNavigationCommand", () => {
  staleCommands++;
  return "unexpected";
});
app.command("getIsolationStatus", () => ({
  hostileCommands,
  hostileEvents,
  staleCommands,
  staleEvents,
  trustedCalls: [...trustedCalls]
}));
app.on("hostile-frame-event", () => { hostileEvents++; });
app.on("stale-navigation-event", () => { staleEvents++; });

const timeout = setTimeout(() => {
  console.error("Trusted document integration test timed out.");
  process.exit(1);
}, 20_000);

app.once("trusted-document-result", (result) => {
  clearTimeout(timeout);
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.mainResult, "trusted:main");
  assert.equal(result.destinationResult, "trusted:destination");
  assert.equal(result.staleAttempted, true);
  assert.deepEqual(result.status, {
    hostileCommands: 0,
    hostileEvents: 0,
    staleCommands: 0,
    staleEvents: 0,
    trustedCalls: ["main", "destination"]
  });
  assert.deepEqual(result.frameReports.map(({ frame }) => frame).sort(), [
    "data",
    "local",
    "srcdoc"
  ]);
  for (const report of result.frameReports) {
    assert.equal(report.bridgeExposed, false, `Bridge leaked into ${report.frame} frame.`);
    if (process.platform === "win32") {
      assert.equal(report.rawAvailable, true, `Raw transport was unavailable in ${report.frame}.`);
    }
  }
  console.log("Trusted document integration test passed.");
  app.quit();
});

app.run();
