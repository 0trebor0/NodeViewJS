#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { MANIFEST_SCHEMA_VERSION, canonicalizeManifest } = require("../runtime/updater");

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const projectRoot = path.resolve(option("--project-root") ?? process.cwd());
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const config = packageJson.nodeviewjs ?? {};
const metadata = config.metadata ?? {};
const appName = config.name ?? "NodeViewDemo";
const appId = config.appId ?? packageJson.name;
const version = metadata.version ?? packageJson.version;
const installer = path.resolve(
  option("--installer") ?? path.join(projectRoot, "build", "installer", `${appName}-${version}-setup.exe`)
);
const output = path.resolve(
  option("--output") ?? path.join(projectRoot, "build", "installer", "update.json")
);
const privateKeyPath = process.env.NODEVIEW_UPDATE_PRIVATE_KEY;
const requestedUrl = option("--url");

if (!requestedUrl) {
  throw new Error("Update manifest generation requires --url <https-installer-url>.");
}
const installerUrl = new URL(requestedUrl);
if (installerUrl.protocol !== "https:" || installerUrl.username || installerUrl.password) {
  throw new Error("Update installer URL must use HTTPS without embedded credentials.");
}
if (!privateKeyPath) {
  throw new Error("Set NODEVIEW_UPDATE_PRIVATE_KEY to an Ed25519 private key file.");
}
if (!fs.existsSync(installer)) {
  throw new Error(`Installer was not found: ${installer}`);
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(path.resolve(privateKeyPath)));
if (privateKey.asymmetricKeyType !== "ed25519") {
  throw new Error("NODEVIEW_UPDATE_PRIVATE_KEY must contain an Ed25519 private key.");
}

const bytes = fs.readFileSync(installer);
const manifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  appId,
  version,
  url: installerUrl.href,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  size: bytes.length
};
manifest.signature = crypto.sign(
  null,
  Buffer.from(canonicalizeManifest(manifest), "utf8"),
  privateKey
).toString("base64");

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });
console.log(`Created signed update manifest: ${output}`);
