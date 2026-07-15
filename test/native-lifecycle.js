"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { normalizeMenuTemplate } = require("../runtime/menu");

const fixture = path.join(__dirname, "fixtures", "early-close.js");
const result = spawnSync(process.execPath, [fixture], {
  encoding: "utf8",
  timeout: 10_000
});

assert.equal(result.error, undefined, result.error?.message);
assert.equal(result.status, 0, result.stderr);

if (process.platform === "win32") {
  const native = require("../runtime/native");
  assert.throws(() => native.claimSingleInstance(), /expects one key string/);
  assert.throws(() => native.setMenuHandler(1), /expects a window id and function/);
  assert.throws(() => native.setTaskbarProgress(1, 2, "normal"), /between 0 and 1/);
  assert.throws(
    () => native.setTaskbarOverlay(1, 42, "description"),
    /icon path or null/
  );
  assert.throws(() => native.requestWindowAttention(1, 42), /attention type/);
  assert.throws(() => native.writeClipboardText(null), /expects one string/);
  assert.throws(
    () => native.openExternal("file:///C:/Windows/notepad.exe"),
    /supports only http, https, and mailto/
  );
  assert.throws(
    () => native.openExternal(" https://example.com"),
    /must not contain leading, trailing, or control whitespace/
  );
  assert.throws(
    () => native.openExternal("https://example.com/\r\nnext"),
    /must not contain leading, trailing, or control whitespace/
  );
  assert.throws(
    () => native.openPath(path.join(os.tmpdir(), "nodeviewjs-native-missing-path")),
    /target does not exist/
  );
  assert.throws(
    () => native.openPath(`${__filename}\0hidden`),
    /must not contain control characters/
  );

  const recoveryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-native-recovery-"));
  const recoveryResult = path.join(recoveryDirectory, "result.txt");
  try {
    const recovery = spawnSync(
      process.execPath,
      [path.join(__dirname, "fixtures", "recover-after-icon-failure.js")],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LOCALAPPDATA: path.join(recoveryDirectory, "local-app-data"),
          NODEVIEW_RECOVERY_RESULT: recoveryResult
        },
        timeout: 10_000
      }
    );
    assert.equal(recovery.error, undefined, recovery.error?.message);
    assert.equal(recovery.status, 0, recovery.stderr);
    assert.equal(fs.readFileSync(recoveryResult, "utf8"), "recovered");
  } finally {
    try {
      fs.rmSync(recoveryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 100
      });
    } catch (error) {
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error;
    }
  }

  const controlsWindow = native.createWindow({
    title: "NodeViewJS Window Controls Test",
    appUserModelId: "NodeViewJS.NativeLifecycle.Test",
    width: 500,
    height: 300,
    frame: true,
    closable: false,
    minimizable: false,
    maximizable: false,
    windowColors: {
      titleBar: 0x112233,
      titleText: 0xffffff,
      border: 0x445566
    }
  });
  const initialControlsState = native.getWindowState(controlsWindow);
  assert.deepEqual(
    {
      frame: initialControlsState.frame,
      closable: initialControlsState.closable,
      minimizable: initialControlsState.minimizable,
      maximizable: initialControlsState.maximizable
    },
    {
      frame: true,
      closable: false,
      minimizable: false,
      maximizable: false
    }
  );
  assert.equal(initialControlsState.taskbarProgressState, "none");
  assert.equal(initialControlsState.appUserModelId, "NodeViewJS.NativeLifecycle.Test");
  assert.equal(initialControlsState.taskbarProgressValue, 0);
  assert.equal(initialControlsState.hasTaskbarOverlay, false);
  assert.equal(typeof initialControlsState.windowColorsSupported, "boolean");
  assert.deepEqual(initialControlsState.windowColors, {
    titleBar: 0x112233,
    titleText: 0xffffff,
    border: 0x445566
  });
  native.setWindowColors(controlsWindow, {
    titleBar: 0xabcdef,
    titleText: null,
    border: null
  });
  assert.equal(native.getWindowState(controlsWindow).windowColors.titleBar, 0xabcdef);
  native.setWindowTitle(controlsWindow, "Updated Controls Test");
  native.setWindowSize(controlsWindow, 640, 360);
  native.setWindowPosition(controlsWindow, 25, 30);
  let controlsState = native.getWindowState(controlsWindow);
  assert.equal(controlsState.title, "Updated Controls Test");
  assert.equal(controlsState.width, 640);
  assert.equal(controlsState.height, 360);
  assert.equal(controlsState.x, 25);
  assert.equal(controlsState.y, 30);
  assert.equal(controlsState.visible, false);
  const nativeMenu = normalizeMenuTemplate([
    {
      label: "File",
      submenu: [
        { id: "file.open", label: "Open", accelerator: "Ctrl+O" },
        { type: "separator" },
        { id: "file.enabled", label: "Enabled", type: "checkbox", checked: true }
      ]
    }
  ]);
  native.setMenuHandler(controlsWindow, () => {});
  native.setApplicationMenu(controlsWindow, nativeMenu);
  controlsState = native.getWindowState(controlsWindow);
  assert.equal(controlsState.hasMenu, true);
  assert.equal(controlsState.menuCommandCount, 2);
  native.setApplicationMenu(controlsWindow, null);
  assert.equal(native.getWindowState(controlsWindow).hasMenu, false);
  assert.throws(() => native.minimizeWindow(controlsWindow), /not minimizable/);
  assert.throws(() => native.maximizeWindow(controlsWindow), /not maximizable/);
  native.setWindowFullscreen(controlsWindow, true);
  assert.equal(native.getWindowState(controlsWindow).fullscreen, true);
  native.setWindowFullscreen(controlsWindow, false);
  controlsState = native.getWindowState(controlsWindow);
  assert.equal(controlsState.fullscreen, false);
  assert.equal(controlsState.frame, true);
  native.closeWindow(controlsWindow);

  const nativeFixture = path.join(__dirname, "fixtures", "native-default-profile.js");
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-native-profile-"));
  const temporaryEntry = path.join(temporaryDirectory, "index.html");
  const temporaryLocalAppData = path.join(temporaryDirectory, "local-app-data");
  fs.writeFileSync(temporaryEntry, "<!doctype html><title>Native profile test</title>");

  try {
    const nativeResult = spawnSync(process.execPath, [nativeFixture], {
      encoding: "utf8",
      env: {
        ...process.env,
        LOCALAPPDATA: temporaryLocalAppData,
        NODEVIEW_TEST_ENTRY: temporaryEntry
      },
      timeout: 10_000
    });

    assert.equal(nativeResult.error, undefined, nativeResult.error?.message);
    assert.equal(nativeResult.status, 0, nativeResult.stderr);
    assert.equal(fs.existsSync(path.join(temporaryDirectory, ".nodeview-webview")), false);
    const nativeProfiles = fs.readdirSync(path.join(temporaryLocalAppData, "NodeViewJS"));
    assert.equal(nativeProfiles.length, 1);
    assert.match(nativeProfiles[0], /^native-[0-9a-f]{16}$/);
    assert.equal(fs.existsSync(path.join(temporaryLocalAppData, "NodeViewJS", nativeProfiles[0], "WebView2")), true);
  } finally {
    try {
      fs.rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 100
      });
    } catch (error) {
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error;
    }
  }
}

console.log("Native lifecycle test passed.");
