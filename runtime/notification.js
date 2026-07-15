"use strict";

let nativeAddon;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

function native() {
  nativeAddon ??= require("./native");
  return nativeAddon;
}

function normalizeNotificationOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Notification options must be an object.");
  }
  if (typeof options.message !== "string") {
    throw new TypeError("Notification message must be a string.");
  }
  const title = options.title ?? "NodeViewJS";
  if (typeof title !== "string" || title.trim().length === 0 || title.length > 63 ||
      CONTROL_CHARACTER_PATTERN.test(title)) {
    throw new TypeError("Notification title must be a non-empty string of at most 63 characters.");
  }
  if (options.message.trim().length === 0 || options.message.length > 255 ||
      CONTROL_CHARACTER_PATTERN.test(options.message)) {
    throw new TypeError("Notification message must be a non-empty string of at most 255 characters.");
  }
  return Object.freeze({ title, message: options.message });
}

function show(options = {}) {
  native().showNotification(normalizeNotificationOptions(options));
}

module.exports = { normalizeNotificationOptions, show };
