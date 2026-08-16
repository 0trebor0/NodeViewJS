"use strict";

// Entry point. Everything else lives in create-app.js so the backend can be
// constructed and tested without opening a window.

const { createTasksApp } = require("./create-app");

const { app, checkForUpdates } = createTasksApp();

app.run();

// Checking for updates must never keep the app from starting.
checkForUpdates().catch((error) => {
  console.warn(`[Tasks] Update check failed: ${error.message}`);
});
