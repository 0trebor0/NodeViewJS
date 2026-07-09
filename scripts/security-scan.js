#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const MAX_TEXT_BYTES = 1024 * 1024;

const SECRET_PATTERNS = Object.freeze([
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36,}\b/],
  ["live API key", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
  ["credential assignment", /\b(?:api[_-]?key|client[_-]?secret|password|secret|token)\b\s*[:=]\s*["'][^"'\r\n]{8,}["']/i]
]);

const ALLOWED_FIXTURES = new Set([
  "test/package-input-security.js:private key",
  "test/package-input-security.js:credential assignment"
]);

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "buffer"
  });
  if (result.status !== 0) {
    const stderr = result.stderr.toString("utf8").trim();
    throw new Error(stderr || "Could not list tracked files.");
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function isTextFile(file) {
  const stat = fs.statSync(path.join(root, file));
  if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return false;
  const content = fs.readFileSync(path.join(root, file));
  return !content.includes(0);
}

function scanFile(file) {
  if (!isTextFile(file)) return [];
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const findings = [];
  for (const [name, pattern] of SECRET_PATTERNS) {
    if (!pattern.test(text)) continue;
    const key = `${file.split(path.sep).join("/")}:${name}`;
    if (!ALLOWED_FIXTURES.has(key)) findings.push({ file, pattern: name });
  }
  return findings;
}

function main() {
  const findings = trackedFiles().flatMap(scanFile);
  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(
        `Potential ${finding.pattern} found in tracked file '${finding.file}'.\n`
      );
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Repository security scan passed.\n");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
