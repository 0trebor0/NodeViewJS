"use strict";

let terminating = false;

function reportFatal(label, value) {
  if (terminating) {
    return;
  }
  terminating = true;

  const details = value instanceof Error ? value.stack : String(value);
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
