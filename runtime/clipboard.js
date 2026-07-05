"use strict";

let nativeAddon;

function native() {
  if (process.platform !== "win32") {
    throw new Error("The NodeViewJS clipboard API is currently available only on Windows.");
  }
  nativeAddon ??= require("./native");
  return nativeAddon;
}

function readText() {
  return native().readClipboardText();
}

function writeText(value) {
  if (typeof value !== "string") {
    throw new TypeError("Clipboard text must be a string.");
  }
  if (value.includes("\0")) {
    throw new TypeError("Clipboard text must not contain null characters.");
  }
  return native().writeClipboardText(value);
}

module.exports = { readText, writeText };
