#!/usr/bin/env node
"use strict";

// Records the digests of the binaries built on this machine into
// native-checksums.json, under this platform's target key. Run it on each
// release platform after `npm run build`, commit the result, then publish the
// matching files to the binary host. install-native.js verifies downloads
// against these digests and against nothing else.

const fs = require("node:fs");
const path = require("node:path");

const { digestOf, readChecksums, resolveTarget } = require("./install-native");

const root = path.join(__dirname, "..");
const checksumPath = path.join(root, "native-checksums.json");
const buildDirectory = path.join(root, "build", "nodeview");

const target = resolveTarget();
if (!target) {
  console.error(`No prebuilt target is defined for ${process.platform}.`);
  process.exitCode = 1;
} else {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const checksums = readChecksums(checksumPath) ?? { version: manifest.version, artifacts: {} };
  checksums.version = manifest.version;

  const missing = target.files.filter(
    (file) => !fs.existsSync(path.join(buildDirectory, file))
  );
  if (missing.length > 0) {
    console.error(`Build output is missing: ${missing.join(", ")}`);
    console.error("Run `npm run build` first.");
    process.exitCode = 1;
  } else {
    for (const file of target.files) {
      const digest = digestOf(fs.readFileSync(path.join(buildDirectory, file)));
      checksums.artifacts[`${target.key}/${file}`] = digest;
      console.log(`${target.key}/${file} ${digest}`);
    }

    const ordered = {};
    for (const key of Object.keys(checksums.artifacts).sort()) {
      ordered[key] = checksums.artifacts[key];
    }
    // readChecksums() only returns the fields the installer needs, so the
    // explanatory comment is preserved from the file itself.
    const existing = fs.existsSync(checksumPath)
      ? JSON.parse(fs.readFileSync(checksumPath, "utf8"))
      : {};
    fs.writeFileSync(checksumPath, `${JSON.stringify({
      comment: existing.comment,
      version: checksums.version,
      artifacts: ordered
    }, null, 2)}\n`);
    console.log(`Recorded ${target.files.length} digests for ${target.key}.`);
  }
}
