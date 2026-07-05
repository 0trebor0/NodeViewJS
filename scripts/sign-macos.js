#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function defaultRun(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? "unknown"}.`);
  }
}

function signMacApp(appBundle, options = {}) {
  const bundle = path.resolve(appBundle);
  const identity = options.identity ?? process.env.NODEVIEW_MAC_SIGN_IDENTITY;
  const run = options.run ?? defaultRun;
  const entitlements = options.entitlements ?? path.join(__dirname, "macos-entitlements.plist");
  if (!identity) throw new Error("Set NODEVIEW_MAC_SIGN_IDENTITY to a Developer ID Application identity.");
  if (!fs.existsSync(bundle)) throw new Error(`macOS app bundle was not found: ${bundle}`);

  const info = fs.readFileSync(path.join(bundle, "Contents", "Info.plist"), "utf8");
  const executable = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(info)?.[1];
  if (!executable) throw new Error("Could not resolve CFBundleExecutable from Info.plist.");

  const node = path.join(bundle, "Contents", "Resources", "runtime", "node");
  const addon = path.join(bundle, "Contents", "Resources", "runtime", "native", "nodeview.node");
  const launcher = path.join(bundle, "Contents", "MacOS", executable);
  for (const target of [node, addon, launcher]) {
    if (!fs.existsSync(target)) throw new Error(`macOS signing target was not found: ${target}`);
  }

  run("codesign", ["--force", "--timestamp", "--options", "runtime", "--sign", identity, addon]);
  run("codesign", [
    "--force", "--timestamp", "--options", "runtime",
    "--entitlements", entitlements,
    "--sign", identity,
    node
  ]);
  run("codesign", ["--force", "--timestamp", "--options", "runtime", "--sign", identity, launcher]);
  run("codesign", ["--force", "--timestamp", "--options", "runtime", "--sign", identity, bundle]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", bundle]);
}

function notarizeMacApp(appBundle, options = {}) {
  const bundle = path.resolve(appBundle);
  const profile = options.profile ?? process.env.NODEVIEW_MAC_NOTARY_PROFILE;
  const run = options.run ?? defaultRun;
  if (!profile) throw new Error("Set NODEVIEW_MAC_NOTARY_PROFILE to a notarytool keychain profile.");
  const archive = bundle.replace(/\.app$/i, "-notarization.zip");

  fs.rmSync(archive, { force: true });
  try {
    run("ditto", ["-c", "-k", "--keepParent", bundle, archive]);
    run("xcrun", ["notarytool", "submit", archive, "--keychain-profile", profile, "--wait"]);
    run("xcrun", ["stapler", "staple", bundle]);
    run("xcrun", ["stapler", "validate", bundle]);
  } finally {
    fs.rmSync(archive, { force: true });
  }
}

module.exports = { notarizeMacApp, signMacApp };
