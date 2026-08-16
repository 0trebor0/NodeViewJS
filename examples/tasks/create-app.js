"use strict";

// Tasks: a small but real desktop application, used to dogfood the API rather
// than to demonstrate every feature.
//
// The application is built here and run by app.js, so the whole backend can be
// constructed in a test without opening a window. That split is the pattern
// worth copying: commands and their validation are testable on their own.

const path = require("node:path");

const { App, Updater } = require("nodeviewjs");

const store = require("./store");

const APP_TITLE = "NodeViewJS Tasks";
const APP_ID = "com.example.nodeviewjs-tasks";

function createTasksApp(options = {}) {
  // Tests point this at a temporary directory; the app leaves it unset and
  // stores tasks in the user's application-data directory.
  const storeOptions = options.storeOptions ?? {};

  const app = new App({
    title: APP_TITLE,
    appId: APP_ID,
    width: 720,
    height: 620,
    center: true,
    closeToHide: true,
    icon: process.env.NODEVIEW_APP_ICON,
    entry: path.join(__dirname, "index.html"),
    // The app can read and write its own task file. Nothing else is granted.
    permissions: ["fs:read", "fs:write"],
    menu: [
      {
        label: "File",
        submenu: [
          { id: "file.quick-add", label: "Quick add", accelerator: "Ctrl+N" },
          { type: "separator" },
          { id: "file.quit", label: "Quit", accelerator: "Ctrl+Q" }
        ]
      },
      {
        label: "View",
        submenu: [
          { id: "view.refresh", label: "Refresh", accelerator: "Ctrl+R" },
          { id: "view.hide-done", label: "Hide completed", type: "checkbox", checked: false }
        ]
      }
    ],
    tray: {
      title: APP_TITLE,
      menu: [
        { id: "tray.show", label: "Show tasks" },
        { id: "tray.quick-add", label: "Quick add" },
        { type: "separator" },
        { id: "tray.quit", label: "Quit" }
      ]
    }
  });

  // One window at a time for quick entry. It is a separate window with a
  // narrower permission policy: it may add a task, but it cannot read the list.
  let quickAddWindow;

  function openQuickAdd() {
    if (quickAddWindow && !quickAddWindow.isClosed) {
      quickAddWindow.show();
      return quickAddWindow;
    }
    quickAddWindow = app.createWindow({
      title: "Quick add",
      entry: path.join(__dirname, "quick-add.html"),
      width: 460,
      height: 200,
      center: true,
      permissions: ["fs:write"]
    });
    return quickAddWindow;
  }

  // Every mutation broadcasts the new list, so both windows agree without
  // either of them polling.
  async function broadcast() {
    const tasks = await store.read(storeOptions);
    app.emit("tasks:changed", { tasks });
    return tasks;
  }

  app.command("tasks:list", { permission: "fs:read" }, async () => {
    return { tasks: await store.read(storeOptions) };
  });

  app.command("tasks:add", { permission: "fs:write" }, async (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("tasks:add requires an object payload.");
    }
    const task = await store.add(payload.title, storeOptions);
    await broadcast();
    return { task };
  });

  app.command("tasks:toggle", { permission: "fs:write" }, async (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("tasks:toggle requires an object payload.");
    }
    const task = await store.toggle(payload.id, storeOptions);
    await broadcast();
    return { task };
  });

  app.command("tasks:remove", { permission: "fs:write" }, async (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("tasks:remove requires an object payload.");
    }
    const result = await store.remove(payload.id, storeOptions);
    await broadcast();
    return result;
  });

  // Menu and tray items raise events; they never run privileged code directly.
  // The handler is async and awaits its work, so the runtime can report a
  // failure through the normal dispatch path. Firing an unawaited promise here
  // would turn any failure into an unhandled rejection instead.
  app.on("menu", async ({ id, checked, window }) => {
    if (id === "file.quick-add") openQuickAdd();
    else if (id === "file.quit") app.quit();
    else if (id === "view.refresh") await broadcast();
    else if (id === "view.hide-done") window.emit("view:hide-done", { hidden: checked === true });
  });

  app.on("tray-menu", ({ id }) => {
    if (id === "tray.show") app.show();
    else if (id === "tray.quick-add") openQuickAdd();
    else if (id === "tray.quit") app.quit();
  });

  // The quick-add window asks to be dismissed once it has added a task.
  app.on("quick-add:done", () => {
    if (quickAddWindow && !quickAddWindow.isClosed) quickAddWindow.close();
  });

  app.on("before-quit", () => {
    // Tasks are written on every change, so there is nothing to flush. Shutdown
    // is synchronous, which is exactly why this app never defers a write.
    console.log(`[${APP_TITLE}] Shutting down.`);
  });

  // Updates are wired for real, but only when the release configuration is
  // present, so the example runs unchanged without it.
  let updater;
  if (process.env.NODEVIEW_UPDATE_URL && process.env.NODEVIEW_UPDATE_KEY) {
    updater = new Updater({
      appId: APP_ID,
      currentVersion: process.env.NODEVIEW_APP_VERSION ?? "1.0.0",
      manifestUrl: process.env.NODEVIEW_UPDATE_URL,
      publicKey: process.env.NODEVIEW_UPDATE_KEY
    });
    updater.on("update-available", ({ version }) => {
      console.log(`[${APP_TITLE}] Update ${version} is available.`);
    });
    updater.on("updater-error", (error) => {
      // An update that cannot be checked is not a reason to stop working.
      console.warn(`[${APP_TITLE}] Update check failed: ${error.message}`);
    });
  }

  async function checkForUpdates() {
    if (!updater) return null;
    const update = await updater.checkForUpdates();
    if (!update) return null;
    await updater.downloadUpdate(update);
    return update;
  }

  return { app, openQuickAdd, broadcast, checkForUpdates, store, storeOptions, APP_ID, APP_TITLE };
}

module.exports = { APP_ID, APP_TITLE, createTasksApp };
