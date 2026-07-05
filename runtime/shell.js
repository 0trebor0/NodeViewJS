"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

let nativeAddon;

function native() {
  if (process.platform !== "win32") {
    throw new Error("The NodeViewJS shell API is currently available only on Windows.");
  }
  nativeAddon ??= require("./native");
  return nativeAddon;
}

function openExternal(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("External URL must be a non-empty string.");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("External URL must be a valid absolute URL.");
  }
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) {
    throw new TypeError(`Unsupported external URL protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new TypeError("External URLs must not contain credentials.");
  }

  return native().openExternal(url.href);
}

function openPath(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Shell path must be a non-empty string.");
  }
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Shell path does not exist: ${resolved}`);
  }

  return native().openPath(resolved);
}

module.exports = { openExternal, openPath };
