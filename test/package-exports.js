"use strict";

// Proves that the published package exposes exactly the entry points it means
// to: the root API, the advanced ipc subpath, and package.json. Everything
// else must stay unreachable so internal runtime files cannot become an
// accidental public API through deep imports.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = require(path.join(root, "package.json"));

assert.deepEqual(Object.keys(manifest.exports), [".", "./ipc", "./package.json"]);
assert.equal(manifest.exports["."].default, "./runtime/index.js");
assert.equal(manifest.exports["./ipc"].default, "./runtime/ipc.js");
assert.equal(manifest.exports["."].types, "./types/index.d.ts");
assert.equal(manifest.exports["./ipc"].types, "./types/ipc.d.ts");
assert.equal(manifest.types, "types/index.d.ts");
assert.ok(manifest.files.includes("types"), "types/ must ship with the package");

// Every declared target has to exist, otherwise the package resolves to
// nothing once installed.
for (const target of [
  manifest.exports["."].default,
  manifest.exports["."].types,
  manifest.exports["./ipc"].default,
  manifest.exports["./ipc"].types
]) {
  assert.ok(fs.existsSync(path.join(root, target)), `missing export target: ${target}`);
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-exports-"));
try {
  const modules = path.join(workspace, "node_modules");
  fs.mkdirSync(modules);
  // A junction works on Windows without elevation and behaves like a symlink
  // for module resolution on every supported platform.
  fs.symlinkSync(root, path.join(modules, "nodeviewjs"), "junction");
  const consumer = createRequire(path.join(workspace, "consumer.js"));

  assert.equal(
    consumer.resolve("nodeviewjs"),
    path.join(root, "runtime", "index.js")
  );
  assert.equal(
    consumer.resolve("nodeviewjs/ipc"),
    path.join(root, "runtime", "ipc.js")
  );
  assert.equal(
    consumer.resolve("nodeviewjs/package.json"),
    path.join(root, "package.json")
  );

  // Internal modules and the raw file layout must not resolve.
  for (const specifier of [
    "nodeviewjs/runtime/app.js",
    "nodeviewjs/runtime/native.js",
    "nodeviewjs/runtime/index.js",
    "nodeviewjs/runtime/single-instance.js",
    "nodeviewjs/scripts/build.js",
    "nodeviewjs/bin/nodeviewjs.js"
  ]) {
    assert.throws(
      () => consumer.resolve(specifier),
      (error) => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
      `${specifier} must not be importable`
    );
  }

  // The root export is the documented public surface.
  assert.deepEqual(Object.keys(consumer("nodeviewjs")).sort(), [
    "App",
    "AppWindow",
    "Updater",
    "clipboard",
    "config",
    "dialog",
    "ipc",
    "net",
    "notification",
    "shell"
  ]);
  assert.equal(consumer("nodeviewjs/ipc"), consumer("nodeviewjs").ipc);
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log("Package exports test passed.");
