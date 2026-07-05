#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
for (const target of [
  path.join(root, "src-nodeview", "build"),
  path.join(root, "build", "nodeview"),
  path.join(root, "build", "portable"),
  path.join(root, "build", "macos")
]) {
  fs.rmSync(target, { recursive: true, force: true });
}
