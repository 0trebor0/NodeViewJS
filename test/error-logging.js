"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { createErrorLogger } = require("../runtime/error-logger");
const { resolveLogPath } = require("../runtime/data-directory");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-error-logging-"));

async function main() {
  assert.match(
    resolveLogPath("My App", { LOCALAPPDATA: temporaryRoot, NODEVIEW_PLATFORM: "win32" }),
    /NodeViewJS[\\/]Logs[\\/]My-App-[0-9a-f]{16}[\\/]backend\.log$/
  );
  assert.match(
    resolveLogPath("My App", { HOME: temporaryRoot, NODEVIEW_PLATFORM: "darwin" }),
    /Library[\\/]Logs[\\/]NodeViewJS[\\/]My-App-[0-9a-f]{16}[\\/]backend\.log$/
  );
  assert.match(
    resolveLogPath("My App", { HOME: temporaryRoot, NODEVIEW_PLATFORM: "linux" }),
    /\.local[\\/]state[\\/]nodeviewjs[\\/]My-App-[0-9a-f]{16}[\\/]backend\.log$/
  );

  const directPath = path.join(temporaryRoot, "direct", "backend.log");
  const direct = createErrorLogger("direct", { logPath: directPath });
  const duplicate = new Error("deduplicated failure");
  assert.equal(direct.report("Direct failure", duplicate), true);
  assert.equal(direct.report("Direct failure repeated", duplicate), false);
  assert.equal(direct.report("String failure", "plain failure"), true);
  assert.equal(direct.report({
    toString() {
      throw new Error("context conversion should not escape logger");
    }
  }, {
    toString() {
      throw new Error("error conversion should not escape logger");
    }
  }), true);
  const throwingStack = new Error("hidden stack failure");
  Object.defineProperty(throwingStack, "stack", {
    get() {
      throw new Error("stack conversion should not escape logger");
    }
  });
  assert.equal(direct.report("Throwing stack failure", throwingStack), true);
  const directContents = fs.readFileSync(directPath, "utf8");
  assert.match(directContents, /Direct failure/);
  assert.match(directContents, /Error: deduplicated failure/);
  assert.match(directContents, /String failure\nplain failure/);
  assert.match(directContents, /Unknown context\.\nUnknown error\./);
  assert.match(directContents, /Throwing stack failure\nUnknown error\./);
  assert.equal((directContents.match(/deduplicated failure/g) || []).length, 1);

  const rotatingPath = path.join(temporaryRoot, "rotating", "backend.log");
  const rotating = createErrorLogger("rotating", { logPath: rotatingPath, maxBytes: 256 });
  assert.equal(rotating.report("First", new Error("x".repeat(300))), true);
  assert.equal(rotating.report("Second", new Error("y".repeat(300))), true);
  assert.ok(fs.existsSync(`${rotatingPath}.1`));
  assert.match(fs.readFileSync(rotatingPath, "utf8"), /Second/);

  const blockedParent = path.join(temporaryRoot, "blocked-parent");
  fs.writeFileSync(blockedParent, "not a directory");
  const blocked = createErrorLogger("blocked", {
    logPath: path.join(blockedParent, "backend.log")
  });
  assert.equal(blocked.report("Write failure", new Error("cannot write")), false);

  const childFixture = path.join(__dirname, "fixtures", "error-logging-child.js");
  for (const mode of ["exception", "rejection"]) {
    const childLog = path.join(temporaryRoot, `${mode}.log`);
    const child = spawnSync(process.execPath, [childFixture, mode], {
      encoding: "utf8",
      env: { ...process.env, NODEVIEW_LOG_PATH: childLog },
      timeout: 10_000
    });
    assert.notEqual(child.status, 0, `${mode} child unexpectedly succeeded`);
    const childContents = fs.readFileSync(childLog, "utf8");
    assert.match(childContents, /Unhandled process error/);
    assert.match(childContents, mode === "exception"
      ? /deliberate uncaught exception/
      : /deliberate unhandled rejection/);
  }

  const hostileFatal = spawnSync(process.execPath, [
    "--require",
    path.join(__dirname, "..", "runtime", "dev-errors.js"),
    "-e",
    "const value = { toString() { throw new Error('hidden fatal conversion'); } }; throw value;"
  ], {
    encoding: "utf8",
    timeout: 10_000
  });
  assert.notEqual(hostileFatal.status, 0);
  assert.match(hostileFatal.stderr, /\[NodeViewJS dev\] Backend crashed with an uncaught exception/);
  assert.match(hostileFatal.stderr, /Unknown fatal error\./);

  const hostileFatalStack = spawnSync(process.execPath, [
    "--require",
    path.join(__dirname, "..", "runtime", "dev-errors.js"),
    "-e",
    "const value = new Error('hidden stack'); Object.defineProperty(value, 'stack', { get() { throw new Error('hidden stack conversion'); } }); throw value;"
  ], {
    encoding: "utf8",
    timeout: 10_000
  });
  assert.notEqual(hostileFatalStack.status, 0);
  assert.match(hostileFatalStack.stderr, /\[NodeViewJS dev\] Backend crashed with an uncaught exception/);
  assert.match(hostileFatalStack.stderr, /Unknown fatal error\./);

  const commandLog = path.join(temporaryRoot, "command.log");
  const previousLogPath = process.env.NODEVIEW_LOG_PATH;
  process.env.NODEVIEW_LOG_PATH = commandLog;
  const nativePath = require.resolve("../runtime/native");
  const appPath = require.resolve("../runtime/app");
  const previousNative = require.cache[nativePath];
  let messageHandler;
  const responses = [];
  require.cache[nativePath] = {
    id: nativePath,
    filename: nativePath,
    loaded: true,
    exports: {
      createWindow() { return 1; },
      setMessageHandler(_id, handler) { messageHandler = handler; },
      loadFile() {},
      run() {},
      postMessage(_id, message) { responses.push(JSON.parse(message)); },
      closeWindow() {},
      closeAllWindows() {}
    }
  };
  delete require.cache[appPath];
  try {
    const { App } = require("../runtime/app");
    const app = new App({ appId: "command-log-test", entry: __filename });
    app.command("fail", () => {
      throw new Error("deliberate command failure");
    });
    app.run();
    await messageHandler(JSON.stringify({
      version: 1,
      type: "invoke",
      id: 1,
      command: "fail"
    }));
    app.quit();
    assert.equal(responses[0].ok, false);
    assert.equal(responses[0].error, "deliberate command failure");
    const commandContents = fs.readFileSync(commandLog, "utf8");
    assert.match(commandContents, /IPC command 'fail' failed/);
    assert.match(commandContents, /Error: deliberate command failure/);
  } finally {
    delete require.cache[appPath];
    if (previousNative) require.cache[nativePath] = previousNative;
    else delete require.cache[nativePath];
    if (previousLogPath === undefined) delete process.env.NODEVIEW_LOG_PATH;
    else process.env.NODEVIEW_LOG_PATH = previousLogPath;
  }

  console.log("Backend error logging test passed.");
}

main().finally(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
