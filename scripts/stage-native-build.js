#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const sourceRoot = path.join(root, "src-nodeview", "build", "Release");
const output = path.join(root, "build", "nodeview");
const addon = path.join(sourceRoot, "nodeview.node");

if (!fs.existsSync(addon)) {
  throw new Error(`Native build output was not found at ${addon}.`);
}

fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(addon, path.join(output, "nodeview.node"));

if (process.platform === "win32") {
  const launcher = path.join(sourceRoot, "nodeview_launcher.exe");
  if (!fs.existsSync(launcher)) {
    throw new Error(`Native launcher output was not found at ${launcher}.`);
  }
  fs.copyFileSync(launcher, path.join(output, "nodeview_launcher.exe"));
} else if (process.platform === "darwin" || process.platform === "linux") {
  const launcher = path.join(sourceRoot, "nodeview_launcher");
  if (!fs.existsSync(launcher)) {
    throw new Error(`Native launcher output was not found at ${launcher}.`);
  }
  fs.copyFileSync(launcher, path.join(output, "nodeview_launcher"));
  fs.chmodSync(path.join(output, "nodeview_launcher"), 0o755);
}

fs.rmSync(path.join(root, "src-nodeview", "build"), { recursive: true, force: true });
