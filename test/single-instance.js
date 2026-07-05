"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

if (process.platform !== "win32") {
  console.log("Single-instance integration test skipped outside Windows.");
  process.exit(0);
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-single-instance-"));
const readyPath = path.join(temporaryDirectory, "ready");
const resultPath = path.join(temporaryDirectory, "result.json");
const errorPath = path.join(temporaryDirectory, "error.log");
const appId = `nodeviewjs-test-${process.pid}-${Date.now()}`;
const environment = {
  ...process.env,
  NODEVIEW_TEST_APP_ID: appId,
  NODEVIEW_TEST_READY: readyPath,
  NODEVIEW_TEST_RESULT: resultPath,
  NODEVIEW_TEST_ERROR: errorPath
};
const primaryFixture = path.join(__dirname, "fixtures", "single-instance-primary.js");
const secondaryFixture = path.join(__dirname, "fixtures", "single-instance-secondary.js");
const primary = spawn(process.execPath, [primaryFixture], {
  cwd: temporaryDirectory,
  env: environment,
  stdio: "ignore"
});

function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  if (!fs.existsSync(filePath)) {
    const detail = fs.existsSync(errorPath) ? fs.readFileSync(errorPath, "utf8") : "";
    throw new Error(`Timed out waiting for ${path.basename(filePath)}. ${detail}`.trim());
  }
}

try {
  waitForFile(readyPath, 5_000);
  const args = ["--open", "file with spaces.txt", "unicode-✓"];
  const secondary = spawnSync(process.execPath, [secondaryFixture, ...args], {
    cwd: temporaryDirectory,
    env: environment,
    encoding: "utf8",
    timeout: 10_000
  });
  assert.equal(secondary.error, undefined, secondary.error?.message);
  assert.equal(secondary.status, 0, secondary.stderr);
  waitForFile(resultPath, 5_000);
  assert.deepEqual(JSON.parse(fs.readFileSync(resultPath, "utf8")), {
    args,
    cwd: temporaryDirectory
  });
  assert.equal(fs.existsSync(errorPath), false, fs.existsSync(errorPath)
    ? fs.readFileSync(errorPath, "utf8")
    : "");
} finally {
  if (!primary.killed) primary.kill();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Single-instance integration test passed.");
