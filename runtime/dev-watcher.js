"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_EXTENSIONS = new Set([".css", ".htm", ".html", ".js", ".mjs"]);
const IGNORED_DIRECTORIES = new Set([".git", ".nodeview-webview", "build", "dist", "node_modules"]);

function isFrontendFile(fileName) {
  if (typeof fileName !== "string" || fileName.length === 0) {
    return false;
  }

  const parts = fileName.split(/[\\/]+/).map((part) => part.toLowerCase());
  if (parts.some((part) => IGNORED_DIRECTORIES.has(part))) {
    return false;
  }

  return FRONTEND_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function startDevWatcher(entry, reload, options = {}) {
  const watch = options.watch ?? fs.watch;
  const debounceMs = options.debounceMs ?? 100;
  const log = options.log ?? console.log;
  const reportError = options.reportError ?? console.error;
  const root = path.dirname(path.resolve(entry));
  let reloadTimer;

  try {
    const watcher = watch(root, { recursive: true }, (_eventType, fileName) => {
      if (!isFrontendFile(fileName)) {
        return;
      }

      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        try {
          reload();
          log(`[NodeViewJS dev] Reloaded after ${fileName} changed.`);
        } catch (error) {
          reportError(`[NodeViewJS dev] Reload failed: ${error.message}`);
        }
      }, debounceMs);
    });

    watcher.on("error", (error) => {
      reportError(`[NodeViewJS dev] File watcher failed: ${error.message}`);
    });
    watcher.on("close", () => clearTimeout(reloadTimer));
    watcher.unref();
    log(`[NodeViewJS dev] Watching ${root}`);
    return watcher;
  } catch (error) {
    reportError(`[NodeViewJS dev] Could not watch ${root}: ${error.message}`);
    return undefined;
  }
}

module.exports = { isFrontendFile, startDevWatcher };
