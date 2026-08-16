"use strict";

const assert = require("node:assert/strict");
const {
  normalizeAccelerator,
  normalizeContextPosition,
  normalizeMenuTemplate,
  normalizeTrayMenuTemplate
} = require("../runtime/menu");

assert.deepEqual(normalizeAccelerator("control+shift+s"), {
  display: "Ctrl+Shift+S",
  keyCode: 0x53,
  ctrl: true,
  alt: false,
  shift: true
});
assert.deepEqual(normalizeAccelerator("F12"), {
  display: "F12",
  keyCode: 0x7b,
  ctrl: false,
  alt: false,
  shift: false
});

const template = normalizeMenuTemplate([
  {
    label: "File",
    submenu: [
      { id: "file.open", label: "Open", accelerator: "Ctrl+O" },
      { type: "separator" },
      { id: "file.autosave", label: "Auto save", type: "checkbox", checked: true }
    ]
  },
  { id: "help", label: "Help", enabled: false }
]);
assert.equal(template[0].type, "submenu");
assert.equal(template[0].submenu[0].accelerator.display, "Ctrl+O");
assert.equal(template[0].submenu[2].checked, true);
assert.equal(Object.isFrozen(template), true);
assert.equal(normalizeMenuTemplate(null, { allowNull: true }), null);
assert.equal(normalizeTrayMenuTemplate(null, { allowNull: true }), null);
assert.equal(normalizeTrayMenuTemplate([{ id: "show", label: "Show" }])[0].id, "show");
assert.deepEqual(normalizeContextPosition(), {});
assert.deepEqual(normalizeContextPosition({ x: 10, y: -5 }), { x: 10, y: -5 });

assert.throws(() => normalizeAccelerator("A"), /require Ctrl, Alt, or Shift/);
assert.throws(() => normalizeAccelerator("Ctrl+Ctrl+A"), /Duplicate accelerator modifier/);
assert.throws(() => normalizeAccelerator("Ctrl+Unknown"), /Unsupported menu accelerator key/);
assert.throws(() => normalizeMenuTemplate({}), /must be an array/);
assert.throws(
  () => normalizeTrayMenuTemplate([{ id: "show", label: "Show", accelerator: "Ctrl+S" }]),
  /cannot use accelerators/
);
assert.throws(() => normalizeMenuTemplate([]), /at least one item/);
assert.throws(() => normalizeContextPosition({ x: 1 }), /requires both x and y/);
assert.throws(() => normalizeContextPosition({ x: 1, y: 2, screen: true }), /Unsupported context/);
assert.throws(() => normalizeMenuTemplate([{ type: "separator", label: "bad" }]), /cannot have additional/);
assert.throws(() => normalizeMenuTemplate([{ label: "Missing id" }]), /require a valid id/);
assert.throws(
  () => normalizeMenuTemplate([{ id: "one", label: "One" }, { id: "one", label: "Two" }]),
  /Duplicate menu item id/
);
assert.throws(
  () => normalizeMenuTemplate([
    { id: "one", label: "One", accelerator: "Ctrl+1" },
    { id: "two", label: "Two", accelerator: "control+1" }
  ]),
  /Duplicate menu accelerator/
);
assert.throws(
  () => normalizeMenuTemplate([{ label: "Bad", submenu: [], id: "bad" }]),
  /non-empty submenu/
);
assert.throws(
  () => normalizeMenuTemplate([{ id: "bad", label: "Bad", checked: true }]),
  /Only checkbox/
);

// Regression: Array.prototype.map skips holes, so a sparse template used to
// produce a menu whose items were never validated.
assert.throws(() => normalizeMenuTemplate(new Array(3)), /must not contain empty items/);
assert.throws(
  () => normalizeMenuTemplate([{ id: "ok", label: "Ok" }, , { id: "two", label: "Two" }]),
  /must not contain empty items/
);
assert.throws(
  () => normalizeMenuTemplate([{ label: "File", submenu: new Array(2) }]),
  /must not contain empty items/
);

// Regression: rejected values are quoted in the error, so the quote is bounded.
const longMenuOption = "x".repeat(5000);
assert.throws(
  () => normalizeMenuTemplate([{ id: "a", label: "A", [longMenuOption]: 1 }]),
  (error) => error.message.length < 400 && /\(5000 characters\)/.test(error.message)
);

console.log("Menu template test passed.");
