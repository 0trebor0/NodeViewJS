"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { bundleRuntime } = require("../scripts/bundle-runtime");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-runtime-bundle-"));
const output = path.join(temporaryDirectory, "nodeview.js");

try {
  const result = bundleRuntime(path.join(__dirname, "..", "runtime"), output);
  assert.ok(result.files.includes("index.js"));
  assert.ok(result.files.includes("launch-routing.js"));
  assert.ok(result.files.includes("menu.js"));
  assert.ok(result.files.includes("taskbar.js"));
  assert.ok(fs.statSync(output).size > 0);
  assert.match(fs.readFileSync(output, "utf8"), /bundledAddon.*nodeview\.node/);
  const bundled = require(output);
  assert.equal(typeof bundled.App, "function");
  assert.equal(typeof bundled.clipboard.readText, "function");
  assert.equal(typeof bundled.shell.openExternal, "function");
  assert.equal(typeof bundled.Updater, "function");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Runtime bundle test passed.");
