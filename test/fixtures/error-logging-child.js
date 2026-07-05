"use strict";

const { createErrorLogger } = require("../../runtime/error-logger");

createErrorLogger("error-logging-child").install();

if (process.argv[2] === "rejection") {
  Promise.reject(new Error("deliberate unhandled rejection"));
} else {
  setImmediate(() => {
    throw new Error("deliberate uncaught exception");
  });
}
