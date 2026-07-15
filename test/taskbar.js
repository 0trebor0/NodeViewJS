"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { App } = require("../runtime/app");
const {
  normalizeAttentionType,
  normalizeOverlay,
  normalizeProgress
} = require("../runtime/taskbar");

assert.deepEqual(normalizeProgress(0.5, "paused"), { value: 0.5, state: "paused" });
assert.deepEqual(normalizeProgress(0, "indeterminate"), { value: 0, state: "indeterminate" });
assert.deepEqual(normalizeProgress(null), { value: 0, state: "none" });
assert.throws(() => normalizeProgress(-0.1), /between 0 and 1/);
assert.throws(() => normalizeProgress(1.1), /between 0 and 1/);
assert.throws(() => normalizeProgress(0.5, "complete"), /Unsupported taskbar progress state/);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-taskbar-"));
const icon = path.join(temporaryDirectory, "overlay.ico");
fs.writeFileSync(icon, Buffer.alloc(1));
try {
  assert.deepEqual(normalizeOverlay(icon, "Ready"), {
    icon: path.resolve(icon),
    description: "Ready"
  });
  assert.deepEqual(normalizeOverlay(null), { icon: null, description: "" });
  assert.throws(() => normalizeOverlay(path.join(temporaryDirectory, "overlay.png")), /\.ico format/);
  assert.throws(() => normalizeOverlay(path.join(temporaryDirectory, "missing.ico")), /not found/);
  assert.throws(() => normalizeOverlay(icon, "x".repeat(101)), /at most 100/);
  assert.throws(() => normalizeOverlay(icon, "Ready\nhidden"), /at most 100/);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

assert.equal(normalizeAttentionType(), "informational");
assert.equal(normalizeAttentionType("critical"), "critical");
assert.equal(normalizeAttentionType("stop"), "stop");
assert.throws(() => normalizeAttentionType("urgent"), /Unsupported window attention type/);

const app = new App({ entry: __filename });
assert.throws(() => app.setTaskbarProgress(0.5), /has not been opened/);
assert.throws(() => app.setTaskbarOverlay(null), /has not been opened/);
assert.throws(() => app.requestAttention(), /has not been opened/);

console.log("Taskbar API tests passed.");
