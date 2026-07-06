"use strict";

const assert = require("node:assert/strict");
const { normalizeWindowColors } = require("../runtime/window-colors");

assert.deepEqual(normalizeWindowColors({
  titleBar: "#112233",
  titleText: "#FFFFFF",
  border: "#AbCdEf"
}), {
  titleBar: 0x112233,
  titleText: 0xffffff,
  border: 0xabcdef
});
assert.deepEqual(normalizeWindowColors(null), {
  titleBar: null,
  titleText: null,
  border: null
});
assert.deepEqual(
  normalizeWindowColors({ titleBar: "#445566" }, {
    titleBar: 0x112233,
    titleText: 0xffffff,
    border: 0xabcdef
  }),
  { titleBar: 0x445566, titleText: 0xffffff, border: 0xabcdef }
);
assert.throws(() => normalizeWindowColors("#ffffff"), /object or null/);
assert.throws(() => normalizeWindowColors({ titleBar: "red" }), /#RRGGBB/);
assert.throws(() => normalizeWindowColors({ background: "#000000" }), /Unsupported/);

console.log("Window color tests passed.");
