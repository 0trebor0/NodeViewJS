"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const runtime = require("../runtime");
const { clipboard, config, dialog, notification, shell, Updater } = runtime;
const {
  App,
  AppWindow,
  COMMAND_PERMISSIONS,
  PERMISSION_GROUPS
} = require("../runtime/app");
const {
  resolveAppId,
  resolveAppUserModelId,
  resolveLogPath,
  resolveUpdateDirectory,
  resolveWebViewDataDirectory
} = require("../runtime/data-directory");
const { isFrontendFile, startDevWatcher } = require("../runtime/dev-watcher");
const {
  findLaunchTargets,
  normalizeFileAssociations,
  normalizeProtocols,
  resolveLaunchConfiguration
} = require("../runtime/launch-routing");

assert.deepEqual(Object.keys(runtime).sort(), [
  "App",
  "AppWindow",
  "Updater",
  "clipboard",
  "config",
  "dialog",
  "ipc",
  "notification",
  "shell"
]);

const app = new App({ entry: __filename });
const previousDevTools = process.env.NODEVIEW_DEVTOOLS;
const previousStartupTiming = process.env.NODEVIEW_STARTUP_TIMING;
const previousBridgeEmbedded = process.env.NODEVIEW_BRIDGE_EMBEDDED;
process.env.NODEVIEW_DEVTOOLS = "1";
const devToolsEnvironmentApp = new App({ entry: __filename });
const explicitlyDisabledDevToolsApp = new App({ entry: __filename, devtools: false });
process.env.NODEVIEW_STARTUP_TIMING = "1";
process.env.NODEVIEW_BRIDGE_EMBEDDED = "1";
const packagedEnvironmentApp = new App({ entry: __filename });
const explicitPackagedDevelopmentApp = new App({
  entry: __filename,
  devtools: true,
  startupTiming: true
});
if (previousDevTools === undefined) delete process.env.NODEVIEW_DEVTOOLS;
else process.env.NODEVIEW_DEVTOOLS = previousDevTools;
if (previousStartupTiming === undefined) delete process.env.NODEVIEW_STARTUP_TIMING;
else process.env.NODEVIEW_STARTUP_TIMING = previousStartupTiming;
if (previousBridgeEmbedded === undefined) delete process.env.NODEVIEW_BRIDGE_EMBEDDED;
else process.env.NODEVIEW_BRIDGE_EMBEDDED = previousBridgeEmbedded;
const permittedApp = new App({ entry: __filename, permissions: ["fs:read"] });
const ipcErrorApp = new App({ entry: __filename });
let permissionReads = 0;
const accessorOptions = { entry: __filename };
Object.defineProperty(accessorOptions, "permissions", {
  get() {
    permissionReads += 1;
    return ["fs:read"];
  }
});
new App(accessorOptions);
assert.equal(permissionReads, 1);
const windowOptionsApp = new App({
  entry: __filename,
  center: true,
  maximized: true,
  alwaysOnTop: true,
  closeToHide: true,
  transparent: true,
  windowColors: {
    titleBar: "#112233",
    titleText: "#ffffff",
    border: "#445566"
  },
  frame: false,
  closable: false,
  minimizable: false,
  maximizable: false,
  protocols: [{ scheme: "nodeview-demo", name: "NodeView Demo URL" }],
  fileAssociations: [{ extension: ".nview", name: "NodeView document" }],
  menu: [{ id: "app.refresh", label: "Refresh", accelerator: "Ctrl+R" }],
  tray: true,
  startupTiming: true
});
const trayApp = new App({ entry: __filename });
const policyApp = new App({
  entry: __filename,
  permissions: {
    allow: ["fs:*", "dialog:open:settings"],
    deny: ["fs:write"]
  }
});
const secondaryWindow = app.createWindow({ title: "Secondary" });
const readinessApp = new App({ entry: __filename });
const readinessMessages = [];
readinessApp.mainWindow._post = (message) => readinessMessages.push(JSON.parse(message));
readinessApp.emit("queued-before-ready", { value: 1 });
assert.deepEqual(readinessMessages, []);
readinessApp.mainWindow._markBridgeReady();
assert.deepEqual(readinessMessages, [{
  version: 1,
  type: "event",
  event: "queued-before-ready",
  payload: { value: 1 }
}]);
readinessApp.mainWindow._resetBridgeReady();
readinessApp.emit("queued-after-reload", { value: 2 });
assert.equal(readinessMessages.length, 1);
readinessApp.mainWindow._markBridgeReady();
assert.equal(readinessMessages[1].event, "queued-after-reload");

const countBufferApp = new App({ entry: __filename });
const countBufferMessages = [];
countBufferApp.mainWindow._post = (message) => countBufferMessages.push(JSON.parse(message));
for (let index = 0; index < 1024; index++) {
  countBufferApp.emit("buffered-by-count", { index });
}
assert.throws(
  () => countBufferApp.emit("buffered-by-count", { index: 1024 }),
  /readiness buffer limit/
);
countBufferApp.mainWindow._markBridgeReady();
assert.equal(countBufferMessages.length, 1024);
assert.equal(countBufferMessages[0].payload.index, 0);
assert.equal(countBufferMessages.at(-1).payload.index, 1023);

const byteBufferApp = new App({ entry: __filename });
byteBufferApp.mainWindow._post = () => {};
for (let index = 0; index < 5; index++) {
  byteBufferApp.emit("buffered-by-size", "x".repeat(200_000));
}
assert.throws(
  () => byteBufferApp.emit("buffered-by-size", "x".repeat(200_000)),
  /readiness buffer limit/
);

assert.equal(devToolsEnvironmentApp.options.devtools, true);
assert.equal(explicitlyDisabledDevToolsApp.options.devtools, false);
assert.equal(packagedEnvironmentApp.options.devtools, false);
assert.equal(packagedEnvironmentApp.options.startupTiming, false);
assert.equal(explicitPackagedDevelopmentApp.options.devtools, true);
assert.equal(explicitPackagedDevelopmentApp.options.startupTiming, true);
assert.equal(app.command("plain", () => "ok"), app);
const hostileCommandError = {
  toString() {
    throw new Error("toString should not escape IPC command error handling");
  }
};
assert.equal(ipcErrorApp.command("hostileError", () => {
  throw hostileCommandError;
}), ipcErrorApp);
assert.equal(app.command("readConfig", { permission: "fs:read" }, () => "ok"), app);
assert.equal(permittedApp.command("readConfig", { permission: "fs:read" }, () => "ok"), permittedApp);
assert.equal(
  policyApp.command("scopedDialog", { permission: "dialog:open", scope: "settings" }, () => "ok"),
  policyApp
);
assert.equal(
  policyApp.command(
    "multiPermission",
    { permissions: ["fs:read:config", "dialog:open:settings"] },
    () => "ok"
  ),
  policyApp
);
assert.ok(COMMAND_PERMISSIONS.has("fs:read"));
assert.ok(COMMAND_PERMISSIONS.has("notification:show"));
assert.ok(COMMAND_PERMISSIONS.has("clipboard:read"));
assert.ok(COMMAND_PERMISSIONS.has("clipboard:write"));
assert.ok(PERMISSION_GROUPS.has("fs:*"));
assert.ok(PERMISSION_GROUPS.has("dialog:*"));
assert.ok(PERMISSION_GROUPS.has("clipboard:*"));
assert.equal(resolveAppId("  My App  "), "My App");
assert.throws(() => resolveAppId("My\nApp"), /must not contain control characters/);
assert.match(resolveAppUserModelId("My App"), /^NodeViewJS\.My\.App\.[0-9a-f]{16}$/);
assert.equal(resolveAppUserModelId("My App"), resolveAppUserModelId("My App"));
assert.notEqual(resolveAppUserModelId("My App"), resolveAppUserModelId("My-App"));
assert.equal(typeof clipboard.readText, "function");
assert.equal(typeof clipboard.writeText, "function");
assert.equal(typeof dialog.message, "function");
assert.equal(typeof dialog.openFile, "function");
assert.equal(typeof dialog.saveFile, "function");
assert.equal(typeof notification.show, "function");
assert.equal(typeof shell.openExternal, "function");
assert.equal(typeof shell.openPath, "function");
assert.equal(typeof Updater, "function");
assert.throws(() => clipboard.writeText(), /must be a string/);
assert.throws(() => clipboard.writeText("invalid\0text"), /must not contain null/);

assert.throws(() => shell.openExternal(), /non-empty string/);
assert.throws(() => shell.openExternal("not a URL"), /valid absolute URL/);
assert.throws(() => shell.openExternal("file:///tmp/example"), /Unsupported external URL protocol/);
assert.throws(
  () => shell.openExternal("https://user:password@example.com"),
  /must not contain credentials/
);
assert.throws(
  () => shell.openExternal(" https://example.com"),
  /must not contain leading, trailing, or control whitespace/
);
assert.throws(
  () => shell.openExternal("https://example.com/\nnext"),
  /must not contain leading, trailing, or control whitespace/
);
assert.throws(
  () => shell.openPath(path.join(os.tmpdir(), "nodeviewjs-missing-shell-path")),
  /does not exist/
);
assert.throws(
  () => shell.openPath(`${__filename}\0hidden`),
  /must not contain control characters/
);

if (process.platform === "win32") {
  const nativeModule = require.resolve("../runtime/native");
  const previousNativeModule = require.cache[nativeModule];
  const calls = [];
  require.cache[nativeModule] = {
    id: nativeModule,
    filename: nativeModule,
    loaded: true,
    exports: {
      readClipboardText() {
        calls.push(["clipboard-read"]);
        return "copied text";
      },
      writeClipboardText(value) {
        calls.push(["clipboard-write", value]);
        return true;
      },
      openExternal(value) {
        calls.push(["external", value]);
        return true;
      },
      openPath(value) {
        calls.push(["path", value]);
        return true;
      }
    }
  };
  assert.equal(clipboard.readText(), "copied text");
  assert.equal(clipboard.writeText("new text"), true);
  assert.equal(shell.openExternal("HTTPS://Example.com/docs"), true);
  assert.equal(shell.openPath(__filename), true);
  assert.deepEqual(calls, [
    ["clipboard-read"],
    ["clipboard-write", "new text"],
    ["external", "https://example.com/docs"],
    ["path", path.resolve(__filename)]
  ]);
  if (previousNativeModule) require.cache[nativeModule] = previousNativeModule;
  else delete require.cache[nativeModule];
} else {
  assert.throws(
    () => clipboard.readText(),
    /currently available only on Windows/
  );
  assert.throws(
    () => clipboard.writeText("text"),
    /currently available only on Windows/
  );
  assert.throws(
    () => shell.openExternal("https://example.com"),
    /currently available only on Windows/
  );
}
assert.ok(app.mainWindow instanceof AppWindow);
assert.match(app.logPath, /backend\.log$/);
assert.ok(secondaryWindow instanceof AppWindow);
assert.deepEqual(app.windows, [app.mainWindow, secondaryWindow]);
assert.equal(secondaryWindow.options.title, "Secondary");
assert.equal(secondaryWindow.options.entry, app.options.entry);
assert.equal(secondaryWindow.options.appId, app.options.appId);
assert.equal(secondaryWindow.isOpen, false);
assert.equal(secondaryWindow.show(), secondaryWindow);
assert.equal(secondaryWindow.hide(), secondaryWindow);
assert.equal(secondaryWindow.reload(), secondaryWindow);
assert.equal(secondaryWindow.minimize(), secondaryWindow);
assert.equal(secondaryWindow.maximize(), secondaryWindow);
assert.equal(secondaryWindow.restore(), secondaryWindow);
assert.equal(secondaryWindow.setFullscreen(), secondaryWindow);
assert.equal(secondaryWindow.setTitle("Renamed Secondary"), secondaryWindow);
assert.equal(secondaryWindow.options.title, "Renamed Secondary");
assert.equal(secondaryWindow.setWindowColors({ titleBar: "#123456" }), secondaryWindow);
assert.equal(secondaryWindow.options.windowColors.titleBar, 0x123456);
assert.equal(secondaryWindow.setSize(640, 360), secondaryWindow);
assert.equal(secondaryWindow.options.width, 640);
assert.equal(secondaryWindow.options.height, 360);
assert.equal(secondaryWindow.setPosition(-20, 30), secondaryWindow);
assert.equal(secondaryWindow.startDrag(), secondaryWindow);
assert.equal(
  secondaryWindow.setMenu([{ id: "secondary.close", label: "Close" }]),
  secondaryWindow
);
assert.equal(secondaryWindow.options.menu[0].id, "secondary.close");
assert.equal(secondaryWindow.setMenu(null), secondaryWindow);
assert.equal(secondaryWindow.options.menu, null);
assert.deepEqual(secondaryWindow.getState(), { isOpen: false });
assert.throws(() => secondaryWindow.setFullscreen("yes"), /must be a boolean/);
assert.throws(() => secondaryWindow.setTitle(" "), /non-empty string/);
assert.throws(() => secondaryWindow.setSize(0, 360), /between 1 and 32767/);
assert.throws(() => secondaryWindow.setPosition(40000, 0), /between -32768 and 32767/);
assert.throws(
  () => secondaryWindow.showContextMenu([{ id: "context.copy", label: "Copy" }]),
  /has not been opened/
);
assert.equal(secondaryWindow.emit("before-open"), secondaryWindow);
assert.equal(windowOptionsApp.options.center, true);
assert.equal(windowOptionsApp.options.maximized, true);
assert.equal(windowOptionsApp.options.alwaysOnTop, true);
assert.equal(windowOptionsApp.options.closeToHide, true);
assert.equal(windowOptionsApp.options.transparent, true);
assert.deepEqual(windowOptionsApp.options.windowColors, {
  titleBar: 0x112233,
  titleText: 0xffffff,
  border: 0x445566
});
assert.equal(windowOptionsApp.options.frame, false);
assert.equal(Object.hasOwn(windowOptionsApp.options, "frameOnHover"), false);
assert.equal(windowOptionsApp.options.closable, false);
assert.equal(windowOptionsApp.options.minimizable, false);
assert.equal(windowOptionsApp.options.maximizable, false);
assert.throws(
  () => new App({ entry: __filename, frameOnHover: true }),
  /not currently supported/
);
assert.throws(
  () => new App({ entry: __filename, windowColors: { titleBar: "blue" } }),
  /#RRGGBB/
);
assert.equal(windowOptionsApp.options.tray.title, "NodeViewJS");
assert.equal(windowOptionsApp.options.startupTiming, true);
assert.equal(windowOptionsApp.options.appId, "NodeViewJS");
assert.equal(windowOptionsApp.options.singleInstance, false);
assert.deepEqual(windowOptionsApp.options.protocols, [
  { scheme: "nodeview-demo", name: "NodeView Demo URL" }
]);
assert.deepEqual(windowOptionsApp.options.fileAssociations, [
  { extension: ".nview", name: "NodeView document" }
]);
assert.equal(windowOptionsApp.options.menu[0].id, "app.refresh");
assert.equal(new App({ entry: __filename, singleInstance: true }).options.singleInstance, true);
assert.throws(
  () => new App({ entry: __filename, singleInstance: "yes" }),
  /singleInstance must be a boolean/
);
assert.deepEqual(normalizeProtocols(["MY-APP"]), [{ scheme: "my-app", name: "my-app URL" }]);
assert.deepEqual(normalizeFileAssociations([".NOTE"]), [{ extension: ".note", name: "NOTE file" }]);
assert.throws(() => normalizeProtocols(["https"]), /Unsupported custom protocol/);
assert.throws(() => normalizeProtocols(["bad scheme"]), /Unsupported custom protocol/);
assert.throws(() => normalizeProtocols(["my-app", "MY-APP"]), /Duplicate custom protocol/);
assert.throws(() => normalizeProtocols([{ scheme: "my-app", title: "Wrong" }]), /Unsupported protocol option/);
assert.throws(
  () => normalizeProtocols([{ scheme: "my-app", name: "My\nApp URL" }]),
  /name must be between 1 and 100 characters/
);
assert.throws(
  () => normalizeProtocols([new Proxy({}, {
    ownKeys() {
      throw new Error("protocol options inspection should not escape validation");
    }
  })]),
  /App protocol options object could not be inspected/
);
assert.throws(
  () => normalizeProtocols([{ scheme: {
    toString() {
      throw new Error("protocol diagnostic conversion should not escape validation");
    }
  } }]),
  /Unsupported custom protocol scheme: <unprintable>/
);
assert.throws(() => normalizeFileAssociations(["txt"]), /Unsupported file association/);
assert.throws(() => normalizeFileAssociations([".txt", ".TXT"]), /Duplicate file association/);
assert.throws(
  () => normalizeFileAssociations([{ extension: ".txt", name: "Text\rFile" }]),
  /name must be between 1 and 100 characters/
);
assert.throws(
  () => normalizeFileAssociations([new Proxy({}, {
    ownKeys() {
      throw new Error("file association options inspection should not escape validation");
    }
  })]),
  /File association options object could not be inspected/
);
assert.throws(
  () => normalizeFileAssociations([{ extension: {
    toString() {
      throw new Error("file association diagnostic conversion should not escape validation");
    }
  } }]),
  /Unsupported file association extension: <unprintable>/
);
assert.deepEqual(
  resolveLaunchConfiguration({}, {
    NODEVIEW_PROTOCOLS: '[{"scheme":"env-app","name":"Environment URL"}]',
    NODEVIEW_FILE_ASSOCIATIONS: '[{"extension":".envdoc","name":"Environment file"}]'
  }),
  {
    protocols: [{ scheme: "env-app", name: "Environment URL" }],
    fileAssociations: [{ extension: ".envdoc", name: "Environment file" }]
  }
);
assert.deepEqual(
  findLaunchTargets(
    ["--ignored.note", "MY-APP://open/item", "relative.note", "other.txt"],
    path.join(os.tmpdir(), "launch-root"),
    {
      protocols: [{ scheme: "my-app" }],
      fileAssociations: [{ extension: ".note" }]
    }
  ),
  [
    { type: "open-url", value: "my-app://open/item" },
    {
      type: "open-file",
      value: path.resolve(os.tmpdir(), "launch-root", "relative.note")
    }
  ]
);
assert.throws(
  () => findLaunchTargets([" my-app://open/item"], path.join(os.tmpdir(), "launch-root"), {
    protocols: [{ scheme: "my-app" }],
    fileAssociations: []
  }),
  /Launch arguments must not contain leading, trailing, or control whitespace/
);
assert.throws(
  () => findLaunchTargets(["relative.note"], `${path.join(os.tmpdir(), "launch-root")}\0hidden`, {
    protocols: [],
    fileAssociations: [{ extension: ".note" }]
  }),
  /Launch working directory must not contain control characters/
);
const currentWebViewDirectory = process.platform === "darwin"
  ? "WebKit"
  : process.platform === "linux" ? "WebKitGTK" : "WebView2";
assert.match(
  windowOptionsApp.options.webViewDataDirectory,
  new RegExp(`NodeViewJS[\\\\/]NodeViewJS-[0-9a-f]{16}[\\\\/]${currentWebViewDirectory}$`)
);

const windowsDataRoot = path.join(os.tmpdir(), "nodeview-local-app-data");
const windowsDataEnvironment = { LOCALAPPDATA: windowsDataRoot, NODEVIEW_PLATFORM: "win32" };
const dataDirectory = resolveWebViewDataDirectory("My App", windowsDataEnvironment);
assert.match(dataDirectory, /nodeview-local-app-data[\\/]NodeViewJS[\\/]My-App-[0-9a-f]{16}[\\/]WebView2$/);
assert.equal(dataDirectory, resolveWebViewDataDirectory("My App", windowsDataEnvironment));
assert.equal(dataDirectory, resolveWebViewDataDirectory("  My App  ", windowsDataEnvironment));
assert.notEqual(dataDirectory, resolveWebViewDataDirectory("Other App", windowsDataEnvironment));
assert.match(
  resolveUpdateDirectory("My App", windowsDataEnvironment),
  /nodeview-local-app-data[\\/]NodeViewJS[\\/]Updates[\\/]My-App-[0-9a-f]{16}$/
);
assert.match(
  resolveLogPath("My App", windowsDataEnvironment),
  /nodeview-local-app-data[\\/]NodeViewJS[\\/]Logs[\\/]My-App-[0-9a-f]{16}[\\/]backend\.log$/
);
assert.match(
  resolveWebViewDataDirectory("My App", { HOME: "C:\\Users\\Test", NODEVIEW_PLATFORM: "darwin" }),
  /Library[\\/]Application Support[\\/]NodeViewJS[\\/]My-App-[0-9a-f]{16}[\\/]WebKit$/
);
assert.match(
  resolveLogPath("My App", { HOME: "C:\\Users\\Test", NODEVIEW_PLATFORM: "darwin" }),
  /Library[\\/]Logs[\\/]NodeViewJS[\\/]My-App-[0-9a-f]{16}[\\/]backend\.log$/
);
const linuxDataEnvironment = {
  HOME: path.join(os.tmpdir(), "nodeview-home"),
  NODEVIEW_PLATFORM: "linux"
};
assert.match(
  resolveWebViewDataDirectory("My App", linuxDataEnvironment),
  /nodeview-home[\\/]\.local[\\/]share[\\/]NodeViewJS[\\/]My-App-[0-9a-f]{16}[\\/]WebKitGTK$/
);
assert.match(
  resolveUpdateDirectory("My App", linuxDataEnvironment),
  /nodeview-home[\\/]\.local[\\/]share[\\/]NodeViewJS[\\/]Updates[\\/]My-App-[0-9a-f]{16}$/
);
assert.match(
  resolveLogPath("My App", linuxDataEnvironment),
  /nodeview-home[\\/]\.local[\\/]state[\\/]nodeviewjs[\\/]My-App-[0-9a-f]{16}[\\/]backend\.log$/
);
const linuxXdgDirectory = path.join(os.tmpdir(), "nodeview-xdg-data");
assert.match(
  resolveWebViewDataDirectory("My App", {
    HOME: path.join(os.tmpdir(), "ignored-home"),
    XDG_DATA_HOME: linuxXdgDirectory,
    NODEVIEW_PLATFORM: "linux"
  }),
  /nodeview-xdg-data[\\/]NodeViewJS[\\/]My-App-[0-9a-f]{16}[\\/]WebKitGTK$/
);
assert.equal(
  resolveWebViewDataDirectory("App", windowsDataEnvironment),
  resolveWebViewDataDirectory("Ａpp", windowsDataEnvironment)
);

assert.throws(
  () => new App({ entry: __filename, permissions: "fs:read" }),
  /App permissions must be an array/
);

assert.throws(
  () => new App({ entry: __filename, permissions: ["danger:all"] }),
  /Unsupported app permission/
);

const throwingDiagnosticValue = {
  toString() {
    throw new Error("diagnostic conversion should not escape validation");
  }
};
assert.throws(
  () => new App({ entry: __filename, permissions: [throwingDiagnosticValue] }),
  /Unsupported app permission: <unprintable>/
);

assert.throws(
  () => new App({ entry: __filename, permissions: { allow: "fs:read" } }),
  /allow and deny values must be arrays/
);

assert.throws(
  () => new App({ entry: __filename, permissions: { allow: [], audit: [] } }),
  /Unsupported app permission policy option/
);

assert.throws(
  () => new App({
    entry: __filename,
    permissions: new Proxy({}, {
      ownKeys() {
        throw new Error("permission policy inspection should not escape validation");
      }
    })
  }),
  /App permission policy object could not be inspected/
);

assert.throws(
  () => new App({ entry: __filename, permissions: ["danger:*"] }),
  /Unsupported app permission/
);

assert.throws(
  () => new App({ entry: __filename, appId: " " }),
  /App id must be a non-empty string/
);

assert.throws(
  () => new App({ entry: __filename, title: " " }),
  /App title must be a non-empty string/
);

assert.throws(
  () => new App({ entry: __filename, tray: "yes" }),
  /Tray options must be an object or boolean/
);

assert.throws(
  () => new App({ entry: __filename, tray: { title: "" } }),
  /Tray title must be a non-empty string/
);

assert.throws(
  () => app.command("badPermission", { permission: "danger:all" }, () => "nope"),
  /Unsupported command permission/
);

assert.throws(
  () => app.command("groupRequirement", { permission: "fs:*" }, () => "nope"),
  /Unsupported command permission/
);

assert.throws(
  () => app.command("wildcardScope", { permission: "fs:read", scope: "*" }, () => "nope"),
  /Unsupported command permission scope/
);

assert.throws(
  () => app.command(
    "hostileScope",
    { permission: "fs:read", scope: throwingDiagnosticValue },
    () => "nope"
  ),
  /Unsupported command permission scope: <unprintable>/
);

assert.throws(
  () => app.command("scopeOnly", { scope: "config" }, () => "nope"),
  /scope requires a singular permission/
);

assert.throws(
  () => app.command(
    "mixedRequirements",
    { permission: "fs:read", permissions: ["dialog:open"] },
    () => "nope"
  ),
  /cannot use both permission and permissions/
);

assert.throws(
  () => app.command("missingHandler", { permission: "fs:read" }),
  /Command handler must be a function/
);

assert.throws(
  () => app.command("plain", () => "duplicate"),
  /Command already registered/
);

assert.equal(trayApp.setTray({ title: "Tray Test" }), trayApp);
assert.equal(trayApp.options.tray.title, "Tray Test");
assert.equal(trayApp.setTray({
  menu: [
    { id: "tray.show", label: "Show" },
    { type: "separator" },
    { id: "tray.quit", label: "Quit" }
  ]
}), trayApp);
assert.equal(trayApp.options.tray.menu[0].id, "tray.show");
assert.equal(trayApp.setTray({ title: "Updated Tray" }), trayApp);
assert.equal(trayApp.options.tray.menu[2].id, "tray.quit");
assert.equal(trayApp.setTray({ menu: null }), trayApp);
assert.equal(trayApp.options.tray.menu, null);
assert.equal(trayApp.setMenu([{ id: "tray.menu", label: "Menu" }]), trayApp);

assert.throws(
  () => new App({ entry: path.join(os.tmpdir(), "missing-nodeview-entry.html") }).run(),
  /App entry file was not found/
);

assert.throws(
  () => notification.show(null),
  /Notification options must be an object/
);

assert.throws(
  () => notification.show({ message: 1 }),
  /Notification message must be a string/
);

assert.equal(isFrontendFile("index.html"), true);
assert.equal(isFrontendFile("assets\\theme.CSS"), true);
assert.equal(isFrontendFile("runtime\\app.js"), true);
assert.equal(isFrontendFile("assets\\logo.png"), false);
assert.equal(isFrontendFile("node_modules\\package\\index.js"), false);
assert.equal(isFrontendFile("BUILD\\bundle.js"), false);
assert.equal(isFrontendFile(".nodeview-webview\\Cache\\script.js"), false);

async function testDevWatcher() {
  const watcher = new EventEmitter();
  watcher.unref = () => {};
  let onChange;
  let reloads = 0;
  const messages = [];

  startDevWatcher(__filename, () => reloads++, {
    debounceMs: 5,
    log: (message) => messages.push(message),
    watch: (_root, _options, handler) => {
      onChange = handler;
      return watcher;
    }
  });

  onChange("change", "styles.css");
  onChange("change", "index.html");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(reloads, 1);
  assert.match(messages.at(-1), /index\.html changed/);

  onChange("change", "after-close.css");
  watcher.emit("close");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reloads, 1);
}

async function testConfig() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nodeviewjs-config-"));

  assert.deepEqual(
    await config.read({ directory, fileName: "settings.json", defaults: { theme: "dark" } }),
    { theme: "dark" }
  );

  await config.write({
    directory,
    fileName: "settings.json",
    data: { theme: "light", window: { width: 800 } }
  });

  assert.deepEqual(
    await config.read({ directory, fileName: "settings.json" }),
    { theme: "light", window: { width: 800 } }
  );

  assert.throws(
    () => config.resolveConfigPath({ directory, fileName: "../settings.json" }),
    /must not include directories/
  );

  assert.throws(
    () => config.resolveConfigPath({ directory, fileName: "settings.txt" }),
    /must end with .json/
  );

  assert.throws(
    () => config.resolveConfigPath({ directory: `${directory}\0hidden`, fileName: "settings.json" }),
    /directory must not contain control characters/
  );

  assert.throws(
    () => config.resolveConfigPath({ appName: "My\nApp", fileName: "settings.json" }),
    /appName must not contain control characters/
  );

  assert.throws(
    () => config.resolveConfigPath({ directory, fileName: "settings.json\0hidden" }),
    /fileName must not contain control characters/
  );
}

async function testIpcCommandErrorDetail() {
  const postedIpcErrors = [];
  await ipcErrorApp._handleWindowMessage(
    {
      _markBridgeReady() {},
      _post(message) { postedIpcErrors.push(JSON.parse(message)); }
    },
    runtime.ipc.serialize({
      version: 1,
      type: "invoke",
      id: 77,
      command: "hostileError"
    })
  );
  assert.deepEqual(postedIpcErrors, [{
    version: 1,
    type: "response",
    id: 77,
    ok: false,
    error: "Unknown IPC command error."
  }]);
}

async function testWindowPermissionPolicy() {
  const windowPolicyApp = new App({
    entry: __filename,
    permissions: ["fs:read", "fs:write"]
  });
  windowPolicyApp.command("windowRead", { permission: "fs:read" }, () => "read");
  windowPolicyApp.command("windowWrite", { permission: "fs:write" }, () => "write");
  const limitedWindow = windowPolicyApp.createWindow({
    title: "Limited",
    permissions: ["fs:read"]
  });
  const responses = [];
  limitedWindow._post = (message) => responses.push(JSON.parse(message));
  assert.equal(Object.hasOwn(limitedWindow.options, "permissionPolicy"), false);

  await windowPolicyApp._handleWindowMessage(
    limitedWindow,
    runtime.ipc.serialize({
      version: 1,
      type: "invoke",
      id: 101,
      command: "windowRead"
    })
  );
  await windowPolicyApp._handleWindowMessage(
    limitedWindow,
    runtime.ipc.serialize({
      version: 1,
      type: "invoke",
      id: 102,
      command: "windowWrite"
    })
  );
  limitedWindow.options.permissionPolicy = {
    allow: new Set(["fs:write"]),
    deny: new Set()
  };
  await windowPolicyApp._handleWindowMessage(
    limitedWindow,
    runtime.ipc.serialize({
      version: 1,
      type: "invoke",
      id: 104,
      command: "windowWrite"
    })
  );

  assert.deepEqual(responses, [
    { version: 1, type: "response", id: 101, ok: true, result: "read" },
    {
      version: 1,
      type: "response",
      id: 102,
      ok: false,
      error: "Permission not granted for command 'windowWrite': fs:write"
    },
    {
      version: 1,
      type: "response",
      id: 104,
      ok: false,
      error: "Permission not granted for command 'windowWrite': fs:write"
    }
  ]);

  const maximumPolicyApp = new App({
    entry: __filename,
    permissions: ["fs:read"]
  });
  maximumPolicyApp.command("write", { permission: "fs:write" }, () => "write");
  const broaderWindow = maximumPolicyApp.createWindow({
    title: "Broader",
    permissions: ["fs:write"]
  });
  const broaderResponses = [];
  broaderWindow._post = (message) => broaderResponses.push(JSON.parse(message));
  await maximumPolicyApp._handleWindowMessage(
    broaderWindow,
    runtime.ipc.serialize({
      version: 1,
      type: "invoke",
      id: 103,
      command: "write"
    })
  );
  assert.deepEqual(broaderResponses, [{
    version: 1,
    type: "response",
    id: 103,
    ok: false,
    error: "Permission not granted for command 'write': fs:write"
  }]);
}

async function testBridgeLifecycleMessages() {
  const lifecycle = [];
  const window = {
    _dispatch() { lifecycle.push("dispatch"); },
    _markBridgeReady() { lifecycle.push("ready"); },
    _resetBridgeReady() { lifecycle.push("loading"); }
  };
  await app._handleWindowMessage(
    window,
    runtime.ipc.serialize(runtime.ipc.createEventMessage("nodeview:loading"))
  );
  await app._handleWindowMessage(
    window,
    runtime.ipc.serialize(runtime.ipc.createEventMessage("nodeview:ready"))
  );
  assert.deepEqual(lifecycle, ["loading", "ready"]);
}

{
  // app.emit() must not broadcast into a closed window. A closed window can
  // never flush its readiness buffer, so buffering there grows memory until
  // emit() throws for every window, including the live ones.
  const closingApp = new App({ entry: __filename });
  const closingWindow = closingApp.createWindow({ title: "Closing" });

  // A window that has not been opened yet is not closed: it must still buffer
  // events emitted before run().
  assert.equal(closingWindow.isClosed, false);
  assert.equal(closingApp.mainWindow.isClosed, false);
  assert.equal(closingWindow.emit("buffered-before-run", { ok: true }), closingWindow);

  assert.equal(closingWindow.close(), closingWindow);
  assert.equal(closingWindow.isOpen, false);
  assert.equal(closingWindow.isClosed, true);

  // Closed windows stay listed so a failed run() can reopen them on retry.
  assert.deepEqual(closingApp.windows, [closingApp.mainWindow, closingWindow]);

  // Naming one dead window fails fast instead of buffering forever.
  assert.throws(() => closingWindow.emit("dead"), /Window has been closed/);

  // A broadcast addresses the live windows and skips closed ones silently.
  let closedDeliveries = 0;
  let liveDeliveries = 0;
  const liveEmit = closingApp.mainWindow.emit.bind(closingApp.mainWindow);
  closingWindow.emit = () => { closedDeliveries += 1; };
  closingApp.mainWindow.emit = (...args) => { liveDeliveries += 1; return liveEmit(...args); };

  assert.equal(closingApp.emit("broadcast", { ok: true }), closingApp);
  assert.equal(closedDeliveries, 0, "app.emit() delivered into a closed window");
  assert.equal(liveDeliveries, 1, "app.emit() skipped a live window");

  delete closingWindow.emit;
  delete closingApp.mainWindow.emit;

  // Closing twice must stay harmless.
  assert.equal(closingWindow.close(), closingWindow);
  assert.equal(closingWindow.isClosed, true);
}

Promise.all([
  testConfig(),
  testDevWatcher(),
  testIpcCommandErrorDetail(),
  testWindowPermissionPolicy(),
  testBridgeLifecycleMessages()
])
  .then(() => console.log("Runtime API test passed."))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
