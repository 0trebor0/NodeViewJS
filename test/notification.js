"use strict";

const assert = require("node:assert/strict");

const { App } = require("../runtime/app");
const { normalizeNotificationOptions } = require("../runtime/notification");

assert.deepEqual(normalizeNotificationOptions({ message: "Ready" }), {
  title: "NodeViewJS",
  message: "Ready"
});
assert.deepEqual(normalizeNotificationOptions({ title: "My App", message: "Done" }), {
  title: "My App",
  message: "Done"
});
assert.throws(() => normalizeNotificationOptions(null), /must be an object/);
assert.throws(() => normalizeNotificationOptions({ message: 1 }), /must be a string/);
assert.throws(() => normalizeNotificationOptions({ title: "", message: "Done" }), /non-empty/);
assert.throws(() => normalizeNotificationOptions({ title: "x".repeat(64), message: "Done" }), /at most 63/);
assert.throws(() => normalizeNotificationOptions({ title: "My\nApp", message: "Done" }), /at most 63/);
assert.throws(() => normalizeNotificationOptions({ message: " " }), /non-empty/);
assert.throws(() => normalizeNotificationOptions({ message: "x".repeat(256) }), /at most 255/);
assert.throws(() => normalizeNotificationOptions({ message: "Ready\0hidden" }), /at most 255/);

const app = new App({ entry: __filename });
assert.throws(
  () => app.showNotification({ title: "Test", message: "Not open" }),
  /has not been opened/
);

console.log("Notification API tests passed.");
