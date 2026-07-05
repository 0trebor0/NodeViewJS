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
  run("powershell", ["-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "setup.ps1")]);
} else if (process.platform === "darwin" || process.platform === "linux") {
  run(process.execPath, [path.join(__dirname, "generate-bridge-header.js")]);
} else {
  throw new Error(`NodeViewJS setup is not implemented for ${process.platform} yet.`);
}
