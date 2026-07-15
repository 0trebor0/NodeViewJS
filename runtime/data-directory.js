"use strict";

const os = require("node:os");
const path = require("node:path");

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

function resolveAppId(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("App id must be a non-empty string.");
  }
  const resolved = value.trim().normalize("NFKC");
  if (CONTROL_CHARACTER_PATTERN.test(resolved)) {
    throw new TypeError("App id must not contain control characters.");
  }
  return resolved;
}

function hashAppId(appId) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(appId.normalize("NFKC").toLowerCase(), "utf8")) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function resolveAppDataLabel(appId) {
  const resolvedAppId = resolveAppId(appId);
  return resolvedAppId
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 48) || "app";
}

function resolveAppUserModelId(appId) {
  const resolvedAppId = resolveAppId(appId);
  const label = resolveAppDataLabel(resolvedAppId)
    .replace(/[-_]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "App";
  return `NodeViewJS.${label}.${hashAppId(resolvedAppId)}`.slice(0, 128);
}

function resolveLocalAppData(environment) {
  const platform = environment.NODEVIEW_PLATFORM || process.platform;
  if (platform === "darwin") {
    return path.resolve(
      environment.HOME || os.homedir(),
      "Library",
      "Application Support"
    );
  }
  if (platform === "linux") {
    return path.resolve(
      environment.XDG_DATA_HOME || path.join(environment.HOME || os.homedir(), ".local", "share")
    );
  }
  return path.resolve(
    environment.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
  );
}

function resolveWebViewDataDirectory(appId, environment = process.env) {
  const resolvedAppId = resolveAppId(appId);
  const platform = environment.NODEVIEW_PLATFORM || process.platform;
  const dataDirectoryName = platform === "darwin"
    ? "WebKit"
    : platform === "linux" ? "WebKitGTK" : "WebView2";

  return path.join(
    resolveLocalAppData(environment),
    "NodeViewJS",
    `${resolveAppDataLabel(resolvedAppId)}-${hashAppId(resolvedAppId)}`,
    dataDirectoryName
  );
}

function resolveUpdateDirectory(appId, environment = process.env) {
  const resolvedAppId = resolveAppId(appId);
  return path.join(
    resolveLocalAppData(environment),
    "NodeViewJS",
    "Updates",
    `${resolveAppDataLabel(resolvedAppId)}-${hashAppId(resolvedAppId)}`
  );
}

function resolveLogDirectory(appId, environment = process.env) {
  const resolvedAppId = resolveAppId(appId);
  const directoryName = `${resolveAppDataLabel(resolvedAppId)}-${hashAppId(resolvedAppId)}`;
  const platform = environment.NODEVIEW_PLATFORM || process.platform;
  if (platform === "darwin") {
    return path.join(
      environment.HOME || os.homedir(),
      "Library", "Logs", "NodeViewJS", directoryName
    );
  }
  if (platform === "linux") {
    const stateRoot = environment.XDG_STATE_HOME
      || path.join(environment.HOME || os.homedir(), ".local", "state");
    return path.join(stateRoot, "nodeviewjs", directoryName);
  }
  return path.join(resolveLocalAppData(environment), "NodeViewJS", "Logs", directoryName);
}

function resolveLogPath(appId, environment = process.env) {
  return path.join(resolveLogDirectory(appId, environment), "backend.log");
}

module.exports = {
  resolveAppId,
  resolveAppUserModelId,
  resolveLogDirectory,
  resolveLogPath,
  resolveUpdateDirectory,
  resolveWebViewDataDirectory
};
