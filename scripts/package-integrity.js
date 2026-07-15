#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_NAME = "integrity.manifest";
const MANIFEST_HEADER = "NODEVIEWJS-INTEGRITY 1 SHA256";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UNSAFE_PATH_CHARACTER_PATTERN = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function collectFiles(resourcesDirectory) {
  const root = fs.realpathSync.native(path.resolve(resourcesDirectory));
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      if (relative === MANIFEST_NAME) continue;
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new Error(`Integrity manifests do not follow symbolic links or reparse points: ${target}`);
      }
      if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) {
        files.push({
          path: relative,
          size: stat.size,
          sha256: sha256File(target)
        });
      }
    }
  }

  visit(root);
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function serializeIntegrityManifest(files) {
  const lines = [MANIFEST_HEADER];
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !SHA256_PATTERN.test(file.sha256)) {
      throw new Error(`Invalid integrity entry for ${file.path}.`);
    }
    const encodedPath = Buffer.from(file.path, "utf8").toString("hex");
    lines.push(`${file.sha256} ${file.size} ${encodedPath}`);
  }
  return `${lines.join("\n")}\n`;
}

function generateIntegrityManifest(resourcesDirectory) {
  const root = path.resolve(resourcesDirectory);
  const manifest = serializeIntegrityManifest(collectFiles(root));
  const output = path.join(root, MANIFEST_NAME);
  fs.writeFileSync(output, manifest, { encoding: "utf8", flag: "w" });
  return { manifest, output, sha256: crypto.createHash("sha256").update(manifest).digest("hex") };
}

function parseIntegrityManifest(manifest) {
  if (typeof manifest !== "string" || Buffer.byteLength(manifest, "utf8") > 16 * 1024 * 1024) {
    throw new Error("Integrity manifest is missing or too large.");
  }
  const lines = manifest.split("\n");
  if (lines.pop() !== "" || lines.shift() !== MANIFEST_HEADER) {
    throw new Error("Integrity manifest header is invalid.");
  }
  const seen = new Set();
  return lines.map((line) => {
    const match = /^([a-f0-9]{64}) (0|[1-9][0-9]*) ([a-f0-9]+)$/.exec(line);
    if (!match || match[3].length % 2 !== 0) throw new Error("Integrity manifest entry is invalid.");
    const relative = Buffer.from(match[3], "hex").toString("utf8");
    if (Buffer.from(relative, "utf8").toString("hex") !== match[3]) {
      throw new Error("Integrity manifest path encoding is invalid.");
    }
    const normalized = relative.split("/");
    if (!relative || path.isAbsolute(relative) || relative.includes("\\")
        || UNSAFE_PATH_CHARACTER_PATTERN.test(relative)
        || normalized.some((part) => !part || part === "." || part === "..")) {
      throw new Error("Integrity manifest path is unsafe.");
    }
    const key = relative.toLowerCase();
    if (seen.has(key)) throw new Error("Integrity manifest contains duplicate paths.");
    seen.add(key);
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size)) throw new Error("Integrity manifest file size is invalid.");
    return { path: relative, size, sha256: match[1] };
  });
}

function main() {
  const resourcesIndex = process.argv.indexOf("--resources");
  if (resourcesIndex === -1 || !process.argv[resourcesIndex + 1]) {
    throw new Error("Usage: package-integrity --resources <directory>");
  }
  const result = generateIntegrityManifest(process.argv[resourcesIndex + 1]);
  process.stdout.write(`${result.sha256}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  MANIFEST_HEADER,
  MANIFEST_NAME,
  collectFiles,
  generateIntegrityManifest,
  parseIntegrityManifest,
  serializeIntegrityManifest,
  sha256File
};
