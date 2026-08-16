"use strict";

// Shape three: OS integration and a plugin. A focus timer that lives in the
// tray, shows taskbar progress, notifies when a session ends, refuses to run
// twice, and can be started from a link.
//
// The point of this example is breadth of integration, not features: it is the
// shape of application that touches the parts of NodeViewJS an ordinary app
// never does.

const path = require("node:path");

const { App } = require("nodeviewjs");

const { createTimerPlugin } = require("./timer-plugin");

const APP_TITLE = "Focus";
const APP_ID = "com.example.nodeviewjs-focus";

function createFocusApp(options = {}) {
  const app = new App({
    title: APP_TITLE,
    appId: APP_ID,
    width: 420,
    height: 340,
    center: true,
    // Closing the window leaves the timer running in the tray, which is the
    // whole point of a focus timer.
    closeToHide: true,
    // A second launch should reach the running timer, not start another one.
    singleInstance: true,
    // Started from a link such as focus://start/25.
    protocols: ["focus"],
    entry: path.join(__dirname, "index.html"),
    permissions: ["notification:show"],
    menu: [
      {
        label: "Session",
        submenu: [
          { id: "session.start", label: "Start", accelerator: "Ctrl+S" },
          // Ctrl+. would be the natural key here, but accelerators accept letters,
          // numbers, F1-F24, and named navigation keys only — not punctuation.
          { id: "session.stop", label: "Stop", accelerator: "Ctrl+E" },
          { type: "separator" },
          { id: "session.quit", label: "Quit", accelerator: "Ctrl+Q" }
        ]
      }
    ],
    tray: {
      title: APP_TITLE,
      menu: [
        { id: "tray.show", label: "Show" },
        { id: "tray.start", label: "Start a session" },
        { id: "tray.stop", label: "Stop" },
        { type: "separator" },
        { id: "tray.quit", label: "Quit" }
      ]
    }
  });

  // Two things this example had to work around, both worth knowing before
  // designing an application around plugins:
  //
  //   * app.emit() and a plugin's emit() both address windows, not the backend,
  //     so the host cannot subscribe to its own plugin's events. The plugin
  //     takes an onEvent callback instead.
  //   * backend code cannot invoke a registered command, so a menu item, tray
  //     item, or deep link cannot reach a plugin command the way a page can.
  //     The plugin hands back direct controls for that.
  const { plugin, controls } = createTimerPlugin({
    ...options.timer,
    onEvent: (name, payload) => onTimerEvent(name, payload)
  });
  app.use(plugin);

  // OS integration is driven from timer events rather than from the page, so it
  // keeps working while the window is hidden in the tray.
  function safely(what, action) {
    try {
      action();
    } catch (error) {
      // Taskbar and notification APIs are Windows-only, and a hidden or closed
      // window cannot show either. Neither is a reason to stop the timer.
      console.warn(`[${APP_TITLE}] ${what} unavailable: ${error.message}`);
    }
  }

  function onTimerEvent(name, payload) {
    if (name === "tick") {
      const elapsed = payload.minutes * 60 - payload.remaining;
      safely("taskbar progress", () => {
        app.setTaskbarProgress(Math.min(1, Math.max(0, elapsed / (payload.minutes * 60))));
      });
      return;
    }
    if (name === "started") {
      safely("taskbar progress", () => app.setTaskbarProgress(0));
      safely("notification", () => app.showNotification({
        title: APP_TITLE,
        message: `Focus session started: ${payload.minutes} minutes.`
      }));
      return;
    }
    if (name === "stopped") {
      safely("taskbar progress", () => app.setTaskbarProgress(null));
      return;
    }
    if (name === "finished") {
      safely("taskbar progress", () => app.setTaskbarProgress(null));
      safely("attention", () => app.requestAttention("informational"));
      safely("notification", () => app.showNotification({
        title: APP_TITLE,
        message: `${payload.minutes} minute session complete.`
      }));
      safely("show", () => app.show());
    }
  }

  app.on("menu", ({ id }) => {
    if (id === "session.start") controls.start();
    else if (id === "session.stop") controls.stop();
    else if (id === "session.quit") app.quit();
  });

  app.on("tray-menu", ({ id }) => {
    if (id === "tray.show") app.show();
    else if (id === "tray.start") controls.start();
    else if (id === "tray.stop") controls.stop();
    else if (id === "tray.quit") app.quit();
  });

  // A second launch raises the existing window instead of starting a rival
  // timer. The runtime restores and shows it before this handler runs.
  app.on("second-instance", ({ args }) => {
    console.log(`[${APP_TITLE}] A second launch was folded into this one: ${args.join(" ")}`);
  });

  // focus://start/25 starts a 25 minute session in the running instance.
  app.on("open-url", ({ url }) => {
    let minutes;
    try {
      const parsed = new URL(url);
      const requested = Number.parseInt(parsed.pathname.replace(/[^0-9]/g, ""), 10);
      if (Number.isInteger(requested) && requested > 0) minutes = requested;
    } catch {
      // A malformed link is not worth failing over; fall back to the default.
    }
    controls.start(minutes);
  });

  app.on("before-quit", () => {
    safely("taskbar progress", () => app.setTaskbarProgress(null));
  });

  return { app, controls, APP_ID, APP_TITLE };
}

module.exports = { APP_ID, APP_TITLE, createFocusApp };
