#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

function defaultExec(command, args) {
  return spawnSync(command, args, { encoding: "utf8", windowsHide: true });
}

function checkPython(exec, command, args = ["--version"]) {
  const result = exec(command, args);
  if (!result || result.error || result.status !== 0) return false;
  return /\bPython\s+3\./.test(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

// Shared with `nodeviewjs doctor`, which injects its own exec and environment so
// the detection can be tested without a Python installation.
function hasUsablePython(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Python detection options must be an object.");
  }
  const exec = options.exec ?? defaultExec;
  if (typeof exec !== "function") {
    throw new TypeError("Python detection exec must be a function.");
  }
  const env = options.env ?? process.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new TypeError("Python detection env must be an object.");
  }
  const platform = options.platform ?? process.platform;
  if (typeof platform !== "string" || platform.length === 0) {
    throw new TypeError("Python detection platform must be a non-empty string.");
  }

  const configured = env.PYTHON || env.npm_config_python;
  if (configured) {
    return checkPython(exec, configured);
  }
  if (platform === "win32" && checkPython(exec, "py", ["-3", "--version"])) return true;
  return checkPython(exec, "python3") || checkPython(exec, "python");
}

if (require.main === module && !hasUsablePython()) {
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

module.exports = { hasUsablePython };
