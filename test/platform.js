"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");

const { createInfoPlist, createMacDmg, packageMacApp } = require("../scripts/package-macos");
const { packageLinuxApp } = require("../scripts/package-linux");
const { notarizeMacApp, signMacApp } = require("../scripts/sign-macos");

const root = path.join(__dirname, "..");
const binding = JSON.parse(fs.readFileSync(path.join(root, "src-nodeview", "binding.gyp"), "utf8"));
const addon = binding.targets.find((target) => target.target_name === "nodeview");
assert.ok(addon);
assert.ok(addon.sources.includes("src/addon.cpp"));
assert.ok(addon.conditions.some(([condition, settings]) =>
  condition === "OS=='mac'" && settings.sources.includes("src/macos.mm") &&
  settings.libraries.includes("-framework WebKit")
));
assert.ok(binding.conditions.some(([condition, settings]) =>
  condition === "OS=='win'" && settings.targets.some(
    (target) => target.target_name === "nodeview_launcher"
  )
));
const windowsAddon = addon.conditions.find(([condition]) => condition === "OS=='win'")[1];
const windowsLauncherTarget = binding.conditions.find(([condition]) => condition === "OS=='win'")[1]
  .targets.find((target) => target.target_name === "nodeview_launcher");
for (const target of [windowsAddon, windowsLauncherTarget]) {
  assert.deepEqual(target.msvs_settings.VCCLCompilerTool.AdditionalOptions, [
    "/sdl", "/guard:cf", "/Qspectre"
  ]);
  assert.deepEqual(target.msvs_settings.VCLinkerTool.AdditionalOptions, [
    "/guard:cf", "/DYNAMICBASE", "/NXCOMPAT", "/CETCOMPAT"
  ]);
  assert.ok(target.conditions.some(([condition, settings]) =>
    condition === "security_analysis==1"
      && settings.msvs_settings.VCCLCompilerTool.AdditionalOptions.includes("/analyze")
      && settings.msvs_settings.VCCLCompilerTool.WarnAsError === "true"
  ));
}
assert.ok(binding.conditions.some(([condition, settings]) =>
  condition === "OS=='mac'" && settings.targets.some(
    (target) => target.sources.includes("src/macos_launcher.mm")
  )
));
assert.ok(addon.conditions.some(([condition, settings]) =>
  condition === "OS=='linux'" && settings.sources.includes("src/linux.cpp") &&
  settings.libraries.some((library) => library.includes("webkit2gtk-4.1"))
));
assert.ok(addon.conditions.some(([condition, settings]) =>
  condition === "OS=='win'" && settings.sources.includes("src/shell.cpp") &&
  settings.sources.includes("src/clipboard.cpp") &&
  settings.sources.includes("src/single_instance.cpp")
));
assert.ok(binding.conditions.some(([condition, settings]) =>
  condition === "OS=='linux'" && settings.targets.some(
    (target) => target.sources.includes("src/linux_launcher.cpp")
  )
));

const plist = createInfoPlist({
  appId: "com.example.test",
  appName: "Test & View",
  version: "1.2.3",
  iconName: "Test.icns"
});
assert.match(plist, /<string>com\.example\.test<\/string>/);
assert.match(plist, /<string>Test &amp; View<\/string>/);
assert.match(plist, /<string>Test\.icns<\/string>/);

const bundleFixture = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-macos-package-"));
const projectRoot = path.join(bundleFixture, "project");
const runtimeRoot = path.join(bundleFixture, "runtime-root");
fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(path.join(runtimeRoot, "runtime"), { recursive: true });
fs.mkdirSync(path.join(runtimeRoot, "build", "nodeview"), { recursive: true });
fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
  name: "test-app",
  version: "1.2.3",
  nodeviewjs: {
    name: "TestApp",
    appId: "com.example.test-app",
    entry: "app.js"
  }
}));
fs.writeFileSync(path.join(projectRoot, "app.js"), 'require("nodeviewjs");\n');
fs.writeFileSync(path.join(projectRoot, "index.html"), "<h1>Test</h1>\n");
fs.writeFileSync(path.join(runtimeRoot, "runtime", "index.js"), "module.exports = {};\n");
fs.writeFileSync(path.join(runtimeRoot, "runtime", "bridge.js"), "window.NodeViewJS = {};\n");
fs.writeFileSync(path.join(runtimeRoot, "build", "nodeview", "nodeview.node"), "addon");
fs.writeFileSync(path.join(runtimeRoot, "build", "nodeview", "nodeview_launcher"), "launcher");
const fakeNode = path.join(bundleFixture, "node");
fs.writeFileSync(fakeNode, "node");
const appBundle = packageMacApp(projectRoot, {
  allowNonMac: true,
  nodeExecutable: fakeNode,
  runtimeRoot
});
assert.ok(fs.existsSync(path.join(appBundle, "Contents", "Info.plist")));
assert.ok(fs.existsSync(path.join(appBundle, "Contents", "MacOS", "TestApp")));
assert.ok(fs.existsSync(path.join(appBundle, "Contents", "Resources", "app", "index.html")));
assert.match(
  fs.readFileSync(path.join(appBundle, "Contents", "Resources", "app", "index.html"), "utf8"),
  /data-nodeview-bridge="embedded"/
);
assert.match(
  fs.readFileSync(path.join(appBundle, "Contents", "Resources", "app", "app.js"), "utf8"),
  /NODEVIEW_APP_ID = "com\.example\.test-app"/
);
assert.equal(
  fs.readFileSync(path.join(appBundle, "Contents", "MacOS", "TestApp"), "utf8"),
  "launcher"
);

const dmgCommands = [];
const dmg = createMacDmg(appBundle, {
  linkApplications: false,
  run(command, args) {
    dmgCommands.push([command, args]);
    fs.writeFileSync(args.at(-1), "disk-image");
  }
});
assert.equal(dmg, path.join(path.dirname(appBundle), "TestApp.dmg"));
assert.equal(fs.readFileSync(dmg, "utf8"), "disk-image");
assert.deepEqual(dmgCommands.map(([command, args]) => [command, args[0], args.at(-1)]), [
  ["hdiutil", "create", dmg]
]);
assert.equal(fs.existsSync(`${dmg}.staging`), false);

const linuxOutput = packageLinuxApp(projectRoot, {
  allowNonLinux: true,
  nodeExecutable: fakeNode,
  runtimeRoot
});
assert.ok(fs.existsSync(path.join(linuxOutput, "TestApp")));
assert.ok(fs.existsSync(path.join(linuxOutput, "resources", "app", "index.html")));
assert.match(
  fs.readFileSync(path.join(linuxOutput, "resources", "app", "index.html"), "utf8"),
  /data-nodeview-bridge="embedded"/
);
assert.ok(fs.existsSync(path.join(linuxOutput, "resources", "runtime", "native", "nodeview.node")));
assert.match(
  fs.readFileSync(path.join(linuxOutput, "resources", "app", "app.js"), "utf8"),
  /NODEVIEW_APP_ID = "com\.example\.test-app"/
);

const signingCommands = [];
signMacApp(appBundle, {
  identity: "Developer ID Application: Example",
  run(command, args) { signingCommands.push([command, args]); }
});
assert.equal(signingCommands.filter(([command]) => command === "codesign").length, 5);
assert.ok(signingCommands.some(([, args]) => args.includes("--entitlements")));

const notarizationCommands = [];
notarizeMacApp(appBundle, {
  profile: "nodeview-notary",
  run(command, args) {
    notarizationCommands.push([command, args]);
    if (command === "ditto") fs.writeFileSync(args.at(-1), "archive");
  }
});
assert.deepEqual(notarizationCommands.map(([command, args]) => [command, args[0]]), [
  ["ditto", "-c"],
  ["xcrun", "notarytool"],
  ["xcrun", "stapler"],
  ["xcrun", "stapler"]
]);

const nativeApi = fs.readFileSync(path.join(root, "src-nodeview", "include", "native_api.h"), "utf8");
const macHost = fs.readFileSync(path.join(root, "src-nodeview", "src", "macos.mm"), "utf8");
const linuxHost = fs.readFileSync(path.join(root, "src-nodeview", "src", "linux.cpp"), "utf8");
const windowsShell = fs.readFileSync(path.join(root, "src-nodeview", "src", "shell.cpp"), "utf8");
const windowsClipboard = fs.readFileSync(path.join(root, "src-nodeview", "src", "clipboard.cpp"), "utf8");
const windowsSingleInstance = fs.readFileSync(path.join(root, "src-nodeview", "src", "single_instance.cpp"), "utf8");
const windowsLauncher = fs.readFileSync(path.join(root, "src-nodeview", "src", "launcher.cpp"), "utf8");
const macLauncher = fs.readFileSync(path.join(root, "src-nodeview", "src", "macos_launcher.mm"), "utf8");
const linuxLauncher = fs.readFileSync(path.join(root, "src-nodeview", "src", "linux_launcher.cpp"), "utf8");
const associationNormalizer = path.join(root, "scripts", "normalize-associations.js");
const windowsHost = fs.readFileSync(path.join(root, "src-nodeview", "src", "window.cpp"), "utf8");
const windowsWebView = fs.readFileSync(path.join(root, "src-nodeview", "src", "webview.cpp"), "utf8");
for (const name of [
  "CreateNativeWindow",
  "CloseNativeWindow",
  "CloseAllNativeWindows",
  "ShowNativeWindow",
  "HideNativeWindow",
  "SetTray",
  "ShowMessageDialog",
  "ShowNotification",
  "OpenFileDialog",
  "SaveFileDialog",
  "LoadFile",
  "SetMessageHandler",
  "PostWebMessage",
  "ReloadWebView",
  "Run"
]) {
  assert.match(nativeApi, new RegExp(`\\b${name}\\b`));
  assert.match(macHost, new RegExp(`\\b${name}\\b`));
  assert.match(linuxHost, new RegExp(`\\b${name}\\b`));
}

assert.match(linuxHost, /webkit_user_content_manager_register_script_message_handler/);
assert.match(linuxHost, /WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START/);
assert.match(linuxHost, /if \(!state\.bridge_embedded\)/);
assert.match(linuxHost, /webkit_web_view_evaluate_javascript/);
assert.match(linuxHost, /StringOption\(options, "dataDirectory", ""\)/);
assert.match(macHost, /NSString\* root = state->entry_root\.path;/);
assert.match(macHost, /if \(!state\.bridge_embedded\)/);
assert.match(windowsWebView, /if \(state\.bridge_embedded\)/);
assert.match(windowsWebView, /put_AreDevToolsEnabled\(allow_devtools\)/);
assert.match(windowsWebView, /state\.devtools_enabled && !state\.bridge_embedded/);
assert.match(windowsWebView, /add_NewWindowRequested/);
assert.match(windowsWebView, /add_PermissionRequested/);
assert.match(windowsWebView, /add_WebResourceRequested/);
assert.match(windowsWebView, /SetVirtualHostNameToFolderMapping/);
assert.match(windowsWebView, /COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS/);
assert.match(windowsWebView, /ClearVirtualHostNameToFolderMapping/);
assert.match(windowsWebView, /add_DownloadStarting/);
assert.match(windowsWebView, /add_LaunchingExternalUriScheme/);
assert.match(windowsShell, /ShellExecuteW/);
assert.match(windowsShell, /OpenExternal/);
assert.match(windowsShell, /OpenPath/);
assert.match(nativeApi, /ReadClipboardText/);
assert.match(nativeApi, /WriteClipboardText/);
assert.match(windowsClipboard, /CF_UNICODETEXT/);
assert.match(windowsClipboard, /OpenClipboard/);
assert.match(windowsClipboard, /SetClipboardData/);
assert.match(nativeApi, /ClaimSingleInstance/);
assert.match(nativeApi, /ReleaseSingleInstance/);
assert.match(windowsSingleInstance, /CreateMutexW/);
assert.match(windowsSingleInstance, /ERROR_ALREADY_EXISTS/);
assert.match(windowsLauncher, /FindResourceW/);
assert.match(windowsLauncher, /BCryptOpenAlgorithmProvider/);
assert.match(windowsLauncher, /VerifyIntegrity/);
assert.match(windowsLauncher, /OPEN_ALWAYS/);
assert.match(macLauncher, /O_APPEND/);
assert.match(linuxLauncher, /O_APPEND/);
assert.ok(binding.conditions.some(([condition, settings]) =>
  condition === "OS=='win'" && settings.targets.some(
    (target) => target.target_name === "nodeview_launcher" && target.libraries.includes("bcrypt.lib")
  )
));
assert.ok(fs.existsSync(associationNormalizer));
assert.match(
  fs.readFileSync(path.join(root, "src-nodeview", "src", "launcher.cpp"), "utf8"),
  /command \+= command_line/
);
assert.match(windowsHost, /GetBoolean\(options, "frameOnHover", false\)/);
assert.match(windowsHost, /if \(g_state\.frame_on_hover\) g_state\.frame = false/);
assert.match(windowsHost, /WM_NCMOUSELEAVE/);
assert.match(windowsHost, /SetHoverFrameVisible/);
assert.match(windowsHost, /CreateAcceleratorTableW/);
assert.match(windowsHost, /TrackPopupMenuEx/);
assert.match(windowsHost, /SetApplicationMenu/);
assert.match(nativeApi, /SetNativeMenuHandler/);
assert.match(nativeApi, /SetNativeApplicationMenu/);
assert.match(nativeApi, /ShowNativeContextMenu/);
assert.match(windowsHost, /ITaskbarList3/);
assert.match(windowsHost, /SetProgressState/);
assert.match(windowsHost, /SetOverlayIcon/);
assert.match(windowsHost, /FlashWindowEx/);
assert.match(windowsHost, /SetCurrentProcessExplicitAppUserModelID/);
assert.match(nativeApi, /SetNativeTaskbarProgress/);
assert.match(nativeApi, /SetNativeTaskbarOverlay/);
assert.match(nativeApi, /RequestNativeWindowAttention/);

const posted = [];
const window = {
  webkit: {
    messageHandlers: {
      nodeview: {
        postMessage(message) { posted.push(message); }
      }
    }
  }
};
window.top = window;
const bridgeSource = fs.readFileSync(path.join(root, "runtime", "bridge.js"), "utf8");
vm.runInNewContext(
  bridgeSource,
  { window, setTimeout, clearTimeout }
);

const childWindow = {
  top: window,
  webkit: window.webkit
};
vm.runInNewContext(bridgeSource, { window: childWindow });
assert.equal(childWindow.NodeViewJS, undefined);
assert.equal(childWindow.NodeView, undefined);

assert.equal(typeof window.NodeViewJS.invoke, "function");
assert.equal(window.NodeViewJS, window.NodeView);
const invocation = window.NodeViewJS.invoke("platform", { name: "webkit" });
const invocationId = posted[0].id;
assert.deepEqual(JSON.parse(JSON.stringify(posted[0])), {
  version: 1,
  type: "invoke",
  id: invocationId,
  command: "platform",
  payload: { name: "webkit" }
});
assert.equal(Number.isSafeInteger(invocationId), true);
assert.ok(invocationId > 0);
window.__nodeviewReceive({
  version: 1,
  type: "response",
  id: invocationId,
  ok: true,
  result: "ignored",
  extra: true
});
window.__nodeviewReceive({ version: 1, type: "response", id: invocationId, ok: true, result: "ok" });

let eventPayload;
window.NodeViewJS.on("platform-ready", (payload) => { eventPayload = payload; });
window.__nodeviewReceive({
  version: 1,
  type: "event",
  event: "platform-ready",
  payload: { host: "ignored" },
  extra: true
});
assert.equal(eventPayload, undefined);
window.__nodeviewReceive({
  version: 1,
  type: "event",
  event: "platform-ready",
  payload: { host: "webkit" }
});
assert.deepEqual(JSON.parse(JSON.stringify(eventPayload)), { host: "webkit" });

const queuedInvocations = Array.from({ length: 64 }, (_, index) => (
  window.NodeViewJS.invoke(`queued-${index}`)
));
const overflowInvocation = window.NodeViewJS.invoke("queued-overflow").then(
  () => undefined,
  (error) => error.message
);
for (const message of posted.filter(({ command }) => command?.startsWith("queued-"))) {
  window.__nodeviewReceive({
    version: 1,
    type: "response",
    id: message.id,
    ok: true,
    result: message.command
  });
}

Promise.all([invocation, ...queuedInvocations, overflowInvocation]).then(([result, ...results]) => {
  assert.equal(result, "ok");
  assert.match(results.at(-1), /Too many pending/);
  console.log("Platform boundary test passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
