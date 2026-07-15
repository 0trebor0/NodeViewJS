#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_EXCLUSIONS = Object.freeze([
  "node_modules", "node_modules/*",
  ".git", ".git/*",
  ".nodeview-webview", ".nodeview-webview/*",
  "build", "build/*",
  ".env", ".env.*",
  ".npmrc", ".pypirc",
  "*.pem", "*.key", "*.pfx", "*.p12",
  "*.jks", "*.keystore",
  "id_rsa", "id_ed25519",
  "credentials.json", "service-account*.json",
  "*.map"
]);

const SECRET_PATTERNS = Object.freeze([
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ["live API key", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
  ["credential assignment", /\b(?:api[_-]?key|client[_-]?secret|password|secret|token)\b\s*[:=]\s*["'][^"'\r\n]{8,}["']/i]
]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

function normalizeRelative(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty relative path.`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new Error(`${label} must not contain control characters.`);
  }
  if (path.isAbsolute(value)) throw new Error(`${label} must stay inside the project directory.`);
  const segments = value.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) throw new Error(`${label} must not contain path traversal.`);
  return value;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function globExpression(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
}

function isExcluded(relativePath, patterns) {
  const normalized = relativePath.split(path.sep).join("/");
  return patterns.some((pattern) => globExpression(pattern).test(normalized));
}

function validateExclusions(configured) {
  const values = Array.isArray(configured) ? configured : configured ? [configured] : [];
  return values.map((value, index) => {
    const normalized = normalizeRelative(value, `nodeviewjs.exclude[${index}]`).replace(/\\/g, "/");
    if (normalized === ".") throw new Error("nodeviewjs.exclude must not exclude the package root.");
    return normalized;
  });
}

function assertNoLinks(root, candidate, label) {
  if (!isWithin(root, candidate)) throw new Error(`${label} is outside the project directory.`);
  const relative = path.relative(root, candidate);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic link or reparse point: ${current}`);
    }
  }
  const real = fs.realpathSync.native(candidate);
  if (!isWithin(root, real)) throw new Error(`${label} resolves outside the project directory.`);
  return real;
}

function readConfiguration(projectRoot) {
  const root = fs.realpathSync.native(path.resolve(projectRoot));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const config = packageJson.nodeviewjs ?? {};
  const appName = config.name ?? "NodeViewDemo";
  if (typeof appName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(appName)
      || /[. ]$/.test(appName)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(appName)) {
    throw new Error("nodeviewjs.name contains characters that are unsafe for a package directory.");
  }
  const entrySetting = normalizeRelative(config.entry ?? "app.js", "nodeviewjs.entry");
  const entry = assertNoLinks(root, path.resolve(root, entrySetting), "nodeviewjs.entry");
  if (!fs.lstatSync(entry).isFile()) throw new Error("nodeviewjs.entry must point to a file.");

  const includes = (Array.isArray(config.include) ? config.include : config.include ? [config.include] : [])
    .map((value, index) => {
      const setting = normalizeRelative(value, `nodeviewjs.include[${index}]`);
      return assertNoLinks(root, path.resolve(root, setting), `nodeviewjs.include[${index}]`);
    });
  const icon = config.icon
    ? assertNoLinks(root, path.resolve(root, normalizeRelative(config.icon, "nodeviewjs.icon")), "nodeviewjs.icon")
    : undefined;

  return {
    root,
    config,
    appName,
    entry,
    entryDirectory: path.dirname(entry),
    includes,
    icon,
    exclusions: [...DEFAULT_EXCLUSIONS, ...validateExclusions(config.exclude)]
  };
}

function collectPackageFiles(projectRoot, options = {}) {
  const configuration = readConfiguration(projectRoot);
  const files = new Map();
  const warnings = [];

  function addFile(source, base, relative) {
    const destinationRelative = relative ?? path.relative(base, source);
    if (destinationRelative === "" || destinationRelative.startsWith(`..${path.sep}`)
        || destinationRelative === ".." || path.isAbsolute(destinationRelative)) {
      throw new Error(`Package input escaped its configured base directory: ${source}`);
    }
    if (isExcluded(destinationRelative, configuration.exclusions)) return;

    const normalizedDestination = destinationRelative.split(path.sep).join("/");
    const existing = files.get(normalizedDestination.toLowerCase());
    if (existing && existing.source !== source) {
      throw new Error(`Package inputs collide at destination '${normalizedDestination}'.`);
    }
    if (existing) return;
    files.set(normalizedDestination.toLowerCase(), { source, relative: normalizedDestination });

    if (options.scanSecrets !== false && configuration.config.secretWarnings !== false) {
      const stat = fs.statSync(source);
      if (stat.size <= 1024 * 1024) {
        const content = fs.readFileSync(source);
        if (!content.includes(0)) {
          const text = content.toString("utf8");
          for (const [name, pattern] of SECRET_PATTERNS) {
            if (pattern.test(text)) warnings.push({ file: normalizedDestination, pattern: name });
          }
        }
      }
    }
  }

  function visit(source, base) {
    const relative = path.relative(base, source);
    if (relative && isExcluded(relative, configuration.exclusions)) return;
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) {
      throw new Error(`Packaging does not follow symbolic links or reparse points: ${source}`);
    }
    const real = fs.realpathSync.native(source);
    if (!isWithin(configuration.root, real)) {
      throw new Error(`Package input resolves outside the project directory: ${source}`);
    }
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(source)) visit(path.join(source, child), base);
    } else if (stat.isFile()) {
      addFile(real, base);
    }
  }

  visit(configuration.entryDirectory, configuration.entryDirectory);
  for (const include of configuration.includes) visit(include, configuration.root);
  if (configuration.icon) addFile(configuration.icon, configuration.root);

  return {
    ...configuration,
    files: [...files.values()].sort((left, right) => left.relative.localeCompare(right.relative)),
    warnings
  };
}

function copyPackageInputs(projectRoot, destinationRoot) {
  const collected = collectPackageFiles(projectRoot);
  const requestedRoot = path.resolve(projectRoot);
  const requestedDestination = path.resolve(destinationRoot);
  if (!isWithin(requestedRoot, requestedDestination)) {
    throw new Error("Package destination must stay inside the project directory.");
  }
  const destination = path.resolve(
    collected.root,
    path.relative(requestedRoot, requestedDestination)
  );
  if (!isWithin(collected.root, destination)) {
    throw new Error("Package destination must stay inside the project directory.");
  }
  ensureSafeDirectory(collected.root, destination);
  const realDestination = fs.realpathSync.native(destination);

  for (const file of collected.files) {
    const target = path.resolve(realDestination, file.relative);
    if (!isWithin(realDestination, target)) {
      throw new Error(`Package destination escaped resources/app: ${file.relative}`);
    }
    const parent = path.dirname(target);
    ensureSafeDirectory(realDestination, parent);
    fs.copyFileSync(file.source, target, fs.constants.COPYFILE_EXCL);
  }
  return collected;
}

function ensureSafeDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!isWithin(root, candidate)) throw new Error("Package destination escaped resources/app.");
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Package destination contains a symbolic link or reparse point: ${current}`);
      }
      if (!stat.isDirectory()) throw new Error(`Package destination is not a directory: ${current}`);
    } else {
      fs.mkdirSync(current);
    }
  }
}

function main() {
  const projectRootIndex = process.argv.indexOf("--project-root");
  const destinationIndex = process.argv.indexOf("--destination");
  if (projectRootIndex === -1) throw new Error("--project-root is required.");
  const projectRoot = process.argv[projectRootIndex + 1];
  const result = destinationIndex === -1
    ? collectPackageFiles(projectRoot, { scanSecrets: false })
    : copyPackageInputs(projectRoot, process.argv[destinationIndex + 1]);
  for (const warning of result.warnings) {
    process.stderr.write(`Warning: possible ${warning.pattern} in package file '${warning.file}'.\n`);
  }
  process.stdout.write(`Validated ${result.files.length} package input files.\n`);
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
  DEFAULT_EXCLUSIONS,
  collectPackageFiles,
  copyPackageInputs,
  isWithin
};
