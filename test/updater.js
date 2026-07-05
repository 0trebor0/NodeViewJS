"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  MANIFEST_SCHEMA_VERSION,
  Updater,
  canonicalizeManifest,
  compareVersions,
  validateManifest
} = require("../runtime/updater");

function signedManifest(privateKey, installer, overrides = {}) {
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    appId: "com.example.app",
    version: "1.2.0",
    url: "https://updates.example.com/app-1.2.0.exe",
    sha256: crypto.createHash("sha256").update(installer).digest("hex"),
    size: installer.length,
    ...overrides
  };
  manifest.signature = crypto.sign(
    null,
    Buffer.from(canonicalizeManifest(manifest), "utf8"),
    privateKey
  ).toString("base64");
  return manifest;
}

function response(body, options = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-length"
          ? String(options.contentLength ?? bytes.length)
          : null;
      }
    },
    async arrayBuffer() { return bytes; }
  };
}

function queuedFetch(responses) {
  return async () => {
    assert.ok(responses.length > 0, "Unexpected update fetch request.");
    return responses.shift();
  };
}

async function main() {
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.2.0-beta.2", "1.2.0-beta.11"), -1);
  assert.equal(compareVersions("1.2.0", "1.2.0-rc.1"), 1);
  assert.equal(compareVersions("1.2.0+build.2", "1.2.0+build.1"), 0);
  assert.throws(() => compareVersions("1.2", "1.2.0"), /Invalid update version/);

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const installer = Buffer.from("MZ NodeViewJS signed installer fixture");
  const manifest = signedManifest(privateKey, installer);
  const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "nodeviewjs-updater-"));
  const fetchResponses = [
    response(JSON.stringify(manifest)),
    response(installer)
  ];
  let spawned;
  let quitCalled = false;
  const updater = new Updater({
    appId: "com.example.app",
    currentVersion: "1.1.0",
    manifestUrl: "https://updates.example.com/update.json",
    publicKey: publicKeyPem,
    stagingDirectory: directory,
    restartExecutable: path.join(directory, "Example.exe")
  }, {
    fetch: queuedFetch(fetchResponses),
    spawn(command, args, options) {
      spawned = { command, args, options };
      const child = new EventEmitter();
      child.unref = () => {};
      process.nextTick(() => child.emit("spawn"));
      return child;
    }
  });

  const available = await updater.checkForUpdates();
  assert.equal(available.version, "1.2.0");
  const downloaded = await updater.downloadUpdate(available);
  assert.equal(await fsPromises.readFile(downloaded.path, "utf8"), installer.toString("utf8"));

  await fsPromises.writeFile(path.join(directory, "Example.exe"), "fixture");
  await updater.installAndRestart({ quit() { quitCalled = true; } });
  assert.equal(quitCalled, true);
  assert.match(spawned.command, /powershell\.exe$/i);
  assert.ok(spawned.args.includes(downloaded.path));
  assert.equal(spawned.options.detached, true);

  await fsPromises.writeFile(downloaded.path, "tampered");
  await assert.rejects(
    () => updater.installAndRestart({ quit() {} }),
    /changed after signature verification/
  );

  const stale = signedManifest(privateKey, installer, { version: "1.0.0" });
  const staleUpdater = new Updater({
    appId: "com.example.app",
    currentVersion: "1.1.0",
    manifestUrl: "https://updates.example.com/update.json",
    publicKey: publicKeyPem,
    stagingDirectory: directory
  }, { fetch: queuedFetch([response(JSON.stringify(stale))]) });
  assert.equal(await staleUpdater.checkForUpdates(), null);

  const tampered = { ...manifest, size: manifest.size + 1 };
  const tamperedUpdater = new Updater({
    appId: "com.example.app",
    currentVersion: "1.1.0",
    manifestUrl: "https://updates.example.com/update.json",
    publicKey: publicKeyPem,
    stagingDirectory: directory
  }, { fetch: queuedFetch([response(JSON.stringify(tampered))]) });
  await assert.rejects(() => tamperedUpdater.checkForUpdates(), /signature verification failed/);

  const wrongDownload = Buffer.alloc(installer.length, 0x78);
  const mismatchUpdater = new Updater({
    appId: "com.example.app",
    currentVersion: "1.1.0",
    manifestUrl: "https://updates.example.com/update.json",
    publicKey: publicKeyPem,
    stagingDirectory: path.join(directory, "mismatch")
  }, { fetch: queuedFetch([response(wrongDownload, { contentLength: installer.length })]) });
  await assert.rejects(() => mismatchUpdater.downloadUpdate(manifest), /SHA-256/);

  assert.throws(() => new Updater({
    appId: "com.example.app",
    currentVersion: "1.0.0",
    manifestUrl: "http://updates.example.com/update.json",
    publicKey: publicKeyPem
  }), /HTTPS URL/);

  const generatorRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "nodeviewjs-manifest-"));
  const generatorInstaller = path.join(generatorRoot, "setup.exe");
  const privateKeyPath = path.join(generatorRoot, "private.pem");
  await fsPromises.writeFile(generatorInstaller, installer);
  await fsPromises.writeFile(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  await fsPromises.writeFile(path.join(generatorRoot, "package.json"), JSON.stringify({
    name: "example-app",
    version: "1.2.0",
    nodeviewjs: { name: "Example", appId: "com.example.app", entry: "app.js" }
  }));
  const output = path.join(generatorRoot, "update.json");
  const generated = spawnSync(process.execPath, [
    path.join(__dirname, "..", "scripts", "generate-update-manifest.js"),
    "--project-root", generatorRoot,
    "--installer", generatorInstaller,
    "--output", output,
    "--url", "https://updates.example.com/setup.exe"
  ], {
    encoding: "utf8",
    env: { ...process.env, NODEVIEW_UPDATE_PRIVATE_KEY: privateKeyPath }
  });
  assert.equal(generated.status, 0, generated.stderr);
  const generatedManifest = JSON.parse(await fsPromises.readFile(output, "utf8"));
  assert.equal(validateManifest(generatedManifest, {
    appId: "com.example.app",
    maxDownloadBytes: 1024,
    publicKey
  }).version, "1.2.0");

  console.log("Updater test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
