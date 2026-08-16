"use strict";

// A backend plugin: the timer itself, packaged the way a third-party addition
// would be. It registers namespaced commands and events, declares the
// permissions it needs, and cleans up after itself.
//
// Plugin hooks are synchronous by contract, so the interval is started here and
// released in the matching hook rather than awaited.

const DEFAULT_MINUTES = 25;
const MAX_MINUTES = 180;

// Returns the plugin together with the controls its host needs.
//
// That second half exists because of a real limit worth knowing about:
// app.emit() delivers to windows, not to the backend's own listeners, so a menu
// item, a tray item, or a deep link cannot reach a plugin command the way a
// page can. A plugin meant to be driven by its host has to hand the host a
// direct interface.
function createTimerPlugin(options = {}) {
  // Injectable, so tests drive time instead of waiting for it.
  const now = options.now ?? (() => Date.now());
  const startInterval = options.setInterval ?? setInterval;
  const stopInterval = options.clearInterval ?? clearInterval;
  const tickMs = options.tickMs ?? 1000;
  // The host cannot subscribe to plugin events: context.emit() reaches windows,
  // not the backend. So the host passes a listener in.
  const onEvent = options.onEvent ?? (() => {});

  function announce(name, payload) {
    context.emit(name, payload);
    onEvent(name, payload);
  }

  const state = { endsAt: undefined, minutes: DEFAULT_MINUTES, running: false };
  let handle;
  let context;

  function remainingSeconds() {
    if (!state.running || state.endsAt === undefined) return 0;
    return Math.max(0, Math.ceil((state.endsAt - now()) / 1000));
  }

  function snapshot() {
    return { running: state.running, minutes: state.minutes, remaining: remainingSeconds() };
  }

  function stopTicking() {
    if (handle !== undefined) {
      stopInterval(handle);
      handle = undefined;
    }
  }

  function finish() {
    stopTicking();
    state.running = false;
    state.endsAt = undefined;
    announce("finished", { minutes: state.minutes });
  }

  function tick() {
    announce("tick", snapshot());
    if (remainingSeconds() === 0) finish();
  }

  function start(requestedMinutes) {
    const minutes = requestedMinutes ?? DEFAULT_MINUTES;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
      throw new RangeError(`Minutes must be a whole number between 1 and ${MAX_MINUTES}.`);
    }
    stopTicking();
    state.minutes = minutes;
    state.endsAt = now() + minutes * 60_000;
    state.running = true;
    handle = startInterval(tick, tickMs);
    handle?.unref?.();
    announce("started", snapshot());
    return snapshot();
  }

  function stop() {
    stopTicking();
    state.running = false;
    state.endsAt = undefined;
    announce("stopped", snapshot());
    return snapshot();
  }

  const plugin = {
    name: "focus.timer",
    version: "1.0.0",
    permissions: ["notification:show"],

    setup(pluginContext) {
      context = pluginContext;

      // The page reaches these through NodeViewJS.invoke("focus.timer:start").
      pluginContext.command("start", (payload) => {
        if (payload !== undefined && (typeof payload !== "object" || payload === null || Array.isArray(payload))) {
          throw new TypeError("focus.timer:start requires an object payload.");
        }
        return start(payload?.minutes);
      });
      pluginContext.command("stop", () => stop());
      pluginContext.command("state", () => snapshot());

      // The interval must not outlive the plugin.
      return () => stopTicking();
    },

    stop() {
      stopTicking();
    }
  };

  return { plugin, controls: { start, stop, snapshot } };
}

module.exports = { DEFAULT_MINUTES, MAX_MINUTES, createTimerPlugin };
