#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

function checkPython(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) return false;
  return /\bPython\s+3\./.test(`${result.stdout}\n${result.stderr}`);
}

function hasUsablePython() {
  const configured = process.env.PYTHON || process.env.npm_config_python;
  if (configured) {
    return checkPython(configured);
  }
  if (process.platform === "win32" && checkPython("py", ["-3", "--version"])) return true;
  return checkPython("python3") || checkPython("python");
}

if (!hasUsablePython()) {
  console.error("NodeViewJS native builds require Python 3 for node-gyp.");
  console.error("");
  console.error("Install Python 3, then retry:");
  console.error("  winget install Python.Python.3.12");
  console.error("");
  console.error("Or point node-gyp at an existing Python executable:");
  console.error("  $env:PYTHON = \"C:\\Path\\To\\python.exe\"");
  console.error("  npm run build");
  process.exit(1);
}
