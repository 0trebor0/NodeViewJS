"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

if (process.platform !== "win32") {
  console.log("Windows association registry test skipped outside Windows.");
  process.exit(0);
}

const result = spawnSync("powershell", [
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", path.join(__dirname, "windows-associations.ps1")
], { encoding: "utf8", timeout: 30_000 });

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
process.stdout.write(result.stdout);
