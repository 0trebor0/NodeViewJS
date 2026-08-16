"use strict";

// Integration test for the Tasks example, which is the application NodeViewJS
// dogfoods. It drives the real backend — the same create-app.js the shipped
// example runs — through the IPC layer, rather than calling its functions
// directly, so what is exercised is what a page would actually reach.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const messageHandlers = new Map();
let nextWindowId = 1;

const fakeNative = {
  closeAllWindows() {},
  closeWindow() {},
  createWindow() { return nextWindowId++; },
  hideWindow() {},
  loadFile() {},
  postMessage() {},
  reload() {},
  run() {},
  setApplicationMenu() {},
  setMessageHandler(id, handler) { messageHandlers.set(id, handler); },
  setMenuHandler() {},
  setTray() {},
  showWindow() {}
};

const nativePath = require.resolve("../runtime/native");
require.cache[nativePath] = { exports: fakeNative };

const { createTasksApp } = require("../examples/tasks/create-app");
const store = require("../examples/tasks/store");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-tasks-"));
const storeOptions = { directory: workspace, fileName: "tasks.json" };

let nextRequestId = 1;

// Speaks to the backend the way a page does: a serialized invoke in, a
// serialized response out.
function createClient(app, window) {
  const responses = new Map();
  window._post = (message) => {
    const parsed = JSON.parse(message);
    if (parsed.type === "response") responses.set(parsed.id, parsed);
  };
  return async function invoke(command, payload) {
    const id = nextRequestId++;
    const message = { version: 1, type: "invoke", id, command };
    if (payload !== undefined) message.payload = payload;
    await app._handleWindowMessage(window, JSON.stringify(message));
    const response = responses.get(id);
    assert.ok(response, `no response for ${command}`);
    if (!response.ok) throw new Error(response.error);
    return response.result;
  };
}

async function main() {
  const { app, openQuickAdd } = createTasksApp({ storeOptions });
  app._reportError = () => {};
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    assert.equal(app.run(), true);
    const main = createClient(app, app.mainWindow);

    // Events the main window receives, so the broadcast can be asserted.
    const broadcasts = [];
    app.mainWindow.emit = (eventName, payload) => {
      if (eventName === "tasks:changed") broadcasts.push(payload);
      return app.mainWindow;
    };

    /* ------------------------------------------------------------ empty */

    assert.deepEqual(await main("tasks:list"), { tasks: [] });

    /* -------------------------------------------------- add and persist */

    const added = await main("tasks:add", { title: "  Write the release notes  " });
    assert.equal(added.task.title, "Write the release notes", "the title was not trimmed");
    assert.equal(added.task.done, false);
    assert.match(added.task.id, /^[0-9a-f-]{36}$/);

    // The change reached the windows without anyone asking.
    assert.equal(broadcasts.length, 1, "adding a task did not broadcast");
    assert.equal(broadcasts[0].tasks.length, 1);

    // And it reached the disk, in the shape the app claims to write.
    const onDisk = JSON.parse(fs.readFileSync(path.join(workspace, "tasks.json"), "utf8"));
    assert.equal(onDisk.tasks.length, 1);
    assert.equal(onDisk.tasks[0].title, "Write the release notes");

    /* ------------------------------------------------- toggle and remove */

    const toggled = await main("tasks:toggle", { id: added.task.id });
    assert.equal(toggled.task.done, true);
    assert.equal((await main("tasks:list")).tasks[0].done, true);

    const second = await main("tasks:add", { title: "Ship it" });
    assert.equal((await main("tasks:list")).tasks.length, 2);

    await main("tasks:remove", { id: added.task.id });
    const remaining = await main("tasks:list");
    assert.deepEqual(remaining.tasks.map((task) => task.title), ["Ship it"]);
    assert.equal(broadcasts.length, 4, "every mutation must broadcast");

    /* ---------------------------------------------------- input rejection */

    for (const [payload, pattern] of [
      [{ title: "" }, /cannot be empty/],
      [{ title: "   " }, /cannot be empty/],
      [{ title: 42 }, /must be a string/],
      [{ title: "x".repeat(201) }, /cannot exceed/],
      [{ title: "line\u0000break" }, /control characters/],
      [undefined, /requires an object payload/],
      [[], /requires an object payload/]
    ]) {
      await assert.rejects(
        () => main("tasks:add", payload),
        pattern,
        `accepted ${JSON.stringify(payload)}`
      );
    }
    await assert.rejects(() => main("tasks:toggle", { id: "not-an-id" }), /must be one this application issued/);
    await assert.rejects(
      () => main("tasks:remove", { id: "00000000-0000-0000-0000-000000000000" }),
      /no longer exists/
    );

    // Nothing invalid was written.
    assert.equal((await main("tasks:list")).tasks.length, 1);

    /* -------------------------------------- the quick-add window's policy */

    const quickAdd = openQuickAdd();
    assert.equal(quickAdd.lifecycleState, "open");
    const quick = createClient(app, quickAdd);

    // It may add, because the app grants fs:write and so does the window.
    await quick("tasks:add", { title: "Added from the quick-add window" });
    assert.deepEqual(
      (await main("tasks:list")).tasks.map((task) => task.title),
      ["Ship it", "Added from the quick-add window"]
    );

    // It may not read: the window narrows the app policy to fs:write, so the
    // read command is refused even though the app itself holds fs:read.
    await assert.rejects(
      () => quick("tasks:list"),
      /Permission not granted for command 'tasks:list': fs:read/,
      "the narrowed window was able to read the list"
    );

    // Opening it again reuses the window rather than stacking them up.
    assert.equal(openQuickAdd(), quickAdd);
    assert.equal(app.windows.length, 2);

    /* ------------------------------------------ stored data is untrusted */

    // The task file is editable by anything running as the user, so what comes
    // back off disk is validated exactly like page input.
    fs.writeFileSync(path.join(workspace, "tasks.json"), JSON.stringify({
      tasks: [
        { id: "11111111-1111-1111-1111-111111111111", title: "Legitimate", done: false },
        { id: "not-a-uuid", title: "Bad id" },
        { id: "22222222-2222-2222-2222-222222222222", title: "" },
        { id: "33333333-3333-3333-3333-333333333333", title: "Control\u0007chars" },
        { id: "44444444-4444-4444-4444-444444444444", title: 12345 },
        "not an object",
        null
      ]
    }));
    const recovered = await main("tasks:list");
    assert.deepEqual(
      recovered.tasks.map((task) => task.title),
      ["Legitimate"],
      "invalid stored tasks were not discarded"
    );
    assert.equal(recovered.tasks[0].done, false);

    // A file that is not even the right shape degrades to an empty list rather
    // than breaking the app.
    fs.writeFileSync(path.join(workspace, "tasks.json"), JSON.stringify({ tasks: "nonsense" }));
    assert.deepEqual(await main("tasks:list"), { tasks: [] });

    /* ------------------------------------------------------- menu wiring */

    // Menu items raise events; the app turns them into actions.
    await store.write([], storeOptions);
    broadcasts.length = 0;
    await app._handleMenuCommand(app.mainWindow, { id: "view.refresh" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(broadcasts.length, 1, "the refresh menu item did not broadcast");

    let hideDone;
    app.mainWindow.emit = (eventName, payload) => {
      if (eventName === "view:hide-done") hideDone = payload;
      return app.mainWindow;
    };
    await app._handleMenuCommand(app.mainWindow, { id: "view.hide-done", checked: true });
    assert.deepEqual(hideDone, { hidden: true });

    /* ---------------------------------------------------------- shutdown */

    app.quit();
    assert.equal(app.isQuitting, true);
    assert.deepEqual(app.windows, []);
    assert.equal(quickAdd.lifecycleState, "disposed");
    assert.equal(app.mainWindow.lifecycleState, "disposed");
  } finally {
    console.error = originalConsoleError;
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  console.log("Tasks example integration test passed.");
}

main().catch((error) => {
  fs.rmSync(workspace, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
