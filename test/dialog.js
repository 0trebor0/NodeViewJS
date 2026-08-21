"use strict";

const assert = require("node:assert/strict");
const dialog = require("../runtime/dialog");

// Every case here is rejected before the native layer is reached, so no test
// opens a real dialog.
assert.deepEqual(Object.keys(dialog).sort(), ["message", "openDirectory", "openFile", "saveFile"]);

assert.throws(() => dialog.message(null), /Dialog options must be an object/);
assert.throws(() => dialog.message([]), /Dialog options must be an object/);
assert.throws(() => dialog.message({}), /Dialog message must be a string/);

assert.throws(() => dialog.openFile(null), /Dialog options must be an object/);
assert.throws(() => dialog.openFile([]), /Dialog options must be an object/);
assert.throws(() => dialog.openFile("multiple"), /Dialog options must be an object/);
assert.throws(() => dialog.openFile({ filters: ["*.txt"] }), /Unsupported dialog option: filters/);
assert.throws(() => dialog.openFile({ multiple: "yes" }), /Dialog multiple must be a boolean/);
assert.throws(() => dialog.openFile({ multiple: 1 }), /Dialog multiple must be a boolean/);

// Rejected values are quoted in the error, so the quote stays bounded.
const longOption = "x".repeat(5000);
assert.throws(
  () => dialog.openFile({ [longOption]: true }),
  (error) => error.message.length < 400 && /\(5000 characters\)/.test(error.message)
);

console.log("Dialog API tests passed.");
