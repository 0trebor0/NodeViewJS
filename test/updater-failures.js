"use strict";

// Failure injection at every stage of an update.
//
// The guarantee under test is the one that matters: an update that does not
// succeed must leave the working installation exactly as it was. Nothing is
// removed, replaced, or launched until the bytes have been verified against the
// signed manifest, and a failure at any point stops the sequence before that.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { MANIFEST_SCHEMA_VERSION, Updater, canonicalizeManifest } = require("../runtime/updater");

const keys = crypto.generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
const otherKeys = crypto.generateKeyPairSync("ed25519");

const installer = Buffer.from("a working installer payload");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-updater-failures-"));
const staging = path.join(workspace, "staging");
const restartExecutable = path.join(workspace, "App.exe");
fs.writeFileSync(restartExecutable, "the currently installed launcher");

function signedManifest(overrides = {}, signingKey = keys.privateKey) {
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    appId: "com.example.app",
    version: "2.0.0",
    url: "https://updates.example.com/app-2.0.0.exe",
    sha256: crypto.createHash("sha256").update(installer).digest("hex"),
    size: installer.length,
    ...overrides
  };
  manifest.signature = crypto.sign(
    null,
    Buffer.from(canonicalizeManifest(manifest), "utf8"),
    signingKey
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
        if (name.toLowerCase() !== "content-length") return null;
        return options.contentLength === null ? null : String(options.contentLength ?? bytes.length);
      }
    },
    async arrayBuffer() {
      if (options.throwWhileReading) throw new Error("connection reset while reading the body");
      return bytes;
    }
  };
}

function createUpdater(options = {}) {
  const events = [];
  const spawned = [];
  const updater = new Updater({
    appId: "com.example.app",
    currentVersion: "1.0.0",
    manifestUrl: "https://updates.example.com/update.json",
    publicKey: options.publicKey ?? publicKey,
    stagingDirectory: staging,
    restartExecutable,
    maxDownloadBytes: 1024 * 1024
  }, {
    fetch: options.fetch ?? (async () => { throw new Error("no fetch configured"); }),
    spawn: options.spawn ?? (() => {
      const child = new EventEmitter();
      child.unref = () => {};
      spawned.push(child);
      queueMicrotask(() => child.emit("spawn"));
      return child;
    })
  });
  for (const name of [
    "checking", "update-available", "update-not-available",
    "update-downloaded", "update-installing", "updater-error"
  ]) {
    updater.on(name, (payload) => events.push({ name, payload }));
  }
  return { updater, events, spawned };
}

// A stand-in for the running application. If quit() is ever called, the update
// sequence decided to hand the machine over to the installer.
function fakeApp() {
  const state = { quit: 0 };
  return { state, quit() { state.quit += 1; } };
}

function stagedFiles() {
  if (!fs.existsSync(staging)) return [];
  return fs.readdirSync(staging).sort();
}

async function expectFailure(promise, pattern, label) {
  await assert.rejects(promise, pattern, label);
}

async function main() {
  /* ------------------------------------------------------- manifest stage */

  // A manifest signed by the wrong key is refused, and nothing is staged.
  {
    const { updater, events } = createUpdater({
      fetch: async () => response(JSON.stringify(signedManifest({}, otherKeys.privateKey)))
    });
    await expectFailure(
      updater.checkForUpdates(),
      /signature verification failed/,
      "a manifest signed by another key was accepted"
    );
    assert.equal(events.at(-1).name, "updater-error");
    assert.deepEqual(stagedFiles(), [], "a rejected manifest staged something");
  }

  // A manifest modified after signing is refused.
  {
    const tampered = signedManifest();
    tampered.version = "9.9.9";
    const { updater } = createUpdater({ fetch: async () => response(JSON.stringify(tampered)) });
    await expectFailure(updater.checkForUpdates(), /signature verification failed/);
  }

  // A manifest for a different application is refused even when correctly signed.
  {
    const { updater } = createUpdater({
      fetch: async () => response(JSON.stringify(signedManifest({ appId: "com.example.other" })))
    });
    await expectFailure(updater.checkForUpdates(), /appId does not match/);
  }

  // A downgrade is reported as "not available" rather than installed.
  {
    const { updater, events } = createUpdater({
      fetch: async () => response(JSON.stringify(signedManifest({ version: "0.9.0" })))
    });
    assert.equal(await updater.checkForUpdates(), null);
    assert.equal(events.at(-1).name, "update-not-available");
  }

  /* ------------------------------------------------------- download stage */

  const manifest = signedManifest();

  // Partial download: fewer bytes than the manifest promises.
  {
    const { updater, events } = createUpdater({
      fetch: async () => response(installer.subarray(0, 5), { contentLength: null })
    });
    await expectFailure(updater.downloadUpdate(manifest), /size does not match/);
    assert.equal(events.at(-1).name, "updater-error");
    assert.deepEqual(stagedFiles(), [], "a partial download left a file behind");
  }

  // A declared length that disagrees with the manifest is refused before the
  // body is even read.
  {
    const { updater } = createUpdater({
      fetch: async () => response(installer, { contentLength: installer.length + 10 })
    });
    await expectFailure(updater.downloadUpdate(manifest), /size does not match/);
    assert.deepEqual(stagedFiles(), []);
  }

  // The connection drops midway through the body.
  {
    const { updater } = createUpdater({
      fetch: async () => response(installer, { throwWhileReading: true })
    });
    await expectFailure(updater.downloadUpdate(manifest), /connection reset/);
    assert.deepEqual(stagedFiles(), [], "an interrupted download left a file behind");
  }

  // Corrupted download: the right number of bytes, the wrong bytes.
  {
    const corrupted = Buffer.alloc(installer.length, 0x41);
    const { updater } = createUpdater({ fetch: async () => response(corrupted) });
    await expectFailure(updater.downloadUpdate(manifest), /SHA-256 does not match/);
    assert.deepEqual(stagedFiles(), [], "a corrupted download was staged");
  }

  // An HTTP error is not mistaken for a payload.
  {
    const { updater } = createUpdater({
      fetch: async () => response("not found", { ok: false, status: 404 })
    });
    await expectFailure(updater.downloadUpdate(manifest), /HTTP 404/);
    assert.deepEqual(stagedFiles(), []);
  }

  /* ---------------------------------------------------- a good download */

  const { updater: healthy } = createUpdater({ fetch: async () => response(installer) });
  const downloaded = await healthy.downloadUpdate(manifest);
  assert.ok(fs.existsSync(downloaded.path), "the verified update was not staged");
  assert.deepEqual(fs.readFileSync(downloaded.path), installer);
  const stagedAfterSuccess = stagedFiles();
  assert.equal(stagedAfterSuccess.length, 1, "the staging directory holds more than the update");

  // A later failed download must not destroy the update already staged.
  {
    const { updater } = createUpdater({
      fetch: async () => response(Buffer.alloc(installer.length, 0x42))
    });
    await expectFailure(updater.downloadUpdate(manifest), /SHA-256 does not match/);
    assert.deepEqual(stagedFiles(), stagedAfterSuccess, "a failed download disturbed the staged update");
    assert.deepEqual(fs.readFileSync(downloaded.path), installer, "the staged update was corrupted");
  }

  /* ----------------------------------------------------- install stage */

  // Installing without a verified download is refused.
  {
    const { updater } = createUpdater();
    const app = fakeApp();
    await expectFailure(updater.installAndRestart(app), /must be downloaded/);
    assert.equal(app.state.quit, 0, "the app was shut down without an update to install");
  }

  // The staged installer is re-verified immediately before handing over. Bytes
  // changed after verification must not be installed.
  {
    const { updater } = createUpdater({ fetch: async () => response(installer) });
    const staged = await updater.downloadUpdate(manifest);
    fs.writeFileSync(staged.path, Buffer.alloc(installer.length, 0x43));
    const app = fakeApp();
    await expectFailure(
      updater.installAndRestart(app),
      /changed after signature verification/,
      "an installer modified after verification was accepted"
    );
    assert.equal(app.state.quit, 0, "the app shut down for an installer it refused");
    assert.ok(fs.existsSync(restartExecutable), "the working installation was disturbed");
    fs.writeFileSync(staged.path, installer);
  }

  // The staged installer disappearing between download and install is refused.
  {
    const { updater } = createUpdater({ fetch: async () => response(installer) });
    const staged = await updater.downloadUpdate(manifest);
    fs.rmSync(staged.path);
    const app = fakeApp();
    await expectFailure(updater.installAndRestart(app), /was not found/);
    assert.equal(app.state.quit, 0);
  }

  // Interrupted installation: the helper process cannot be started. The app
  // must keep running rather than quitting into a handover that never happened.
  {
    const { updater, events } = createUpdater({
      fetch: async () => response(installer),
      spawn: () => {
        const child = new EventEmitter();
        child.unref = () => {};
        queueMicrotask(() => child.emit("error", new Error("helper could not be started")));
        return child;
      }
    });
    await updater.downloadUpdate(manifest);
    const app = fakeApp();
    await expectFailure(updater.installAndRestart(app), /helper could not be started/);
    assert.equal(app.state.quit, 0, "the app quit even though the installer never started");
    assert.equal(
      events.some(({ name }) => name === "update-installing"),
      false,
      "installation was announced even though the helper never started"
    );
    assert.ok(fs.existsSync(restartExecutable), "the working installation was disturbed");
  }

  // Only when everything verifies does the app hand over.
  {
    const { updater, events } = createUpdater({ fetch: async () => response(installer) });
    await updater.downloadUpdate(manifest);
    const app = fakeApp();
    await updater.installAndRestart(app);
    assert.equal(app.state.quit, 1, "a verified update did not hand over");
    assert.equal(events.at(-1).name, "update-installing");
  }

  await fsPromises.rm(workspace, { recursive: true, force: true });
  console.log("Updater failure test passed.");
}

main().catch(async (error) => {
  await fsPromises.rm(workspace, { recursive: true, force: true }).catch(() => {});
  console.error(error);
  process.exit(1);
});
