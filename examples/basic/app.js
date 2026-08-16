"use strict";

// The canonical NodeViewJS starter.
//
// `nodeviewjs create` generates this same application, and the documentation
// and smoke tests use it, so this file is the one place the recommended
// architecture is demonstrated: a window, one validated backend command per
// privileged operation, a backend-to-frontend event, a declared permission
// policy, a native menu, packaging configuration, error handling, and where
// updates would be wired in.

const path = require("node:path");
const { App, config } = require("../../runtime");

const APP_TITLE = "NodeViewJS Starter";
const APP_ID = "nodeviewjs-starter";
const NOTE_FILE = "note.json";

const app = new App({
  title: APP_TITLE,
  appId: APP_ID,
  width: 960,
  height: 640,
  center: true,
  // Set by `nodeviewjs package`; undefined during development.
  icon: process.env.NODEVIEW_APP_ICON,
  entry: path.join(__dirname, "index.html"),
  // Grant only what the commands below actually need. This is the ceiling: a
  // command cannot require a permission that is not granted here.
  permissions: ["fs:read", "fs:write"],
  menu: [
    {
      label: "File",
      submenu: [
        { id: "file.save", label: "Save note", accelerator: "Ctrl+S" },
        { type: "separator" },
        { id: "file.quit", label: "Quit", accelerator: "Ctrl+Q" }
      ]
    }
  ]
});

function noteOptions() {
  return { appName: APP_TITLE, fileName: NOTE_FILE };
}

// Structural IPC validation does not cover meaning: a handler still has to
// check what it was actually given before acting on it.
function requireText(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("A note payload object is required.");
  }
  const { text } = payload;
  if (typeof text !== "string") {
    throw new TypeError("Note text must be a string.");
  }
  if (text.length > 10_000) {
    throw new RangeError("Note text must be at most 10,000 characters.");
  }
  return text;
}

// One command per privileged operation, each declaring the permission it needs.
// The page can call these; it cannot reach the filesystem itself.
app.command("note:load", { permission: "fs:read" }, async () => {
  const stored = await config.read({ ...noteOptions(), defaults: { text: "" } });
  return { text: typeof stored.text === "string" ? stored.text : "" };
});

app.command("note:save", { permission: "fs:write" }, async (payload) => {
  const text = requireText(payload);
  await config.write({ ...noteOptions(), data: { text, savedAt: new Date().toISOString() } });
  // Backend to frontend: tell every window the note changed. emit() is one-way;
  // the command's own return value is what the caller awaits.
  app.emit("note:saved", { savedAt: new Date().toISOString() });
  return { saved: true };
});

// Menu items carry ids and raise events; they never run native code directly.
app.on("menu", ({ id, window }) => {
  if (id === "file.save") {
    // Ask the page to save: it owns the current text.
    window.emit("menu:save");
    return;
  }
  if (id === "file.quit") {
    app.quit();
  }
});

// A failing event handler is reported to app.logPath and isolated, so it never
// takes the process down. Command failures are returned to the caller instead,
// where NodeViewJS.invoke() rejects with the message.
console.log(`[${APP_TITLE}] Backend log: ${app.logPath}`);

app.run();

// Updates are opt-in and need a packaged launcher plus a published, signed
// manifest, so the starter leaves them configured but inactive:
//
//   const { Updater } = require("../../runtime");
//   const updater = new Updater({
//     appId: APP_ID,
//     currentVersion: process.env.NODEVIEW_APP_VERSION ?? "0.1.0",
//     manifestUrl: "https://updates.example.com/update.json",
//     publicKey: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
//   });
//   updater.on("updater-error", (error) => console.error("Update failed:", error));
//   const update = await updater.checkForUpdates();
//   if (update) {
//     await updater.downloadUpdate(update);
//     await updater.installAndRestart(app);
//   }
//
// See wiki/Packaging-and-Distribution.md.

try {
  app.showNotification({ title: APP_TITLE, message: "The application is ready." });
} catch (error) {
  // Notifications are a nicety, and unavailable on some platforms and
  // configurations. Never let one stop startup.
  console.warn(`[${APP_TITLE}] Notification unavailable: ${error.message}`);
}
