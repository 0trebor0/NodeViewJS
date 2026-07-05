"use strict";

let nativeAddon;

function native() {
  nativeAddon ??= require("./native");
  return nativeAddon;
}

function show(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Notification options must be an object.");
  }
  if (typeof options.message !== "string") {
    throw new TypeError("Notification message must be a string.");
  }

  native().showNotification({
    title: options.title ?? "NodeViewJS",
    message: options.message
  });
}

module.exports = { show };
