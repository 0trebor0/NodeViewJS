"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { resolveLogPath } = require("./data-directory");

const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_ENTRY_CHARACTERS = 64 * 1024;
const installedLoggers = new Set();
let monitorInstalled = false;

function isError(value) {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function formatError(value) {
  if (isError(value)) {
    try {
      return value.stack || `${value.name}: ${value.message}`;
    } catch {
      return "Unknown error.";
    }
  }
  try {
    return String(value);
  } catch {
    return "Unknown error.";
  }
}

function formatContext(value) {
  try {
    return String(value).replace(/[\r\n]+/g, " ").slice(0, 256);
  } catch {
    return "Unknown context.";
  }
}

function appendEntry(logPath, maxBytes, entry) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
    const bytes = Buffer.byteLength(entry, "utf8");
    let currentSize = 0;
    try {
      currentSize = fs.statSync(logPath).size;
    } catch (error) {
      if (error?.code !== "ENOENT") return false;
    }
    if (currentSize > 0 && currentSize + bytes > maxBytes) {
      const previous = `${logPath}.1`;
      fs.rmSync(previous, { force: true });
      fs.renameSync(logPath, previous);
    }
    const descriptor = fs.openSync(
      logPath,
      fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY,
      0o600
    );
    try {
      fs.writeSync(descriptor, entry, null, "utf8");
    } finally {
      fs.closeSync(descriptor);
    }
    return true;
  } catch {
    return false;
  }
}

function installProcessMonitor() {
  if (monitorInstalled) return;
  monitorInstalled = true;
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    for (const logger of installedLoggers) {
      logger.report(`Unhandled process error (${origin})`, error);
    }
  });
}

function createErrorLogger(appId, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Error logger options must be an object.");
  }
  const environment = options.environment ?? process.env;
  const logPath = path.resolve(
    options.logPath ?? environment.NODEVIEW_LOG_PATH ?? resolveLogPath(appId, environment)
  );
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("Error log size limit must be a positive safe integer.");
  }
  const reportedErrors = new WeakSet();
  let installed = false;

  const logger = {
    logPath,
    install() {
      if (installed) return logPath;
      installed = true;
      installedLoggers.add(logger);
      installProcessMonitor();
      return logPath;
    },
    dispose() {
      installedLoggers.delete(logger);
      installed = false;
    },
    report(context, value) {
      if (isError(value)) {
        if (reportedErrors.has(value)) return false;
        reportedErrors.add(value);
      }
      const safeContext = formatContext(context);
      const details = formatError(value).slice(0, MAX_ENTRY_CHARACTERS);
      const entry = `[${new Date().toISOString()}] [pid ${process.pid}] ${safeContext}\n${details}\n`;
      return appendEntry(logPath, maxBytes, entry);
    }
  };
  return logger;
}

module.exports = { DEFAULT_MAX_LOG_BYTES, createErrorLogger };
