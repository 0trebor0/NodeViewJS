#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const MAX_TEXT_BYTES = 1024 * 1024;
const PACKAGE_SURFACE_ALWAYS_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".nodeview-webview",
  "node_modules"
]);

const SECRET_PATTERNS = Object.freeze([
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36,}\b/],
  ["live API key", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
  ["credential assignment", /\b(?:api[_-]?key|client[_-]?secret|password|secret|token)\b\s*[:=]\s*["'][^"'\r\n]{8,}["']/i]
]);

const HIDDEN_TEXT_PATTERNS = Object.freeze([
  ["bidirectional control character", /[\u202A-\u202E\u2066-\u2069]/u],
  ["hidden control character", /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/u]
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

function isWithin(base, candidate) {
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function collectPackageSurfaceFiles(packageRoot = root) {
  const packagePath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(packagePath)) return [];
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const entries = Array.isArray(packageJson.files) ? packageJson.files : [];
  const files = new Set(["package.json"]);

  function visit(candidate) {
    if (!isWithin(packageRoot, candidate) || !fs.existsSync(candidate)) return;
    const relative = path.relative(packageRoot, candidate);
    const segments = relative.split(path.sep).filter(Boolean);
    if (segments.some((segment) => PACKAGE_SURFACE_ALWAYS_IGNORED_DIRECTORIES.has(segment))) return;
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(candidate)) visit(path.join(candidate, child));
    } else if (stat.isFile()) {
      files.add(relative.split(path.sep).join("/"));
    }
  }

  for (const entry of entries) {
    if (typeof entry !== "string" || entry.trim() === "" || path.isAbsolute(entry)) continue;
    visit(path.resolve(packageRoot, entry));
  }
  for (const entry of ["README.md", "LICENSE"]) visit(path.join(packageRoot, entry));
  return [...files].sort();
}

function scanFiles() {
  return [...new Set([...trackedFiles(), ...collectPackageSurfaceFiles()])].sort();
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
  return scanText(file, text);
}

function scanText(file, text) {
  const findings = [];
  for (const [name, pattern] of SECRET_PATTERNS) {
    if (!pattern.test(text)) continue;
    const key = `${file.split(path.sep).join("/")}:${name}`;
    if (!ALLOWED_FIXTURES.has(key)) findings.push({ file, pattern: name });
  }
  for (const [name, pattern] of HIDDEN_TEXT_PATTERNS) {
    if (pattern.test(text)) findings.push({ file, pattern: name });
  }
  return findings;
}

function main() {
  const findings = scanFiles().flatMap(scanFile);
  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(
        `Potential ${finding.pattern} found in scanned file '${finding.file}'.\n`
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

module.exports = { collectPackageSurfaceFiles, scanText };
