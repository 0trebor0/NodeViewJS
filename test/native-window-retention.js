"use strict";

// Proves that closing a window releases it on the native side too.
//
// The JS-side fix removes a closed window from app.windows; this covers the
// other half. NodeViewJSRuntime::OnWindowDestroyed runs from inside the
// window's own WM_DESTROY handling, so the object cannot be erased there
// without freeing it under its own feet. It is queued instead and released by
// the next message pump, which is what this test observes.
//
// It opens real native windows, so it needs an interactive desktop session.

const assert = require("node:assert/strict");
const path = require("node:path");

const { App } = require("../runtime");
const native = require("../runtime/native");
const { runWithTemporaryWebViewProfile } = require("./temporary-webview-profile");

runWithTemporaryWebViewProfile("nodeviewjs-retention-", 60_000);

const TRANSIENT_WINDOWS = 40;

assert.equal(typeof native.getWindowCounts, "function", "the diagnostics binding is missing");

const app = new App({
  title: "NodeViewJS Retention Test",
  entry: path.join(__dirname, "fixtures", "bridge.html")
});

const timeout = setTimeout(() => {
  console.error("Native window retention test timed out.");
  process.exit(1);
}, 45_000);

// Lets the uv timer fire, which is where the purge happens.
function pump(ms = 60) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  assert.equal(app.run(), true);
  await pump();

  const baseline = native.getWindowCounts();
  assert.equal(baseline.live, 1, "the main window should be the only live window");
  assert.equal(baseline.tracked, 1, `expected one tracked window, saw ${baseline.tracked}`);

  // Churn: open and close transient windows the way a document-per-window app
  // would. Before the fix, `tracked` grew by one for every window ever opened
  // and never came back down.
  for (let index = 0; index < TRANSIENT_WINDOWS; index += 1) {
    const transient = app.createWindow({ title: `Transient ${index}` });
    transient.close();
    if (index % 8 === 0) await pump(20);
  }
  await pump(250);

  const afterChurn = native.getWindowCounts();
  assert.equal(afterChurn.live, 1, `expected one live window, saw ${afterChurn.live}`);
  assert.equal(
    afterChurn.pendingRemoval,
    0,
    `queued windows were never purged: ${afterChurn.pendingRemoval}`
  );
  assert.equal(
    afterChurn.tracked,
    1,
    `native windows accumulated: ${afterChurn.tracked} tracked after `
      + `${TRANSIENT_WINDOWS} transient windows (expected 1)`
  );

  // The surviving window still works after all that churn.
  assert.equal(app.mainWindow.isOpen, true);
  assert.equal(typeof app.mainWindow.getState().isOpen, "boolean");

  // Closing an already purged window is a no-op rather than an error: ids are
  // handed out in order, so a stale id is recognised as closed, not unknown.
  const purged = app.createWindow({ title: "Purged" });
  const purgedId = purged.id;
  purged.close();
  await pump(200);
  assert.equal(native.getWindowCounts().tracked, 1);
  native.closeWindow(purgedId);
  // An id that was never handed out is still an error.
  assert.throws(() => native.closeWindow(purgedId + 10_000), /Unknown window id/);

  clearTimeout(timeout);
  app.quit();

  const afterQuit = native.getWindowCounts();
  assert.equal(afterQuit.live, 0, "windows remained live after quit");
  assert.equal(afterQuit.tracked, 0, `windows remained tracked after quit: ${afterQuit.tracked}`);

  console.log(
    `Native window retention test passed (${TRANSIENT_WINDOWS} transient windows, `
      + `${afterQuit.tracked} retained).`
  );
  process.exit(0);
}

main().catch((error) => {
  clearTimeout(timeout);
  console.error(error);
  process.exit(1);
});
