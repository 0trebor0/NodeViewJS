#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform === "win32") {
  run("powershell", ["-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "build.ps1")]);
} else if (process.platform === "darwin" || process.platform === "linux") {
  run(process.execPath, [path.join(__dirname, "generate-bridge-header.js")]);
  const nodeGyp = require.resolve("node-gyp/bin/node-gyp.js", { paths: [root] });
  run(process.execPath, [nodeGyp, "rebuild", "--directory", path.join(root, "src-nodeview")]);
  run(process.execPath, [path.join(__dirname, "stage-native-build.js")]);
} else {
  throw new Error(`NodeViewJS native builds are not implemented for ${process.platform} yet.`);
}
