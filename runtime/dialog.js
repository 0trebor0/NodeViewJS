"use strict";

let nativeAddon;

function native() {
  nativeAddon ??= require("./native");
  return nativeAddon;
}

function message(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Dialog options must be an object.");
  }
  if (typeof options.message !== "string") {
    throw new TypeError("Dialog message must be a string.");
  }

  native().showMessageDialog({
    title: options.title ?? "NodeViewJS",
    message: options.message
  });
}

function openFile() {
  return native().openFileDialog();
}

function saveFile() {
  return native().saveFileDialog();
}

module.exports = { message, openFile, saveFile };
