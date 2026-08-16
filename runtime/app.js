"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const {
  resolveAppId,
  resolveAppUserModelId,
  resolveWebViewDataDirectory
} = require("./data-directory");
const { startDevWatcher } = require("./dev-watcher");
const { assertDenseArray, safeDiagnosticString } = require("./validation");
const { createErrorLogger } = require("./error-logger");
const ipc = require("./ipc");
const { findLaunchTargets, resolveLaunchConfiguration } = require("./launch-routing");
const {
  normalizeContextPosition,
  normalizeMenuTemplate,
  normalizeTrayMenuTemplate
} = require("./menu");
const net = require("./net");
const { normalizeAllowedOrigins } = net;
const { normalizeNotificationOptions } = require("./notification");
const { SingleInstanceCoordinator } = require("./single-instance");
const { normalizeAttentionType, normalizeOverlay, normalizeProgress } = require("./taskbar");
const { normalizeWindowColors } = require("./window-colors");

const COMMAND_PERMISSIONS = new Set([
  "fs:read",
  "fs:write",
  "dialog:open",
  "dialog:save",
  "clipboard:read",
  "clipboard:write",
  "shell:open",
  "notification:show",
  "window:control",
  "net:fetch"
]);
const PERMISSION_GROUPS = new Set(
  [...COMMAND_PERMISSIONS].map((permission) => `${permission.split(":", 1)[0]}:*`)
);
const PERMISSION_SCOPE_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._/-]*[a-zA-Z0-9])?$/;
const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const PLUGIN_MEMBER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

let nativeAddon;

function native() {
  nativeAddon ??= require("./native");
  return nativeAddon;
}

function safeObjectKeys(value) {
  try {
    return Object.keys(value);
  } catch {
    return undefined;
  }
}

function parsePermission(value, { allowGroups, allowScopeWildcard, label }) {
  if (typeof value !== "string") {
    throw new TypeError(`Unsupported ${label} permission: ${safeDiagnosticString(value)}`);
  }
  if (COMMAND_PERMISSIONS.has(value)) return value;
  if (allowGroups && PERMISSION_GROUPS.has(value)) return value;

  for (const permission of COMMAND_PERMISSIONS) {
    const prefix = `${permission}:`;
    if (!value.startsWith(prefix)) continue;
    const scope = value.slice(prefix.length);
    if ((allowScopeWildcard && scope === "*") || PERMISSION_SCOPE_PATTERN.test(scope)) {
      return value;
    }
  }

  throw new TypeError(`Unsupported ${label} permission: ${safeDiagnosticString(value)}`);
}

function parseCommandPermission(value) {
  return parsePermission(value, {
    allowGroups: false,
    allowScopeWildcard: false,
    label: "command"
  });
}

function parseAppPermission(value) {
  return parsePermission(value, {
    allowGroups: true,
    allowScopeWildcard: true,
    label: "app"
  });
}

function permissionMatches(grant, requirement) {
  if (grant === requirement) return true;

  const permission = [...COMMAND_PERMISSIONS].find(
    (candidate) => requirement === candidate || requirement.startsWith(`${candidate}:`)
  );
  if (!permission) return false;

  const group = `${permission.split(":", 1)[0]}:*`;
  if (grant === group) return true;
  if (requirement.startsWith(`${permission}:`)) {
    return grant === permission || grant === `${permission}:*`;
  }
  return false;
}

function hasPermission(policy, requirement) {
  if ([...policy.deny].some((grant) => permissionMatches(grant, requirement))) {
    return false;
  }
  return [...policy.allow].some((grant) => permissionMatches(grant, requirement));
}

function createErrorDetail(error) {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 1_024);
  } catch {
    return "Unknown IPC command error.";
  }
}

function assertPluginMemberName(value, label) {
  if (typeof value !== "string" || !PLUGIN_MEMBER_PATTERN.test(value)) {
    throw new TypeError(`Plugin ${label} must use letters, numbers, dots, underscores, or hyphens.`);
  }
  return value;
}

function assertSynchronousHookResult(result, label) {
  if (result && typeof result.then === "function") {
    Promise.resolve(result).catch(() => {});
    throw new TypeError(`Plugin ${label} hook must be synchronous.`);
  }
  return result;
}

function resolveCommandRegistration(optionsOrHandler, maybeHandler) {
  if (typeof optionsOrHandler === "function" && maybeHandler === undefined) {
    return { handler: optionsOrHandler, permissions: [] };
  }

  if (!optionsOrHandler || typeof optionsOrHandler !== "object" || Array.isArray(optionsOrHandler)) {
    throw new TypeError("Command options must be an object when a third handler argument is used.");
  }

  if (typeof maybeHandler !== "function") {
    throw new TypeError("Command handler must be a function.");
  }

  const { permission, permissions, scope } = optionsOrHandler;
  if (permission !== undefined && permissions !== undefined) {
    throw new TypeError("Command options cannot use both permission and permissions.");
  }
  if (permissions !== undefined && !Array.isArray(permissions)) {
    throw new TypeError("Command permissions must be an array.");
  }
  if (scope !== undefined && permission === undefined) {
    throw new TypeError("Command scope requires a singular permission.");
  }

  let requirements = [];
  if (permission !== undefined) {
    const parsed = parseCommandPermission(permission);
    if (scope !== undefined) {
      if (!COMMAND_PERMISSIONS.has(parsed) || typeof scope !== "string" ||
          !PERMISSION_SCOPE_PATTERN.test(scope)) {
        throw new TypeError(`Unsupported command permission scope: ${safeDiagnosticString(scope)}`);
      }
      requirements = [`${parsed}:${scope}`];
    } else {
      requirements = [parsed];
    }
  } else if (permissions !== undefined) {
    requirements = assertDenseArray(permissions, "Command permissions").map(parseCommandPermission);
  }

  return { handler: maybeHandler, permissions: requirements };
}

function resolvePermissions(options) {
  const permissions = options.permissions ?? [];
  let allow;
  let deny;

  if (Array.isArray(permissions)) {
    allow = assertDenseArray(permissions, "App permissions");
    deny = [];
  } else if (permissions && typeof permissions === "object") {
    const keys = safeObjectKeys(permissions);
    if (!keys) {
      throw new TypeError("App permission policy object could not be inspected.");
    }
    const unknownKeys = keys.filter(
      (key) => key !== "allow" && key !== "deny"
    );
    if (unknownKeys.length > 0) {
      throw new TypeError(
        `Unsupported app permission policy option: ${safeDiagnosticString(unknownKeys[0])}`
      );
    }
    allow = permissions.allow ?? [];
    deny = permissions.deny ?? [];
    if (!Array.isArray(allow) || !Array.isArray(deny)) {
      throw new TypeError("App permission policy allow and deny values must be arrays.");
    }
    assertDenseArray(allow, "App permission policy allow");
    assertDenseArray(deny, "App permission policy deny");
  } else {
    throw new TypeError("App permissions must be an array or policy object.");
  }

  return {
    allow: new Set(allow.map(parseAppPermission)),
    deny: new Set(deny.map(parseAppPermission))
  };
}

function resolveTrayOptions(options, fallbackTitle, fallbackIcon, fallbackMenu) {
  if (options === undefined || options === false) {
    return undefined;
  }
  if (options === true) {
    return {
      title: fallbackTitle,
      icon: fallbackIcon && path.resolve(fallbackIcon),
      menu: fallbackMenu
    };
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Tray options must be an object or boolean.");
  }

  const title = options.title ?? fallbackTitle;
  if (typeof title !== "string" || title.length === 0) {
    throw new TypeError("Tray title must be a non-empty string.");
  }

  const icon = options.icon ?? fallbackIcon;
  if (icon !== undefined && typeof icon !== "string") {
    throw new TypeError("Tray icon must be a string.");
  }

  const menu = options.menu === undefined
    ? fallbackMenu
    : normalizeTrayMenuTemplate(options.menu, { allowNull: true });

  return {
    title,
    icon: icon && path.resolve(icon),
    menu
  };
}

function resolveWindowOptions(options, fallback = {}, owner = "Window") {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Window options must be an object.");
  }

  const entry = options.entry ?? fallback.entry;
  if (typeof entry !== "string" || entry.length === 0) {
    throw new TypeError(`${owner} requires a non-empty entry file path.`);
  }
  const title = options.title ?? fallback.title ?? "NodeViewJS";
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new TypeError(`${owner} title must be a non-empty string.`);
  }
  const appId = resolveAppId(options.appId ?? fallback.appId ?? title);
  const icon = options.icon ?? fallback.icon;
  if (options.frameOnHover !== undefined || fallback.frameOnHover !== undefined) {
    throw new TypeError(`${owner} frameOnHover is not currently supported.`);
  }
  const frame = options.frame ?? fallback.frame ?? true;
  const singleInstance = options.singleInstance ?? fallback.singleInstance ?? false;
  if (typeof singleInstance !== "boolean") {
    throw new TypeError(`${owner} singleInstance must be a boolean.`);
  }
  const menu = options.menu === undefined
    ? fallback.menu ?? null
    : normalizeMenuTemplate(options.menu, { allowNull: true });
  const permissions = options.permissions;
  const permissionPolicy = permissions === undefined
    ? fallback.permissionPolicy ?? resolvePermissions({})
    : resolvePermissions({ permissions });
  const packaged = process.env.NODEVIEW_BRIDGE_EMBEDDED === "1";

  return {
    title,
    appId,
    width: options.width ?? fallback.width ?? 800,
    height: options.height ?? fallback.height ?? 600,
    resizable: options.resizable ?? fallback.resizable ?? true,
    minWidth: options.minWidth ?? fallback.minWidth,
    minHeight: options.minHeight ?? fallback.minHeight,
    maxWidth: options.maxWidth ?? fallback.maxWidth,
    maxHeight: options.maxHeight ?? fallback.maxHeight,
    frame,
    closable: options.closable ?? fallback.closable ?? true,
    minimizable: options.minimizable ?? fallback.minimizable ?? true,
    maximizable: options.maximizable ?? fallback.maximizable ?? true,
    maximized: options.maximized ?? fallback.maximized ?? false,
    center: options.center ?? fallback.center ?? false,
    alwaysOnTop: options.alwaysOnTop ?? fallback.alwaysOnTop ?? false,
    closeToHide: options.closeToHide ?? fallback.closeToHide ?? false,
    transparent: options.transparent ?? fallback.transparent ?? false,
    windowColors: normalizeWindowColors(options.windowColors, fallback.windowColors),
    devtools: options.devtools ?? fallback.devtools
      ?? (!packaged && process.env.NODEVIEW_DEVTOOLS === "1"),
    startupTiming: options.startupTiming ?? fallback.startupTiming
      ?? (!packaged && process.env.NODEVIEW_STARTUP_TIMING === "1"),
    singleInstance,
    permissionPolicy,
    allowedOrigins: normalizeAllowedOrigins(options.allowedOrigins ?? fallback.allowedOrigins),
    menu,
    icon: icon && path.resolve(icon),
    entry: path.resolve(entry),
    webViewDataDirectory: resolveWebViewDataDirectory(appId),
    tray: resolveTrayOptions(options.tray, title, icon)
  };
}

class AppWindow {
  #app;
  #bridgeReady = false;
  #closed = false;
  #devWatcher;
  #disposed = false;
  #eventHandlers = new Map();
  #id;
  #pendingMessages = [];
  #pendingMessageBytes = 0;

  constructor(app, options) {
    this.#app = app;
    this.options = options;
  }

  get id() {
    return this.#id;
  }

  get isOpen() {
    return this.#id !== undefined;
  }

  // True only after close(); a window that has not been opened yet is not closed,
  // so it still buffers events emitted before run().
  get isClosed() {
    return this.#closed;
  }

  // "configured" before the first open, "open" while a native window exists,
  // "closed" once closed but still reopenable by a startup retry, and
  // "disposed" once the app has released it. Opening and closing are
  // synchronous, so no caller can observe an intermediate state.
  get lifecycleState() {
    if (this.#disposed) return "disposed";
    if (this.#id !== undefined) return "open";
    return this.#closed ? "closed" : "configured";
  }

  on(eventName, handler) {
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new TypeError("Event name must be a non-empty string.");
    }
    if (typeof handler !== "function") {
      throw new TypeError("Event handler must be a function.");
    }

    const handlers = this.#eventHandlers.get(eventName) ?? new Set();
    handlers.add(handler);
    this.#eventHandlers.set(eventName, handlers);
    // Delegating to off() keeps the empty-set cleanup in one place and makes a
    // repeated call harmless.
    return () => {
      this.off(eventName, handler);
    };
  }

  once(eventName, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("Event handler must be a function.");
    }
    const off = this.on(eventName, async (payload) => {
      off();
      await handler(payload);
    });
    return off;
  }

  off(eventName, handler) {
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new TypeError("Event name must be a non-empty string.");
    }
    if (typeof handler !== "function") {
      throw new TypeError("Event handler must be a function.");
    }
    const handlers = this.#eventHandlers.get(eventName);
    handlers?.delete(handler);
    if (handlers?.size === 0) this.#eventHandlers.delete(eventName);
    return this;
  }

  emit(eventName, payload) {
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new TypeError("Event name must be a non-empty string.");
    }
    // A closed window can never flush its readiness buffer, so queueing here
    // would grow memory and only surface as a buffer-limit error much later.
    if (this.#disposed) {
      throw new Error("Window has been disposed.");
    }
    if (this.#closed) {
      throw new Error("Window has been closed.");
    }
    const message = ipc.serialize(ipc.createEventMessage(eventName, payload));
    if (this.#bridgeReady) this._post(message);
    else {
      const bytes = Buffer.byteLength(message, "utf8");
      if (this.#pendingMessages.length >= 1024
          || this.#pendingMessageBytes + bytes > 1024 * 1024) {
        throw new RangeError("Pending window events exceed the bridge readiness buffer limit.");
      }
      this.#pendingMessages.push(message);
      this.#pendingMessageBytes += bytes;
    }
    return this;
  }

  show() {
    if (this.#id !== undefined) native().showWindow(this.#id);
    return this;
  }

  hide() {
    if (this.#id !== undefined) native().hideWindow(this.#id);
    return this;
  }

  close() {
    this.#devWatcher?.close?.();
    this.#devWatcher = undefined;
    if (this.#id !== undefined) {
      native().closeWindow(this.#id);
      this.#id = undefined;
    }
    this.#bridgeReady = false;
    this.#pendingMessages = [];
    this.#pendingMessageBytes = 0;
    this.#closed = true;
    this.#app._retireWindow(this);
    return this;
  }

  reload() {
    if (this.#id !== undefined) {
      this._resetBridgeReady();
      native().reload(this.#id);
    }
    return this;
  }

  minimize() {
    if (this.#id !== undefined) native().minimizeWindow(this.#id);
    return this;
  }

  maximize() {
    if (this.#id !== undefined) native().maximizeWindow(this.#id);
    return this;
  }

  restore() {
    if (this.#id !== undefined) native().restoreWindow(this.#id);
    return this;
  }

  setFullscreen(fullscreen = true) {
    if (typeof fullscreen !== "boolean") {
      throw new TypeError("Window fullscreen state must be a boolean.");
    }
    if (this.#id !== undefined) native().setWindowFullscreen(this.#id, fullscreen);
    return this;
  }

  setTitle(title) {
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new TypeError("Window title must be a non-empty string.");
    }
    this.options.title = title;
    if (this.#id !== undefined) native().setWindowTitle(this.#id, title);
    return this;
  }

  setSize(width, height) {
    for (const [name, value] of [["width", width], ["height", height]]) {
      if (!Number.isInteger(value) || value < 1 || value > 32767) {
        throw new RangeError(`Window ${name} must be an integer between 1 and 32767.`);
      }
    }
    this.options.width = width;
    this.options.height = height;
    if (this.#id !== undefined) native().setWindowSize(this.#id, width, height);
    return this;
  }

  setPosition(x, y) {
    for (const [name, value] of [["x", x], ["y", y]]) {
      if (!Number.isInteger(value) || value < -32768 || value > 32767) {
        throw new RangeError(`Window ${name} must be an integer between -32768 and 32767.`);
      }
    }
    if (this.#id !== undefined) native().setWindowPosition(this.#id, x, y);
    return this;
  }

  startDrag() {
    if (this.#id !== undefined) native().startWindowDrag(this.#id);
    return this;
  }

  getState() {
    if (this.#id === undefined) return { isOpen: false };
    return { isOpen: true, ...native().getWindowState(this.#id) };
  }

  setMenu(template) {
    const menu = normalizeMenuTemplate(template, { allowNull: true });
    this.options.menu = menu;
    if (this.#id !== undefined) {
      if (typeof native().setApplicationMenu !== "function") {
        throw new Error("Native application menus are currently available only on Windows.");
      }
      native().setApplicationMenu(this.#id, menu);
    }
    return this;
  }

  showContextMenu(template, position = {}) {
    const menu = normalizeMenuTemplate(template);
    const coordinates = normalizeContextPosition(position);
    if (this.#id === undefined) throw new Error("Window has not been opened.");
    if (typeof native().showContextMenu !== "function") {
      throw new Error("Native context menus are currently available only on Windows.");
    }
    native().showContextMenu(this.#id, menu, coordinates);
    return this;
  }

  setTaskbarProgress(value, state = "normal") {
    const progress = normalizeProgress(value, state);
    if (this.#id === undefined) throw new Error("Window has not been opened.");
    if (typeof native().setTaskbarProgress !== "function") {
      throw new Error("Taskbar integration is currently available only on Windows.");
    }
    native().setTaskbarProgress(this.#id, progress.value, progress.state);
    return this;
  }

  setTaskbarOverlay(icon, description = "") {
    const overlay = normalizeOverlay(icon, description);
    if (this.#id === undefined) throw new Error("Window has not been opened.");
    if (typeof native().setTaskbarOverlay !== "function") {
      throw new Error("Taskbar integration is currently available only on Windows.");
    }
    native().setTaskbarOverlay(this.#id, overlay.icon, overlay.description);
    return this;
  }

  requestAttention(type = "informational") {
    const attention = normalizeAttentionType(type);
    if (this.#id === undefined) throw new Error("Window has not been opened.");
    if (typeof native().requestWindowAttention !== "function") {
      throw new Error("Window attention is currently available only on Windows.");
    }
    native().requestWindowAttention(this.#id, attention);
    return this;
  }

  setWindowColors(colors = {}) {
    const normalized = normalizeWindowColors(colors, this.options.windowColors);
    this.options.windowColors = normalized;
    if (this.#id !== undefined) {
      if (typeof native().setWindowColors !== "function") {
        throw new Error("Native window colors are currently available only on Windows.");
      }
      native().setWindowColors(this.#id, normalized);
    }
    return this;
  }

  showNotification(options) {
    const notification = normalizeNotificationOptions(options);
    if (this.#id === undefined) throw new Error("Window has not been opened.");
    native().showNotification(this.#id, notification);
    return this;
  }

  setTray(options = {}) {
    const tray = resolveTrayOptions(
      options,
      this.options.title,
      this.options.icon,
      this.options.tray?.menu
    );
    if (!tray) throw new TypeError("Tray options must be an object or true.");
    this.options.tray = tray;
    if (this.#id !== undefined) native().setTray(this.#id, tray);
    return this;
  }

  _open(showImmediately) {
    if (this.#id !== undefined) return this;
    if (this.#disposed) {
      throw new Error("Window has been disposed and cannot be reopened.");
    }
    if (!fs.existsSync(this.options.entry)) {
      throw new Error(`Window entry file was not found: ${this.options.entry}`);
    }
    this.#closed = false;

    const id = native().createWindow({
      title: this.options.title,
      appUserModelId: resolveAppUserModelId(this.options.appId),
      width: this.options.width,
      height: this.options.height,
      resizable: this.options.resizable,
      minWidth: this.options.minWidth,
      minHeight: this.options.minHeight,
      maxWidth: this.options.maxWidth,
      maxHeight: this.options.maxHeight,
      frame: this.options.frame,
      closable: this.options.closable,
      minimizable: this.options.minimizable,
      maximizable: this.options.maximizable,
      maximized: this.options.maximized,
      center: this.options.center,
      alwaysOnTop: this.options.alwaysOnTop,
      closeToHide: this.options.closeToHide,
      transparent: this.options.transparent,
      windowColors: this.options.windowColors,
      devtools: this.options.devtools,
      bridgeEmbedded: process.env.NODEVIEW_BRIDGE_EMBEDDED === "1",
      icon: this.options.icon,
      dataDirectory: this.options.webViewDataDirectory
    });
    this.#id = id;

    try {
      if (this.options.tray) native().setTray(id, this.options.tray);
      // Native callbacks have no caller to reject into, so every promise they
      // start is consumed here rather than escaping as an unhandled rejection.
      // The already-settled promise is returned so tests can await a dispatch;
      // the native caller ignores it.
      native().setMessageHandler(id, (message) => this.#app
        ._handleWindowMessage(this, message)
        .catch((error) => {
          this.#app._reportHandlerFailure("Window message handling failed", error);
        }));
      if (typeof native().setMenuHandler === "function") {
        native().setMenuHandler(id, (event) => this.#app
          ._handleMenuCommand(this, event)
          .catch((error) => {
            this.#app._reportHandlerFailure("Menu handler failed", error);
          }));
        if (this.options.menu) native().setApplicationMenu(id, this.options.menu);
      }
      native().loadFile(id, this.options.entry);
      if (process.env.NODEVIEW_DEV_WATCH === "1" &&
          process.env.NODEVIEW_BRIDGE_EMBEDDED !== "1") {
        this.#devWatcher = startDevWatcher(this.options.entry, () => this.reload());
      }
      if (showImmediately) native().showWindow(id);
    } catch (error) {
      this.close();
      throw error;
    }
    return this;
  }

  async _dispatch(eventName, payload) {
    await this.#app._dispatchHandlers(
      this.#eventHandlers.get(eventName),
      payload,
      `Window event '${eventName}' failed`
    );
  }

  // Called by the app once a running application closes this window: the
  // window is not reopenable afterwards, so its handlers and buffers must not
  // outlive it.
  _dispose() {
    this.#disposed = true;
    this.#eventHandlers.clear();
    this.#pendingMessages = [];
    this.#pendingMessageBytes = 0;
  }

  // Internal: lets the event-cleanup tests prove that unsubscribing removes the
  // event name instead of leaving an empty handler set behind.
  _eventNames() {
    return [...this.#eventHandlers.keys()];
  }

  _post(serializedMessage) {
    if (this.#id === undefined) {
      throw new Error("Window has not been opened.");
    }
    native().postMessage(this.#id, serializedMessage);
  }

  _markBridgeReady() {
    if (this.#bridgeReady) return;
    this.#bridgeReady = true;
    const messages = this.#pendingMessages;
    this.#pendingMessages = [];
    this.#pendingMessageBytes = 0;
    for (const message of messages) this._post(message);
  }

  _resetBridgeReady() {
    this.#bridgeReady = false;
  }
}

class App {
  #commands = new Map();
  #errorLogger;
  #eventHandlers = new Map();
  #hasRun = false;
  #ipcRequestStates = new WeakMap();
  #permissions;
  #plugins = new Map();
  #pluginsDisposed = false;
  #startupStartedAt = performance.now();
  #mainWindow;
  #launchConfiguration;
  #singleInstance;
  #windowPermissionPolicies = new WeakMap();
  #windows = new Set();

  constructor(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("App options must be an object.");
    }
    const resolvedOptions = resolveWindowOptions(options, {}, "App");
    const { permissionPolicy, ...publicOptions } = resolvedOptions;
    this.options = publicOptions;
    this.#permissions = permissionPolicy;
    this.#errorLogger = createErrorLogger(this.options.appId);
    this.#launchConfiguration = resolveLaunchConfiguration(options);
    this.options.protocols = this.#launchConfiguration.protocols;
    this.options.fileAssociations = this.#launchConfiguration.fileAssociations;
    this.#mainWindow = new AppWindow(this, this.options);
    this.#windowPermissionPolicies.set(this.#mainWindow, permissionPolicy);
    this.#windows.add(this.#mainWindow);
  }

  get mainWindow() {
    return this.#mainWindow;
  }

  get logPath() {
    return this.#errorLogger.logPath;
  }

  get windows() {
    return [...this.#windows];
  }

  get plugins() {
    return [...this.#plugins.values()].map((record) => record.metadata);
  }

  // Performs a validated outbound request against this app's allowedOrigins.
  // Register it behind a net:fetch command so the frontend cannot choose the
  // destination beyond what the allowlist already permits.
  fetch(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Request options must be an object.");
    }
    return net.request({ ...options, allowedOrigins: this.options.allowedOrigins });
  }

  createWindow(options = {}) {
    const resolvedOptions = resolveWindowOptions(options, {
      ...this.options,
      permissionPolicy: this.#permissions
    });
    const { permissionPolicy, ...publicOptions } = resolvedOptions;
    const window = new AppWindow(this, publicOptions);
    this.#windowPermissionPolicies.set(window, permissionPolicy);
    this.#windows.add(window);
    if (this.#hasRun) window._open(true);
    return window;
  }

  use(plugin, options = {}) {
    if (this.#hasRun) {
      throw new Error("Plugins must be registered before app.run().");
    }
    if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
      throw new TypeError("Plugin must be an object.");
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Plugin options must be an object.");
    }
    if (typeof plugin.name !== "string" || !PLUGIN_NAME_PATTERN.test(plugin.name)) {
      throw new TypeError("Plugin name must be a lowercase dot-or-hyphen separated identifier.");
    }
    if (this.#plugins.has(plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }
    const version = plugin.version ?? "0.0.0";
    if (typeof version !== "string" || version.length === 0) {
      throw new TypeError("Plugin version must be a non-empty string.");
    }
    for (const hook of ["setup", "start", "stop"]) {
      if (plugin[hook] !== undefined && typeof plugin[hook] !== "function") {
        throw new TypeError(`Plugin ${hook} hook must be a function.`);
      }
    }

    if (!Array.isArray(plugin.permissions ?? [])) {
      throw new TypeError("Plugin permissions must be an array.");
    }
    const declaredPermissions = (plugin.permissions ?? []).map(parseCommandPermission);
    const missingPermission = declaredPermissions.find(
      (permission) => !hasPermission(this.#permissions, permission)
    );
    if (missingPermission) {
      throw new Error(`Permission not granted for plugin '${plugin.name}': ${missingPermission}`);
    }

    const pendingCommands = new Map();
    const eventUnsubscribers = [];
    const state = { active: true, setupOpen: true };
    const namespaced = (member) => `${plugin.name}:${member}`;
    let context;
    context = Object.freeze({
      name: plugin.name,
      version,
      appId: this.options.appId,
      permissions: Object.freeze([...declaredPermissions]),
      command: (name, optionsOrHandler, maybeHandler) => {
        if (!state.setupOpen) {
          throw new Error("Plugin commands must be registered during setup.");
        }
        const member = assertPluginMemberName(name, "command name");
        const command = resolveCommandRegistration(optionsOrHandler, maybeHandler);
        const undeclared = command.permissions.find(
          (requirement) => !declaredPermissions.some(
            (permission) => permissionMatches(permission, requirement)
          )
        );
        if (undeclared) {
          throw new Error(`Plugin '${plugin.name}' did not declare permission: ${undeclared}`);
        }
        const fullName = namespaced(member);
        if (pendingCommands.has(fullName)) {
          throw new Error(`Plugin command already registered: ${fullName}`);
        }
        pendingCommands.set(fullName, command);
        return context;
      },
      on: (name, handler) => {
        if (!state.setupOpen) {
          throw new Error("Plugin events must be registered during setup.");
        }
        const off = this.on(namespaced(assertPluginMemberName(name, "event name")), handler);
        eventUnsubscribers.push(off);
        return off;
      },
      once: (name, handler) => {
        if (!state.setupOpen) {
          throw new Error("Plugin events must be registered during setup.");
        }
        const off = this.once(namespaced(assertPluginMemberName(name, "event name")), handler);
        eventUnsubscribers.push(off);
        return off;
      },
      emit: (name, payload) => {
        if (!state.active) {
          throw new Error(`Plugin '${plugin.name}' has been disposed.`);
        }
        this.emit(namespaced(assertPluginMemberName(name, "event name")), payload);
        return context;
      }
    });

    let cleanup;
    try {
      const setupResult = assertSynchronousHookResult(
        plugin.setup?.(context, Object.freeze({ ...options })),
        "setup"
      );
      if (setupResult !== undefined && typeof setupResult !== "function") {
        throw new TypeError("Plugin setup hook must return a cleanup function or undefined.");
      }
      cleanup = setupResult;
      for (const name of pendingCommands.keys()) {
        if (this.#commands.has(name)) {
          throw new Error(`Command already registered: ${name}`);
        }
      }
    } catch (error) {
      for (const off of eventUnsubscribers.reverse()) off();
      try {
        cleanup?.();
      } catch (cleanupError) {
        this._reportError(`Plugin '${plugin.name}' rollback cleanup failed`, cleanupError);
      }
      state.active = false;
      this._reportError(`Plugin '${plugin.name}' setup failed`, error);
      throw error;
    } finally {
      state.setupOpen = false;
    }

    for (const [name, command] of pendingCommands) {
      this.#commands.set(name, command);
    }
    const metadata = Object.freeze({
      name: plugin.name,
      version,
      permissions: Object.freeze([...declaredPermissions])
    });
    this.#plugins.set(plugin.name, {
      cleanup,
      context,
      eventUnsubscribers,
      metadata,
      plugin,
      started: false,
      state
    });
    return this;
  }

  command(name, optionsOrHandler, maybeHandler) {
    if (this.#hasRun) {
      throw new Error("Commands must be registered before app.run().");
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("Command name must be a non-empty string.");
    }
    if (this.#commands.has(name)) {
      throw new Error(`Command already registered: ${name}`);
    }

    const command = resolveCommandRegistration(optionsOrHandler, maybeHandler);
    this.#commands.set(name, command);
    return this;
  }

  on(eventName, handler) {
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new TypeError("Event name must be a non-empty string.");
    }
    if (typeof handler !== "function") {
      throw new TypeError("Event handler must be a function.");
    }

    const handlers = this.#eventHandlers.get(eventName) ?? new Set();
    handlers.add(handler);
    this.#eventHandlers.set(eventName, handlers);
    // Delegating to off() keeps the empty-set cleanup in one place and makes a
    // repeated call harmless.
    return () => {
      this.off(eventName, handler);
    };
  }

  once(eventName, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("Event handler must be a function.");
    }

    const off = this.on(eventName, async (payload) => {
      off();
      await handler(payload);
    });
    return off;
  }

  off(eventName, handler) {
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new TypeError("Event name must be a non-empty string.");
    }
    if (typeof handler !== "function") {
      throw new TypeError("Event handler must be a function.");
    }

    const handlers = this.#eventHandlers.get(eventName);
    if (!handlers) {
      return this;
    }

    handlers.delete(handler);
    if (handlers.size === 0) {
      this.#eventHandlers.delete(eventName);
    }
    return this;
  }

  emit(eventName, payload) {
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new TypeError("Event name must be a non-empty string.");
    }

    // A broadcast addresses whichever windows are live, so closed ones are
    // skipped rather than treated as an error. AppWindow.emit() throws for a
    // closed window because that call names one specific dead target.
    for (const window of this.#windows) {
      if (window.isClosed) continue;
      window.emit(eventName, payload);
    }
    return this;
  }

  run() {
    this.#errorLogger.install();
    if (this.#hasRun) {
      const error = new Error("app.run() may only be called once.");
      this._reportError("Application startup failed", error);
      throw error;
    }
    if (!fs.existsSync(this.options.entry)) {
      const error = new Error(`App entry file was not found: ${this.options.entry}`);
      this._reportError("Application startup failed", error);
      throw error;
    }

    if (this.options.singleInstance) {
      this.#singleInstance = new SingleInstanceCoordinator(this.options.appId);
      const request = this.#singleInstance.request(
        { args: process.argv.slice(2), cwd: process.cwd() },
        (payload) => this.#handleSecondInstance(payload),
        (error) => this._reportHandlerFailure("Single-instance server failed", error)
      );
      if (!request.primary) {
        this.#hasRun = true;
        request.forwarded.catch((error) => {
          this._reportHandlerFailure("Single-instance forwarding failed", error);
          process.exitCode = 1;
        });
        return false;
      }
    }
    this.#markStartup("run");

    try {
      for (const window of this.#windows) window._open(false);
      this.#markStartup("window-created");
      this.#markStartup("entry-loaded");
      this.#startPlugins();
      native().run();
    } catch (error) {
      this._reportError("Application startup failed", error);
      this.#singleInstance?.close();
      this.#singleInstance = undefined;
      try { this.#stopPlugins(); } catch {}
      // Startup has not completed, so close() keeps these windows listed and a
      // retry can reopen them.
      for (const window of [...this.#windows]) {
        try { window.close(); } catch {}
      }
      throw error;
    }

    this.#hasRun = true;
    this.#markStartup("native-run-started");
    const initialArgs = process.argv.slice(2);
    const initialCwd = process.cwd();
    queueMicrotask(() => {
      this.#routeLaunchArguments(initialArgs, initialCwd, true).catch(
        (error) => this._reportHandlerFailure("Initial launch routing failed", error)
      );
    });
    return true;
  }

  quit() {
    let pluginError;
    try { this.#stopPlugins(); } catch (error) { pluginError = error; }
    try { this.#disposePlugins(); } catch (error) { pluginError ??= error; }
    for (const window of [...this.#windows]) window.close();
    native().closeAllWindows();
    this.#singleInstance?.close();
    this.#singleInstance = undefined;
    this.#errorLogger.dispose();
    if (pluginError) throw pluginError;
  }

  show() {
    this.#mainWindow.show();
    return this;
  }

  hide() {
    this.#mainWindow.hide();
    return this;
  }

  setTray(options = {}) {
    this.#mainWindow.setTray(options);
    return this;
  }

  setMenu(template) {
    this.#mainWindow.setMenu(template);
    return this;
  }

  setWindowColors(colors = {}) {
    this.#mainWindow.setWindowColors(colors);
    return this;
  }

  setTaskbarProgress(value, state = "normal") {
    this.#mainWindow.setTaskbarProgress(value, state);
    return this;
  }

  setTaskbarOverlay(icon, description = "") {
    this.#mainWindow.setTaskbarOverlay(icon, description);
    return this;
  }

  requestAttention(type = "informational") {
    this.#mainWindow.requestAttention(type);
    return this;
  }

  showNotification(options) {
    this.#mainWindow.showNotification(options);
    return this;
  }

  #markStartup(label) {
    if (!this.options.startupTiming) {
      return;
    }

    const elapsed = Math.round(performance.now() - this.#startupStartedAt);
    console.log(`[NodeViewJS startup] ${label}: ${elapsed}ms`);
  }

  async #handleSecondInstance(payload) {
    const target = this.#mainWindow.isOpen
      ? this.#mainWindow
      : [...this.#windows].find((window) => window.isOpen);
    target?.restore().show();
    await this.#dispatchAppEvent("second-instance", payload);
    await this.#routeLaunchArguments(payload.args, payload.cwd, false);
  }

  async #routeLaunchArguments(args, cwd, initial) {
    for (const target of findLaunchTargets(args, cwd, this.#launchConfiguration)) {
      const payload = target.type === "open-url"
        ? { url: target.value, initial }
        : { path: target.value, initial };
      await this.#dispatchAppEvent(target.type, payload);
    }
  }

  async #dispatchAppEvent(eventName, payload) {
    await this._dispatchHandlers(
      this.#eventHandlers.get(eventName),
      payload,
      `App event '${eventName}' failed`
    );
  }

  #startPlugins() {
    for (const record of this.#plugins.values()) {
      if (record.started) continue;
      assertSynchronousHookResult(record.plugin.start?.(record.context), "start");
      record.started = true;
    }
  }

  #stopPlugins() {
    let firstError;
    for (const record of [...this.#plugins.values()].reverse()) {
      if (!record.started) continue;
      record.started = false;
      try {
        assertSynchronousHookResult(record.plugin.stop?.(record.context), "stop");
      } catch (error) {
        this._reportError(`Plugin '${record.metadata.name}' stop failed`, error);
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  #disposePlugins() {
    if (this.#pluginsDisposed) return;
    this.#pluginsDisposed = true;
    let firstError;
    for (const record of [...this.#plugins.values()].reverse()) {
      record.state.active = false;
      for (const off of record.eventUnsubscribers.reverse()) off();
      try {
        assertSynchronousHookResult(record.cleanup?.(), "cleanup");
      } catch (error) {
        this._reportError(`Plugin '${record.metadata.name}' cleanup failed`, error);
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  async _handleWindowMessage(window, serializedMessage) {
    const message = ipc.parseMessage(serializedMessage);
    if (!message) {
      return;
    }

    if (message.type !== "event"
        || (message.event !== "nodeview:loading" && message.event !== "nodeview:ready")) {
      window._markBridgeReady();
    }

    if (message.type === "invoke") {
      await this.#invoke(window, message);
      return;
    }

    if (message.type === "event" && typeof message.event === "string") {
      if (message.event === "nodeview:loading") {
        window._resetBridgeReady();
        return;
      }
      if (message.event === "nodeview:ready") {
        window._markBridgeReady();
        return;
      }
      await window._dispatch(message.event, message.payload);
      await this._dispatchHandlers(
        this.#eventHandlers.get(message.event),
        message.payload,
        `App event '${message.event}' failed`
      );
    }
  }

  _reportError(context, error) {
    this.#errorLogger.report(context, error);
  }

  // Internal: lets the event-cleanup tests prove that unsubscribing removes the
  // event name instead of leaving an empty handler set behind.
  _eventNames() {
    return [...this.#eventHandlers.keys()];
  }

  // The single dispatch path for application, window, and menu events. A
  // failing handler is reported and isolated: it never terminates the process
  // and never stops the remaining handlers, because the caller is usually a
  // native callback with nowhere to propagate to.
  async _dispatchHandlers(handlers, payload, context) {
    for (const handler of [...handlers ?? []]) {
      try {
        await handler(payload);
      } catch (error) {
        this._reportHandlerFailure(context, error);
      }
    }
  }

  // Reporting runs on callback boundaries where a throw would become an
  // unhandled rejection, so a failing logger or console must not escape.
  _reportHandlerFailure(context, error) {
    try {
      this._reportError(context, error);
    } catch {}
    try {
      console.error(`[NodeViewJS] ${context}: ${error?.stack ?? safeDiagnosticString(error)}`);
    } catch {}
  }

  // Closing a window while the app is running disposes it: it is not
  // reopenable, so keeping it in the active collection would retain every
  // transient window for the life of the process. Before run() the window
  // stays listed, because a failed startup is expected to retry it.
  _retireWindow(window) {
    if (!this.#hasRun) return;
    window._dispose();
    this.#windows.delete(window);
  }

  async _handleMenuCommand(window, event) {
    if (!event || typeof event !== "object" || typeof event.id !== "string") return;
    const payload = event.checked === undefined
      ? { id: event.id, window }
      : { id: event.id, checked: Boolean(event.checked), window };
    const eventName = event.source === "tray" ? "tray-menu" : "menu";
    await window._dispatch(eventName, payload);
    await this.#dispatchAppEvent(eventName, payload);
  }

  async #invoke(window, message) {
    let state = this.#ipcRequestStates.get(window);
    if (!state) {
      state = { active: new Set(), completed: new Set(), completedOrder: [] };
      this.#ipcRequestStates.set(window, state);
    }

    if (state.active.has(message.id) || state.completed.has(message.id)) {
      window._post(ipc.serialize(ipc.createResponseMessage(
        message.id,
        false,
        `Duplicate or replayed IPC request id: ${message.id}`
      )));
      return;
    }
    if (state.active.size >= ipc.IPC_MAX_CONCURRENT_REQUESTS) {
      window._post(ipc.serialize(ipc.createResponseMessage(
        message.id,
        false,
        "Too many concurrent IPC requests."
      )));
      return;
    }

    state.active.add(message.id);
    const command = this.#commands.get(message.command);
    try {
      if (!command) {
        throw new Error(`Unknown command: ${message.command}`);
      }

      const missingPermission = command.permissions.find(
        (permission) => !hasPermission(this.#permissions, permission)
          || !hasPermission(
            this.#windowPermissionPolicies.get(window) ?? this.#permissions,
            permission
          )
      );
      if (missingPermission) {
        throw new Error(`Permission not granted for command '${message.command}': ${missingPermission}`);
      }

      let timeout;
      const timeoutPromise = new Promise((resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`IPC command timed out after ${ipc.IPC_REQUEST_TIMEOUT_MS}ms.`)),
          ipc.IPC_REQUEST_TIMEOUT_MS
        );
        timeout.unref?.();
      });
      let result;
      try {
        try {
          result = await Promise.race([command.handler(message.payload), timeoutPromise]);
        } catch (error) {
          this._reportError(`IPC command '${message.command}' failed`, error);
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }
      window._post(ipc.serialize(ipc.createResponseMessage(message.id, true, result)));
    } catch (error) {
      const detail = createErrorDetail(error);
      window._post(ipc.serialize(ipc.createResponseMessage(
        message.id,
        false,
        detail
      )));
    } finally {
      state.active.delete(message.id);
      state.completed.add(message.id);
      state.completedOrder.push(message.id);
      if (state.completedOrder.length > ipc.IPC_MAX_COMPLETED_REQUEST_IDS) {
        state.completed.delete(state.completedOrder.shift());
      }
    }
  }
}

module.exports = {
  App,
  AppWindow,
  COMMAND_PERMISSIONS,
  PERMISSION_GROUPS
};
