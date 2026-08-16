"use strict";

const crypto = require("node:crypto");
const { EventEmitter, once } = require("node:events");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { resolveAppId, resolveUpdateDirectory } = require("./data-directory");
const { safeDiagnosticString } = require("./validation");

const MANIFEST_SCHEMA_VERSION = 1;
const MANIFEST_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const MANIFEST_KEYS = new Set([
  "schemaVersion",
  "appId",
  "version",
  "url",
  "sha256",
  "size",
  "signature"
]);

function parseVersion(value) {
  if (typeof value !== "string") {
    throw new TypeError("Update version must be a semantic version string.");
  }
  const match = VERSION_PATTERN.exec(value);
  if (!match) {
    throw new TypeError(`Invalid update version: ${safeDiagnosticString(value)}`);
  }
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    throw new TypeError(`Invalid update version: ${safeDiagnosticString(value)}`);
  }
  return {
    value,
    core: match.slice(1, 4).map(BigInt),
    prerelease
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;

    const leftNumeric = /^\d+$/.test(left[index]);
    const rightNumeric = /^\d+$/.test(right[index]);
    if (leftNumeric && rightNumeric) return BigInt(left[index]) < BigInt(right[index]) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function compareVersions(left, right) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  for (let index = 0; index < 3; index++) {
    if (parsedLeft.core[index] !== parsedRight.core[index]) {
      return parsedLeft.core[index] < parsedRight.core[index] ? -1 : 1;
    }
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

function requireHttpsUrl(value, label) {
  if (typeof value !== "string" || value.trim() !== value || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a valid HTTPS URL.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError(`${label} must be a valid HTTPS URL.`);
  }
  return url.href;
}

function canonicalizeManifest(manifest) {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    appId: manifest.appId,
    version: manifest.version,
    url: manifest.url,
    sha256: manifest.sha256,
    size: manifest.size
  });
}

function resolvePublicKey(value) {
  let key;
  try {
    key = crypto.createPublicKey(value);
  } catch {
    throw new TypeError("Update publicKey must be a valid Ed25519 public key.");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError("Update publicKey must be an Ed25519 public key.");
  }
  return key;
}

function validateManifest(manifest, options) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Update manifest must be a JSON object.");
  }
  const unknownKey = Object.keys(manifest).find((key) => !MANIFEST_KEYS.has(key));
  const missingKey = [...MANIFEST_KEYS].find((key) => !Object.hasOwn(manifest, key));
  if (unknownKey || missingKey) {
    throw new Error(unknownKey
      ? `Unsupported update manifest field: ${safeDiagnosticString(unknownKey)}`
      : `Update manifest is missing field: ${missingKey}`);
  }
  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported update manifest schema: ${safeDiagnosticString(manifest.schemaVersion)}`);
  }
  if (resolveAppId(manifest.appId) !== manifest.appId || manifest.appId !== options.appId) {
    throw new Error("Update manifest appId does not match this application.");
  }
  parseVersion(manifest.version);
  const url = requireHttpsUrl(manifest.url, "Update download URL");
  if (url !== manifest.url) {
    throw new Error("Update download URL must use its canonical form.");
  }
  if (typeof manifest.sha256 !== "string" || !SHA256_PATTERN.test(manifest.sha256)) {
    throw new Error("Update manifest sha256 must be a lowercase SHA-256 digest.");
  }
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0 || manifest.size > options.maxDownloadBytes) {
    throw new Error("Update manifest size is outside the allowed download range.");
  }
  if (typeof manifest.signature !== "string") {
    throw new Error("Update manifest signature must be base64 encoded.");
  }

  const signature = Buffer.from(manifest.signature, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== manifest.signature) {
    throw new Error("Update manifest signature must be canonical base64 Ed25519 data.");
  }
  if (!crypto.verify(
    null,
    Buffer.from(canonicalizeManifest(manifest), "utf8"),
    options.publicKey,
    signature
  )) {
    throw new Error([
      "Update manifest signature verification failed.",
      "The manifest is well formed, but it was not signed by the key this app trusts.",
      "Either the manifest was signed with a different private key than the publicKey",
      "configured on the Updater, or it was modified after signing.",
      "Regenerate it with `nodeviewjs update-manifest` using the matching private key."
    ].join("\n"));
  }

  return Object.freeze({ ...manifest });
}

function contentLength(response) {
  const value = response.headers?.get?.("content-length");
  if (value === null || value === undefined || value === "") return undefined;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined;
}

async function readResponseBuffer(response, maximumBytes, label) {
  if (response.body?.[Symbol.asyncIterator]) {
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > maximumBytes) {
        throw new Error(`${label} exceeds the maximum allowed size.`);
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maximumBytes) {
    throw new Error(`${label} exceeds the maximum allowed size.`);
  }
  return bytes;
}

class Updater extends EventEmitter {
  #downloaded;
  #fetch;
  #publicKey;
  #spawn;

  constructor(options = {}, dependencies = {}) {
    super();
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Updater options must be an object.");
    }

    this.appId = resolveAppId(options.appId);
    this.currentVersion = parseVersion(options.currentVersion).value;
    this.manifestUrl = requireHttpsUrl(options.manifestUrl, "Update manifest URL");
    this.maxDownloadBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
    if (!Number.isSafeInteger(this.maxDownloadBytes) || this.maxDownloadBytes <= 0) {
      throw new TypeError("Updater maxDownloadBytes must be a positive safe integer.");
    }
    this.stagingDirectory = options.stagingDirectory === undefined
      ? resolveUpdateDirectory(this.appId)
      : path.resolve(options.stagingDirectory);
    this.restartExecutable = options.restartExecutable === undefined
      ? process.env.NODEVIEW_LAUNCHER_PATH
      : path.resolve(options.restartExecutable);

    this.#publicKey = resolvePublicKey(options.publicKey);
    this.#fetch = dependencies.fetch ?? globalThis.fetch;
    this.#spawn = dependencies.spawn ?? spawn;
    if (typeof this.#fetch !== "function") {
      throw new Error("This Node.js version does not provide fetch().");
    }
  }

  async checkForUpdates() {
    this.emit("checking");
    try {
      const response = await this.#fetch(this.manifestUrl, {
        headers: { accept: "application/json" },
        redirect: "error"
      });
      if (!response.ok) {
        throw new Error(`Update manifest request failed with HTTP ${response.status}.`);
      }
      const length = contentLength(response);
      if (length !== undefined && length > MANIFEST_MAX_BYTES) {
        throw new Error("Update manifest exceeds the maximum allowed size.");
      }
      const text = (await readResponseBuffer(response, MANIFEST_MAX_BYTES, "Update manifest"))
        .toString("utf8");

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Update manifest is not valid JSON.");
      }
      const update = validateManifest(parsed, {
        appId: this.appId,
        maxDownloadBytes: this.maxDownloadBytes,
        publicKey: this.#publicKey
      });
      if (compareVersions(update.version, this.currentVersion) <= 0) {
        this.emit("update-not-available", update);
        return null;
      }
      this.emit("update-available", update);
      return update;
    } catch (error) {
      this.emit("updater-error", error);
      throw error;
    }
  }

  async downloadUpdate(update) {
    this.#downloaded = undefined;
    const verified = validateManifest(update, {
      appId: this.appId,
      maxDownloadBytes: this.maxDownloadBytes,
      publicKey: this.#publicKey
    });
    const target = path.join(this.stagingDirectory, `update-${verified.version}.exe`);
    const temporary = `${target}.${process.pid}.tmp`;

    try {
      const response = await this.#fetch(verified.url, {
        headers: { accept: "application/octet-stream" },
        redirect: "error"
      });
      if (!response.ok) {
        throw new Error(`Update download failed with HTTP ${response.status}.`);
      }
      const length = contentLength(response);
      if (length !== undefined && length !== verified.size) {
        throw new Error("Update download size does not match the signed manifest.");
      }
      const bytes = await readResponseBuffer(response, verified.size, "Update download");
      if (bytes.length !== verified.size) {
        throw new Error("Update download size does not match the signed manifest.");
      }
      const digest = crypto.createHash("sha256").update(bytes).digest("hex");
      if (digest !== verified.sha256) {
        throw new Error("Update download SHA-256 does not match the signed manifest.");
      }

      await fsPromises.mkdir(this.stagingDirectory, { recursive: true });
      await fsPromises.rm(temporary, { force: true });
      await fsPromises.writeFile(temporary, bytes, { flag: "wx" });
      await fsPromises.rm(target, { force: true });
      await fsPromises.rename(temporary, target);
      this.#downloaded = { path: target, update: verified };
      this.emit("update-downloaded", this.#downloaded);
      return this.#downloaded;
    } catch (error) {
      await fsPromises.rm(temporary, { force: true }).catch(() => {});
      this.emit("updater-error", error);
      throw error;
    }
  }

  async installAndRestart(app) {
    const downloaded = this.#downloaded;
    if (!downloaded || typeof downloaded.path !== "string") {
      throw new Error("An update must be downloaded before it can be installed.");
    }
    if (!app || typeof app.quit !== "function") {
      throw new TypeError("installAndRestart requires a NodeViewJS App instance.");
    }
    if (!this.restartExecutable) {
      throw new Error("The current process was not started by a packaged NodeViewJS launcher.");
    }

    const installer = path.resolve(downloaded.path);
    const restartExecutable = path.resolve(this.restartExecutable);
    if (!fs.existsSync(installer)) {
      throw new Error(`Downloaded update was not found: ${installer}`);
    }
    if (!fs.existsSync(restartExecutable)) {
      throw new Error(`Restart executable was not found: ${restartExecutable}`);
    }
    const installerBytes = await fsPromises.readFile(installer);
    if (installerBytes.length !== downloaded.update.size ||
        crypto.createHash("sha256").update(installerBytes).digest("hex") !== downloaded.update.sha256) {
      throw new Error("Downloaded update changed after signature verification.");
    }

    const helper = path.join(__dirname, "apply-update.ps1");
    const windowsDirectory = process.env.WINDIR || "C:\\Windows";
    const powershell = path.join(windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const args = [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", helper,
      "-ParentProcessId", String(process.pid),
      "-InstallerPath", installer,
      "-RestartExecutable", restartExecutable,
      "-ExpectedSha256", downloaded.update.sha256,
      "-ExpectedSize", String(downloaded.update.size)
    ];
    const launcherProcessId = Number(process.env.NODEVIEW_LAUNCHER_PID);
    if (Number.isSafeInteger(launcherProcessId) && launcherProcessId > 0) {
      args.push("-LauncherProcessId", String(launcherProcessId));
    }

    const child = this.#spawn(powershell, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    await Promise.race([
      once(child, "spawn"),
      once(child, "error").then(([error]) => Promise.reject(error))
    ]);
    child.unref();
    this.emit("update-installing", downloaded);
    app.quit();
  }
}

module.exports = {
  MANIFEST_SCHEMA_VERSION,
  Updater,
  canonicalizeManifest,
  compareVersions,
  validateManifest
};
