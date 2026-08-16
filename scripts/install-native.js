#!/usr/bin/env node
"use strict";

// Installs the native addon and launcher, preferring a published prebuilt
// binary over a local compile so that `npm install nodeviewjs` does not require
// a C++ toolchain.
//
// The trust model is the point of this file:
//
//   * Expected digests live in native-checksums.json, which ships inside the
//     package. Digests are never taken from the download host, so a compromised
//     or substituted host cannot authorise its own binary.
//   * An artifact that is missing, unreachable, or not listed for this target
//     falls back to building from source. That is a normal outcome, not an
//     error: it is what happens on every platform before binaries are published.
//   * An artifact whose digest does not match does NOT fall back. A wrong digest
//     means the bytes are not the ones this package expects, and quietly
//     compiling instead would hide that. It fails the install.
//
// Contributors are unaffected: `npm run build` still compiles from source, and
// NODEVIEW_BUILD_FROM_SOURCE=1 forces that path here too.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const CHECKSUM_FILE = path.join(root, "native-checksums.json");
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

// The files stage-native-build.js produces, per platform.
function targetFiles(platform) {
  if (platform === "win32") return ["nodeview.node", "nodeview_launcher.exe"];
  if (platform === "darwin" || platform === "linux") return ["nodeview.node", "nodeview_launcher"];
  return undefined;
}

// node-addon-api binaries are ABI-stable across Node major versions, so one
// artifact per platform and architecture is enough.
function resolveTarget(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const files = targetFiles(platform);
  if (!files) return undefined;
  return { key: `${platform}-${arch}`, platform, arch, files };
}

function resolveBinaryHost(options = {}) {
  const env = options.env ?? process.env;
  const manifest = options.manifest ?? {};
  const configured = env.NODEVIEW_BINARY_HOST
    ?? env.npm_config_nodeview_binary_host
    ?? manifest.nodeviewjs?.binaryHost;
  if (typeof configured !== "string" || configured.trim().length === 0) return undefined;

  let url;
  try {
    url = new URL(configured.endsWith("/") ? configured : `${configured}/`);
  } catch {
    throw new Error(`Prebuilt binary host is not a valid URL: ${configured}`);
  }
  // Artifacts authenticate the code that will run on the machine, so the
  // transport has to be authenticated too.
  if (url.protocol !== "https:") {
    throw new Error("Prebuilt binary host must use https.");
  }
  if (url.username || url.password) {
    throw new Error("Prebuilt binary host must not contain credentials.");
  }
  return url;
}

function readChecksums(checksumPath = CHECKSUM_FILE) {
  if (!fs.existsSync(checksumPath)) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(checksumPath, "utf8"));
  } catch (error) {
    throw new Error(`native-checksums.json is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("native-checksums.json must contain an object.");
  }
  const artifacts = parsed.artifacts;
  if (artifacts !== undefined
      && (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts))) {
    throw new Error("native-checksums.json artifacts must be an object.");
  }
  return { version: parsed.version, artifacts: artifacts ?? {} };
}

function expectedDigest(checksums, target, file) {
  const digest = checksums.artifacts[`${target.key}/${file}`];
  if (digest === undefined) return undefined;
  if (typeof digest !== "string" || !SHA256_PATTERN.test(digest)) {
    throw new Error(`native-checksums.json has an invalid digest for ${target.key}/${file}.`);
  }
  return digest;
}

function digestOf(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function downloadArtifact(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  timer.unref?.();
  try {
    // Redirects are refused rather than followed: an artifact URL is built from
    // configuration, so a redirect means the host is sending the install
    // somewhere the configuration did not name.
    const response = await fetchImpl(url.href, { redirect: "error", signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isSafeInteger(declared) && declared > MAX_ARTIFACT_BYTES) {
      throw new Error("artifact exceeds the maximum allowed size");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ARTIFACT_BYTES) {
      throw new Error("artifact exceeds the maximum allowed size");
    }
    if (buffer.length === 0) {
      throw new Error("artifact is empty");
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

class ChecksumMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChecksumMismatchError";
  }
}

// Resolves to { installed, reason }. Throws only when the install must stop:
// a digest mismatch or a misconfigured host.
async function installPrebuilt(options = {}) {
  const log = options.log ?? console.log;
  const env = options.env ?? process.env;
  const outputDirectory = options.outputDirectory ?? path.join(root, "build", "nodeview");
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (env.NODEVIEW_BUILD_FROM_SOURCE === "1") {
    return { installed: false, reason: "NODEVIEW_BUILD_FROM_SOURCE=1 was set" };
  }

  const platform = env.NODEVIEW_PLATFORM ?? process.platform;
  const target = options.target ?? resolveTarget({ platform });
  if (!target) {
    return { installed: false, reason: `no prebuilt target for ${platform}` };
  }

  const checksums = options.checksums ?? readChecksums(options.checksumPath);
  if (!checksums) {
    return { installed: false, reason: "native-checksums.json is not present" };
  }

  const manifest = options.manifest
    ?? JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const host = resolveBinaryHost({ env, manifest });
  if (!host) {
    return { installed: false, reason: "no prebuilt binary host is configured" };
  }
  if (typeof fetchImpl !== "function") {
    return { installed: false, reason: "this Node.js runtime does not provide fetch()" };
  }

  const digests = new Map();
  for (const file of target.files) {
    const digest = expectedDigest(checksums, target, file);
    if (digest === undefined) {
      return {
        installed: false,
        reason: `no published binary for ${target.key} in this release`
      };
    }
    digests.set(file, digest);
  }

  // Everything is downloaded and verified before anything is written, so a
  // failure part way through cannot leave a half-installed mixture.
  const verified = new Map();
  for (const file of target.files) {
    const url = new URL(`${checksums.version ?? manifest.version}/${target.key}/${file}`, host);
    let buffer;
    try {
      log(`[NodeViewJS] Downloading prebuilt ${target.key}/${file}`);
      buffer = await downloadArtifact(url, fetchImpl);
    } catch (error) {
      return {
        installed: false,
        reason: `could not download ${target.key}/${file}: ${error.message}`
      };
    }

    const actual = digestOf(buffer);
    if (actual !== digests.get(file)) {
      throw new ChecksumMismatchError(
        `Prebuilt ${target.key}/${file} does not match the digest published with this package.\n`
        + `  expected ${digests.get(file)}\n`
        + `  actual   ${actual}\n`
        + "Refusing to install it. Build from source instead:\n"
        + "  NODEVIEW_BUILD_FROM_SOURCE=1 npm install"
      );
    }
    verified.set(file, buffer);
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [file, buffer] of verified) {
    const destination = path.join(outputDirectory, file);
    fs.writeFileSync(destination, buffer);
    if (file !== "nodeview.node" && process.platform !== "win32") {
      fs.chmodSync(destination, 0o755);
    }
  }
  fs.writeFileSync(
    path.join(outputDirectory, "provenance.json"),
    `${JSON.stringify({
      source: "prebuilt",
      target: target.key,
      version: checksums.version ?? manifest.version,
      host: host.origin,
      installedAt: new Date().toISOString()
    }, null, 2)}\n`
  );

  return { installed: true, reason: `installed the prebuilt binary for ${target.key}` };
}

function buildFromSource(reason, log = console.log) {
  log(`[NodeViewJS] Building the native host from source (${reason}).`);
  const result = spawnSync(process.execPath, [path.join(__dirname, "build.js")], {
    cwd: root,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  return result.status ?? 0;
}

async function main() {
  let outcome;
  try {
    outcome = await installPrebuilt();
  } catch (error) {
    if (error instanceof ChecksumMismatchError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  if (outcome.installed) {
    console.log(`[NodeViewJS] ${outcome.reason}.`);
    return 0;
  }
  return buildFromSource(outcome.reason);
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`[NodeViewJS] Native installation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ChecksumMismatchError,
  MAX_ARTIFACT_BYTES,
  digestOf,
  installPrebuilt,
  readChecksums,
  resolveBinaryHost,
  resolveTarget,
  targetFiles
};
