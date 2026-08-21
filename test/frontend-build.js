"use strict";

// Verifies the mechanics wiki/Frontend-Build-Tools.md documents, using a
// hand-written stand-in for bundler output so no bundler is installed to run
// the test.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { collectPackageFiles, copyPackageInputs } = require("../scripts/package-inputs");
const { BRIDGE_MARKER, PACKAGED_BRIDGE_PATH, embedBridgeInDirectory } =
  require("../scripts/embed-bridge-html");
const { isFrontendFile } = require("../runtime/dev-watcher");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-frontend-build-"));
const project = path.join(temporaryRoot, "project");
const distribution = path.join(project, "dist");
const bundleDirectory = path.join(distribution, "assets");

try {
  fs.mkdirSync(bundleDirectory, { recursive: true });
  fs.mkdirSync(path.join(project, "node_modules", "left-pad"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({
    name: "frontend-build-test",
    version: "1.0.0",
    nodeviewjs: { name: "FrontendBuildTest", entry: "app.js" }
  }, null, 2));
  fs.writeFileSync(path.join(project, "app.js"), "require('nodeviewjs');");
  // A bundler emits the page, hashed assets, and a source map beside them.
  fs.writeFileSync(path.join(distribution, "index.html"), [
    "<!doctype html>",
    "<html>",
    "  <head>",
    '    <link rel="stylesheet" href="/assets/app-a1b2c3.css">',
    '    <script type="module" src="/assets/app-a1b2c3.js"></script>',
    "  </head>",
    "  <body><div id=\"root\"></div></body>",
    "</html>"
  ].join("\n"));
  fs.writeFileSync(path.join(bundleDirectory, "app-a1b2c3.js"), "export const mount = () => {};");
  fs.writeFileSync(path.join(bundleDirectory, "app-a1b2c3.css"), "#root { color: red; }");
  fs.writeFileSync(path.join(bundleDirectory, "app-a1b2c3.js.map"), "{}");
  fs.writeFileSync(path.join(project, "node_modules", "left-pad", "index.js"), "module.exports = 1;");

  // The backend entry sits at the project root, so its directory is what gets
  // packaged: the build output needs no `include` entry, and `dist` is not one
  // of the default exclusions the way `build` is.
  const collected = collectPackageFiles(project, { scanSecrets: false });
  const packaged = collected.files.map(({ relative }) => relative);
  assert.ok(packaged.includes("app.js"));
  assert.ok(packaged.includes("dist/index.html"));
  assert.ok(packaged.includes("dist/assets/app-a1b2c3.js"));
  assert.ok(packaged.includes("dist/assets/app-a1b2c3.css"));
  // Source maps expose original sources and are excluded by default.
  assert.ok(!packaged.includes("dist/assets/app-a1b2c3.js.map"));
  assert.ok(!packaged.some((file) => file.startsWith("node_modules/")));

  const staged = path.join(project, "staged");
  copyPackageInputs(project, staged);
  const embedded = embedBridgeInDirectory(staged, path.join(__dirname, "..", "runtime", "bridge.js"));
  assert.equal(embedded, 1);
  assert.ok(fs.existsSync(path.join(staged, PACKAGED_BRIDGE_PATH)));

  // The bridge script is inserted at the top of <head>, so window.NodeViewJS
  // exists before the bundle that mounts the application runs.
  const page = fs.readFileSync(path.join(staged, "dist", "index.html"), "utf8");
  assert.ok(page.includes(BRIDGE_MARKER));
  assert.ok(page.indexOf(BRIDGE_MARKER) < page.indexOf("app-a1b2c3.js"));

  // Development reloads watch the directory holding the page. Its own name is
  // not part of the paths the watcher reports, so build output under it is
  // watched even though a nested `dist` would be ignored.
  assert.equal(isFrontendFile("index.html"), true);
  assert.equal(isFrontendFile(path.join("assets", "app-a1b2c3.js")), true);
  assert.equal(isFrontendFile(path.join("assets", "app-a1b2c3.css")), true);
  assert.equal(isFrontendFile(path.join("dist", "index.html")), false);

  console.log("Frontend build integration test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
