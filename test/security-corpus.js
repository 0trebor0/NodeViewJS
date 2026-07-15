"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ipc = require("../runtime/ipc");
const { parseIntegrityManifest } = require("../scripts/package-integrity");
const { collectPackageSurfaceFiles, scanText } = require("../scripts/security-scan");

const corpus = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "security-corpus.json"),
  "utf8"
));

for (const sample of corpus.ipc) {
  assert.equal(ipc.parseMessage(sample), undefined, `IPC corpus sample was accepted: ${sample}`);
}

for (const sample of corpus.integrity) {
  assert.throws(
    () => parseIntegrityManifest(sample),
    /manifest|entry|encoding|path/i,
    `Integrity corpus sample was accepted: ${sample}`
  );
}

assert.deepEqual(scanText("safe.js", "const ok = 'plain text';\n"), []);
assert.deepEqual(scanText("safe.js", "const tab = '\t';\r\n"), []);
assert.deepEqual(
  scanText("trojan-source.js", "if (admin) {\u202E // hidden direction\n"),
  [{ file: "trojan-source.js", pattern: "bidirectional control character" }]
);
assert.deepEqual(
  scanText("hidden-control.js", "const value = 'safe\u001B[31m';\n"),
  [{ file: "hidden-control.js", pattern: "hidden control character" }]
);

const packageSurfaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-security-surface-"));
try {
  fs.mkdirSync(path.join(packageSurfaceRoot, "runtime", "generated"), { recursive: true });
  fs.mkdirSync(path.join(packageSurfaceRoot, "build"), { recursive: true });
  fs.writeFileSync(path.join(packageSurfaceRoot, "package.json"), JSON.stringify({
    name: "surface-test",
    version: "1.0.0",
    files: ["runtime", "build"]
  }));
  fs.writeFileSync(path.join(packageSurfaceRoot, "runtime", "index.js"), "module.exports = {};\n");
  fs.writeFileSync(path.join(packageSurfaceRoot, "runtime", "generated", "bridge.js"), "generated\n");
  fs.writeFileSync(path.join(packageSurfaceRoot, "build", "local.txt"), "ignored\n");
  assert.deepEqual(collectPackageSurfaceFiles(packageSurfaceRoot), [
    "build/local.txt",
    "package.json",
    "runtime/generated/bridge.js",
    "runtime/index.js"
  ]);
} finally {
  fs.rmSync(packageSurfaceRoot, { recursive: true, force: true });
}

console.log("Security malformed-input corpus passed.");
