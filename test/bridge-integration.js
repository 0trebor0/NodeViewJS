"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { App } = require("../runtime");

const app = new App({
  title: "NodeViewJS Bridge Test",
  icon: path.join(__dirname, "fixtures", "missing-icon.ico"),
  entry: path.join(__dirname, "fixtures", "bridge.html"),
  permissions: {
    allow: ["fs:*", "dialog:open:settings"],
    deny: ["fs:write"]
  }
});

const timeout = setTimeout(() => {
  console.error("Bridge integration test timed out.");
  process.exit(1);
}, 15_000);

app.command("greet", ({ name }) => {
  if (name !== "integration") {
    throw new Error("The frontend payload did not reach Node correctly.");
  }
  return "Hello integration from NodeViewJS.";
});

app.command("getOutsideNavigationUrl", () => {
  return pathToFileURL(path.join(__dirname, "runtime-api.js")).href;
});

app.command("readConfig", { permission: "fs:read", scope: "config" }, () => {
  return { ok: true };
});

let deniedCommandWasCalled = false;
app.command("writeConfig", { permission: "fs:write" }, () => {
  deniedCommandWasCalled = true;
  return { ok: false };
});

app.command("openSettings", { permission: "dialog:open", scope: "settings" }, () => {
  return { scope: "settings" };
});

let deniedScopeCommandWasCalled = false;
app.command("openAdmin", { permission: "dialog:open", scope: "admin" }, () => {
  deniedScopeCommandWasCalled = true;
  return { scope: "admin" };
});

app.command("readSettings", {
  permissions: ["fs:read:config", "dialog:open:settings"]
}, () => ({ allGranted: true }));

let removedBackendHandlerWasCalled = false;
function removedBackendHandler() {
  removedBackendHandlerWasCalled = true;
}
app.on("removed-backend-event", removedBackendHandler);
app.off("removed-backend-event", removedBackendHandler);

let unsupportedVersionHandlerWasCalled = false;
app.on("unsupported-version-event", () => {
  unsupportedVersionHandlerWasCalled = true;
});

app.on("frontend-ready", () => {
  app.emit("server-event", { value: 1 });
  app.emit("server-event", { value: 2 });
});

app.once("bridge-test-result", ({
  result,
  eventCount,
  offCount,
  serverVersion,
  allowedPermissionResult,
  deniedPermissionError,
  allowedScopeResult,
  deniedScopeError,
  multiplePermissionResult,
  unknownCommandError,
  invalidCommandError,
  invalidEventError,
  remoteNavigationUrl,
  outsideNavigationUrl
}) => {
  clearTimeout(timeout);
  if (process.platform === "win32") {
    assert.ok(
      fs.existsSync(app.options.webViewDataDirectory),
      `WebView profile directory was not created: ${app.options.webViewDataDirectory}`
    );
  }
  if (result !== "Hello integration from NodeViewJS.") {
    console.error("Frontend did not receive the expected command response.");
    process.exit(1);
  }
  if (eventCount !== 1) {
    console.error("Frontend once() handler did not fire exactly once.");
    process.exit(1);
  }
  if (offCount !== 0) {
    console.error("Frontend off() handler was still called after removal.");
    process.exit(1);
  }
  if (removedBackendHandlerWasCalled) {
    console.error("Backend off() handler was still called after removal.");
    process.exit(1);
  }
  if (unsupportedVersionHandlerWasCalled) {
    console.error("Backend accepted an unsupported IPC version.");
    process.exit(1);
  }
  if (serverVersion !== 1) {
    console.error("Backend event did not include IPC version 1.");
    process.exit(1);
  }
  if (!allowedPermissionResult || allowedPermissionResult.ok !== true) {
    console.error("Allowed command permission did not run successfully.");
    process.exit(1);
  }
  if (!/Permission not granted/.test(String(deniedPermissionError))) {
    console.error("Denied command permission did not reject with a permission error.");
    process.exit(1);
  }
  if (deniedCommandWasCalled) {
    console.error("Denied command handler was called.");
    process.exit(1);
  }
  if (!allowedScopeResult || allowedScopeResult.scope !== "settings") {
    console.error("The exact scoped permission was not allowed.");
    process.exit(1);
  }
  if (!/dialog:open:admin/.test(String(deniedScopeError))) {
    console.error("A command outside the granted scope was not denied.");
    process.exit(1);
  }
  if (deniedScopeCommandWasCalled) {
    console.error("The denied scoped command handler was called.");
    process.exit(1);
  }
  if (!multiplePermissionResult || multiplePermissionResult.allGranted !== true) {
    console.error("A command with multiple granted permissions was rejected.");
    process.exit(1);
  }
  if (!/Unknown command: missingCommand/.test(String(unknownCommandError))) {
    console.error("Frontend did not reject an unregistered command.");
    process.exit(1);
  }
  if (!/non-empty command name/.test(String(invalidCommandError))) {
    console.error("Frontend did not reject an invalid command name.");
    process.exit(1);
  }
  if (!/non-empty event name/.test(String(invalidEventError))) {
    console.error("Frontend did not reject an invalid event name.");
    process.exit(1);
  }
  const expectedEntrySuffix = process.platform === "win32"
    ? "https://app.nodeview.local/bridge.html"
    : "/fixtures/bridge.html";
  if (!String(remoteNavigationUrl).endsWith(expectedEntrySuffix)) {
    console.error(`WebView accepted a remote top-level navigation: ${remoteNavigationUrl}`);
    process.exit(1);
  }
  if (outsideNavigationUrl !== remoteNavigationUrl) {
    console.error(`WebView escaped the local app directory: ${outsideNavigationUrl}`);
    process.exit(1);
  }

  console.log("Bridge integration test passed.");
  app.quit();
});

if (process.platform === "win32") {
  assert.throws(() => app.run(), /Could not load the window icon/);
  app.options.icon = undefined;
}
app.run();
