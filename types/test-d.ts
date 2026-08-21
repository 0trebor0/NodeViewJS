// Declaration test: type-checked by `npm run test:types`, never executed.
// It resolves the package by name so the exports map and the declarations are
// verified together, and it mirrors the examples in the documentation.

/// <reference path="./bridge.d.ts" />

import {
  App,
  AppWindow,
  Updater,
  clipboard,
  config,
  dialog,
  net,
  notification,
  shell,
  type FetchResult,
  type MenuEventPayload,
  type Plugin,
  type WindowLifecycleState
} from "nodeviewjs";
import { createEventMessage, parseMessage, serialize } from "nodeviewjs/ipc";

const app = new App({
  entry: "index.html",
  title: "Example",
  width: 900,
  permissions: { allow: ["fs:read", "net:fetch"], deny: ["fs:write"] },
  allowedOrigins: ["https://api.example.com"],
  menu: [{ label: "File", submenu: [{ id: "file.open", label: "Open", accelerator: "Ctrl+O" }] }]
});

app.command("ping", () => "pong");
app.command("readSettings", { permission: "fs:read", scope: "settings" }, async (payload) => {
  return { received: payload };
});

app.setShortcuts([{ id: "search.focus", accelerator: "Ctrl+Shift+F" }]);
const stopShortcut: () => void = app.on("shortcut", (event: MenuEventPayload) => {
  const source: AppWindow = event.window;
  source.emit("focus-search", { id: event.id });
});
stopShortcut();

const stopMenu: () => void = app.on("menu", (event: MenuEventPayload) => {
  const source: AppWindow = event.window;
  source.setTitle(event.id);
});
stopMenu();
app.off("menu", () => {});

const secondary: AppWindow = app.createWindow({ title: "Secondary", entry: "second.html" });
const state: WindowLifecycleState = secondary.lifecycleState;
secondary.on("counter", (payload) => payload);
secondary.emit("counter", { value: 1 });
secondary.close();

const windows: AppWindow[] = app.windows;
const started: boolean = app.run();
app.emit("tick", { at: Date.now() });

async function useNetwork(): Promise<void> {
  const response: FetchResult = await app.fetch({
    url: "https://api.example.com/status",
    method: "GET",
    timeoutMs: 5_000
  });
  if (response.ok) {
    const direct = await net.request({
      url: "https://api.example.com/status",
      allowedOrigins: ["https://api.example.com"]
    });
    console.log(direct.status, response.body, state, started, windows.length);
  }
}

const plugin: Plugin = {
  name: "example.settings",
  version: "1.0.0",
  permissions: ["fs:read"],
  setup(context) {
    context.command("read", { permission: "fs:read" }, () => ({ theme: "dark" }));
    const off = context.on("changed", (payload) => payload);
    return () => off();
  }
};
app.use(plugin, { prefix: "settings" });

async function useStorage(): Promise<void> {
  const settings = await config.read<{ theme: string }>({
    appName: "Example",
    defaults: { theme: "dark" }
  });
  await config.write({ appName: "Example", data: settings });
  const directory: string = config.resolveConfigDirectory({ appName: "Example" });
  console.log(directory, config.resolveConfigPath({ fileName: "state.json" }));
}

function useDesktop(): void {
  clipboard.writeText(clipboard.readText());
  dialog.message({ message: "Saved." });
  const opened: string | undefined = dialog.openFile();
  const many: string[] | undefined = dialog.openFile({ multiple: true });
  const folder: string | undefined = dialog.openDirectory();
  void many;
  void folder;
  notification.show({ title: "Example", message: opened ?? "Nothing selected." });
  shell.openExternal("https://example.com");
  shell.openPath("C:/temp");
}

async function useUpdater(): Promise<void> {
  const updater = new Updater({
    appId: "example",
    currentVersion: "1.0.0",
    manifestUrl: "https://example.com/updates.json",
    publicKey: "MCowBQYDK2VwAyEA"
  });
  updater.on("update-available", (update) => console.log(update));
  const available = await updater.checkForUpdates();
  if (available) {
    const downloaded = await updater.downloadUpdate(available);
    console.log(downloaded.path);
    await updater.installAndRestart(app);
  }
}

function useIpc(): void {
  const serialized: string = serialize(createEventMessage("tick", { value: 1 }));
  const parsed = parseMessage(serialized);
  if (parsed?.type === "event") console.log(parsed.event);
}

// Frontend surface: NodeViewJS is the only browser global.
async function usePage(): Promise<void> {
  await window.NodeViewJS?.ready?.();
  const result = await globalThis.NodeViewJS.invoke<string>("ping");
  const off = globalThis.NodeViewJS.on("tick", (payload) => console.log(payload, result));
  off();
}

void useNetwork;
void useStorage;
void useDesktop;
void useUpdater;
void useIpc;
void usePage;
