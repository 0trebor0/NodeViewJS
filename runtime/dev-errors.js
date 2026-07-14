"use strict";

let terminating = false;

function isError(value) {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function formatFatalValue(value) {
  if (isError(value)) {
    try {
      return value.stack;
    } catch {
      return "Unknown fatal error.";
    }
  }
  try {
    return String(value);
  } catch {
    return "Unknown fatal error.";
  }
}

function reportFatal(label, value) {
  if (terminating) {
    return;
  }
  terminating = true;

  const details = formatFatalValue(value);
  console.error(`[NodeViewJS dev] ${label}`);
  console.error(details);
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
}

process.on("uncaughtException", (error) => {
  reportFatal("Backend crashed with an uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  reportFatal("Backend crashed with an unhandled promise rejection:", reason);
});
