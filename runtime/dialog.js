"use strict";

const { safeDiagnosticString } = require("./validation");

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

function openFile(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Dialog options must be an object.");
  }
  const unknown = Object.keys(options).find((key) => key !== "multiple");
  if (unknown) throw new TypeError(`Unsupported dialog option: ${safeDiagnosticString(unknown)}`);
  if (options.multiple !== undefined && typeof options.multiple !== "boolean") {
    throw new TypeError("Dialog multiple must be a boolean.");
  }

  if (!options.multiple) return native().openFileDialog();
  if (typeof native().openMultipleFilesDialog !== "function") {
    throw new Error("Selecting multiple files is currently available only on Windows.");
  }
  return native().openMultipleFilesDialog();
}

function openDirectory() {
  if (typeof native().openDirectoryDialog !== "function") {
    throw new Error("Directory dialogs are currently available only on Windows.");
  }
  return native().openDirectoryDialog();
}

function saveFile() {
  return native().saveFileDialog();
}

module.exports = { message, openDirectory, openFile, saveFile };
