"use strict";

// Installs the package the way a user would: from the packed npm tarball into
// a clean project, then checks that the public entry points, the type
// declarations, and the CLI all arrived and resolve. Native compilation is
// skipped, so this proves the JavaScript surface ships correctly, not that the
// addon builds.

const assert = require("node:assert/strict");
const { execFileSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-tarball-"));

// npm is a .cmd shim on Windows, which execFileSync refuses to launch without
// a shell, so its arguments are quoted. node is launched directly.
function runNpm(args, cwd) {
  const command = [npm, ...args.map((argument) => JSON.stringify(argument))].join(" ");
  return execSync(command, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runNode(args, cwd) {
  return execFileSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

try {
  const packed = JSON.parse(runNpm(
    ["pack", "--json", "--pack-destination", workspace],
    root
  ));
  const [artifact] = packed;
  const shipped = new Set(artifact.files.map((file) => file.path));

  // The declarations and the runtime entry points must be inside the tarball,
  // not merely present in the working tree.
  for (const required of [
    "package.json",
    "runtime/index.js",
    "runtime/ipc.js",
    "types/index.d.ts",
    "types/ipc.d.ts",
    "types/bridge.d.ts",
    "bin/nodeviewjs.js"
  ]) {
    assert.ok(shipped.has(required), `packed tarball is missing ${required}`);
  }

  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(project, "package.json"),
    `${JSON.stringify({ name: "tarball-consumer", version: "1.0.0", private: true }, null, 2)}\n`
  );

  const tarball = path.join(workspace, artifact.filename);
  runNpm(["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"], project);

  const probe = path.join(project, "probe.js");
  fs.writeFileSync(probe, `"use strict";
const assert = require("node:assert/strict");
const runtime = require("nodeviewjs");
assert.deepEqual(Object.keys(runtime).sort(), [
  "App", "AppWindow", "Updater", "clipboard", "config", "dialog", "ipc", "net",
  "notification", "shell"
]);
assert.equal(require("nodeviewjs/ipc"), runtime.ipc);
assert.throws(
  () => require("nodeviewjs/runtime/app.js"),
  (error) => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
);
// A window can be configured without the native addon present.
const app = new runtime.App({ entry: __filename });
assert.equal(app.mainWindow.lifecycleState, "configured");
console.log("ok");
`);
  assert.equal(runNode([probe], project).trim(), "ok");

  const installed = path.join(project, "node_modules", "nodeviewjs");
  assert.ok(fs.existsSync(path.join(installed, "types", "index.d.ts")));
  assert.ok(fs.existsSync(path.join(installed, "bin", "nodeviewjs.js")));
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

console.log("Packed tarball install test passed.");
