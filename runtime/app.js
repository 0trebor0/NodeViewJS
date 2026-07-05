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
const { createErrorLogger } = require("./error-logger");
const ipc = require("./ipc");
const { findLaunchTargets, resolveLaunchConfiguration } = require("./launch-routing");
const { normalizeContextPosition, normalizeMenuTemplate } = require("./menu");
const { normalizeNotificationOptions } = require("./notification");
const { SingleInstanceCoordinator } = require("./single-instance");
const { normalizeAttentionType, normalizeOverlay, normalizeProgress } = require("./taskbar");

const COMMAND_PERMISSIONS = new Set([
  "fs:read",
  "fs:write",
  "dialog:open",
  "dialog:save",
  "clipboard:read",
  "clipboard:write",
  "shell:open",
  "notification:show",
  "window:control"
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

function parsePermission(value, { allowGroups, allowScopeWildcard, label }) {
  if (typeof value !== "string") {
    throw new TypeError(`Unsupported ${label} permission: ${String(value)}`);
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

  throw new TypeError(`Unsupported ${label} permission: ${value}`);
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
        throw new TypeError(`Unsupported command permission scope: ${String(scope)}`);
      }
      requirements = [`${parsed}:${scope}`];
    } else {
      requirements = [parsed];
    }
  } else if (permissions !== undefined) {
    requirements = permissions.map(parseCommandPermission);
  }

  return { handler: maybeHandler, permissions: requirements };
}

function resolvePermissions(options) {
  const permissions = options.permissions ?? [];
  let allow;
  let deny;

  if (Array.isArray(permissions)) {
    allow = permissions;
    deny = [];
  } else if (permissions && typeof permissions === "object") {
    const unknownKeys = Object.keys(permissions).filter(
      (key) => key !== "allow" && key !== "deny"
    );
    if (unknownKeys.length > 0) {
      throw new TypeError(`Unsupported app permission policy option: ${unknownKeys[0]}`);
    }
    allow = permissions.allow ?? [];
    deny = permissions.deny ?? [];
    if (!Array.isArray(allow) || !Array.isArray(deny)) {
      throw new TypeError("App permission policy allow and deny values must be arrays.");
    }
  } else {
    throw new TypeError("App permissions must be an array or policy object.");
  }

  return {
    allow: new Set(allow.map(parseAppPermission)),
    deny: new Set(deny.map(parseAppPermission))
  };
}

function resolveTrayOptions(options, fallbackTitle, fallbackIcon) {
  if (options === undefined || options === false) {
    return undefined;
  }
  if (options === true) {
    return {
      title: fallbackTitle,
      icon: fallbackIcon && path.resolve(fallbackIcon)
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

  return {
    title,
    icon: icon && path.resolve(icon)
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
  const frameOnHover = options.frameOnHover ?? fallback.frameOnHover ?? false;
  if (typeof frameOnHover !== "boolean") {
    throw new TypeError(`${owner} frameOnHover must be a boolean.`);
  }
  const frame = frameOnHover ? false : options.frame ?? fallback.frame ?? true;
  const singleInstance = options.singleInstance ?? fallback.singleInstance ?? false;
  if (typeof singleInstance !== "boolean") {
    throw new TypeError(`${owner} singleInstance must be a boolean.`);
  }
  const menu = options.menu === undefined
    ? fallback.menu ?? null
    : normalizeMenuTemplate(options.menu, { allowNull: true });

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
    frameOnHover,
    closable: options.closable ?? fallback.closable ?? true,
    minimizable: options.minimizable ?? fallback.minimizable ?? true,
    maximizable: options.maximizable ?? fallback.maximizable ?? true,
    maximized: options.maximized ?? fallback.maximized ?? false,
    center: options.center ?? fallback.center ?? false,
    alwaysOnTop: options.alwaysOnTop ?? fallback.alwaysOnTop ?? false,
    closeToHide: options.closeToHide ?? fallback.closeToHide ?? false,
    transparent: options.transparent ?? fallback.transparent ?? false,
    devtools: options.devtools ?? fallback.devtools ?? false,
    startupTiming: options.startupTiming ?? fallback.startupTiming ?? process.env.NODEVIEW_STARTUP_TIMING === "1",
    singleInstance,
    menu,
    icon: icon && path.resolve(icon),
    entry: path.resolve(entry),
    webViewDataDirectory: resolveWebViewDataDirectory(appId),
    tray: resolveTrayOptions(options.tray, title, icon)
  };
}

class AppWindow {
  #app;
  #devWatcher;
  #eventHandlers = new Map();
  #id;

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
    return () => handlers.delete(handler);
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
    this._post(ipc.serialize(ipc.createEventMessage(eventName, payload)));
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
    return this;
  }

  reload() {
    if (this.#id !== undefined) native().reload(this.#id);
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

  showNotification(options) {
    const notification = normalizeNotificationOptions(options);
    if (this.#id === undefined) throw new Error("Window has not been opened.");
    native().showNotification(this.#id, notification);
    return this;
  }

  setTray(options = {}) {
    const tray = resolveTrayOptions(options, this.options.title, this.options.icon);
    if (!tray) throw new TypeError("Tray options must be an object or true.");
    this.options.tray = tray;
    if (this.#id !== undefined) native().setTray(this.#id, tray);
    return this;
  }

  _open(showImmediately) {
    if (this.#id !== undefined) return this;
    if (!fs.existsSync(this.options.entry)) {
      throw new Error(`Window entry file was not found: ${this.options.entry}`);
    }

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
      frameOnHover: this.options.frameOnHover,
      closable: this.options.closable,
      minimizable: this.options.minimizable,
      maximizable: this.options.maximizable,
      maximized: this.options.maximized,
      center: this.options.center,
      alwaysOnTop: this.options.alwaysOnTop,
      closeToHide: this.options.closeToHide,
      transparent: this.options.transparent,
      devtools: this.options.devtools,
      bridgeEmbedded: process.env.NODEVIEW_BRIDGE_EMBEDDED === "1",
      icon: this.options.icon,
      dataDirectory: this.options.webViewDataDirectory
    });
    this.#id = id;

    try {
      if (this.options.tray) native().setTray(id, this.options.tray);
      native().setMessageHandler(id, (message) => this.#app._handleWindowMessage(this, message));
      if (typeof native().setMenuHandler === "function") {
        native().setMenuHandler(id, (event) => {
          this.#app._handleMenuCommand(this, event).catch((error) => {
            this.#app._reportError("Menu handler failed", error);
            console.error(`[NodeViewJS menu] ${error.stack ?? error}`);
          });
        });
        if (this.options.menu) native().setApplicationMenu(id, this.options.menu);
      }
      native().loadFile(id, this.options.entry);
      if (process.env.NODEVIEW_DEV_WATCH === "1") {
        this.#devWatcher = startDevWatcher(this.options.entry, () => native().reload(id));
      }
      if (showImmediately) native().showWindow(id);
    } catch (error) {
      this.close();
      throw error;
    }
    return this;
  }

  async _dispatch(eventName, payload) {
    for (const handler of [...this.#eventHandlers.get(eventName) ?? []]) {
      try {
        await handler(payload);
      } catch (error) {
        this.#app._reportError(`Window event '${eventName}' failed`, error);
        throw error;
      }
    }
  }

  _post(serializedMessage) {
    if (this.#id === undefined) {
      throw new Error("Window has not been opened.");
    }
    native().postMessage(this.#id, serializedMessage);
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
  #windows = new Set();

  constructor(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("App options must be an object.");
    }
    this.options = resolveWindowOptions(options, {}, "App");
    this.#errorLogger = createErrorLogger(this.options.appId);
    this.#launchConfiguration = resolveLaunchConfiguration(options);
    this.options.protocols = this.#launchConfiguration.protocols;
    this.options.fileAssociations = this.#launchConfiguration.fileAssociations;
    this.#mainWindow = new AppWindow(this, this.options);
    this.#windows.add(this.#mainWindow);
    this.#permissions = resolvePermissions(options);
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

  createWindow(options = {}) {
    const window = new AppWindow(this, resolveWindowOptions(options, this.options));
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
    return () => handlers.delete(handler);
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

    for (const window of this.#windows) {
      if (window.isOpen) window.emit(eventName, payload);
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
        (error) => {
          this._reportError("Single-instance server failed", error);
          console.error(`[NodeViewJS single instance] ${error.stack ?? error}`);
        }
      );
      if (!request.primary) {
        this.#hasRun = true;
        request.forwarded.catch((error) => {
          this._reportError("Single-instance forwarding failed", error);
          console.error(`[NodeViewJS single instance] ${error.stack ?? error}`);
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
      for (const window of this.#windows) {
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
        (error) => {
          this._reportError("Initial launch routing failed", error);
          console.error(`[NodeViewJS launch routing] ${error.stack ?? error}`);
        }
      );
    });
    return true;
  }

  quit() {
    let pluginError;
    try { this.#stopPlugins(); } catch (error) { pluginError = error; }
    try { this.#disposePlugins(); } catch (error) { pluginError ??= error; }
    for (const window of this.#windows) window.close();
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
    const tray = resolveTrayOptions(options, this.options.title, this.options.icon);
    if (!tray) {
      throw new TypeError("Tray options must be an object or true.");
    }

    this.#mainWindow.setTray(tray);
    return this;
  }

  setMenu(template) {
    this.#mainWindow.setMenu(template);
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
    for (const handler of [...this.#eventHandlers.get(eventName) ?? []]) {
      try {
        await handler(payload);
      } catch (error) {
        this._reportError(`App event '${eventName}' failed`, error);
        throw error;
      }
    }
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

    if (message.type === "invoke") {
      await this.#invoke(window, message);
      return;
    }

    if (message.type === "event" && typeof message.event === "string") {
      await window._dispatch(message.event, message.payload);
      for (const handler of [...this.#eventHandlers.get(message.event) ?? []]) {
        await handler(message.payload);
      }
    }
  }

  _reportError(context, error) {
    this.#errorLogger.report(context, error);
  }

  async _handleMenuCommand(window, event) {
    if (!event || typeof event !== "object" || typeof event.id !== "string") return;
    const payload = event.checked === undefined
      ? { id: event.id, window }
      : { id: event.id, checked: Boolean(event.checked), window };
    await window._dispatch("menu", payload);
    await this.#dispatchAppEvent("menu", payload);
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
      const detail = (error instanceof Error ? error.message : String(error)).slice(0, 1_024);
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
