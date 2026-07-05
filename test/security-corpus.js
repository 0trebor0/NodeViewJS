"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ipc = require("../runtime/ipc");
const { parseIntegrityManifest } = require("../scripts/package-integrity");

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

console.log("Security malformed-input corpus passed.");
