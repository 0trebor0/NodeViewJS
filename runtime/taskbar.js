"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROGRESS_STATES = new Set(["normal", "paused", "error", "indeterminate"]);
const ATTENTION_TYPES = new Set(["informational", "critical", "stop"]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

function normalizeProgress(value, state = "normal") {
  if (value === null) return Object.freeze({ value: 0, state: "none" });
  if (typeof state !== "string" || !PROGRESS_STATES.has(state)) {
    throw new TypeError(`Unsupported taskbar progress state: ${String(state)}`);
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("Taskbar progress value must be a number between 0 and 1, or null.");
  }
  return Object.freeze({ value, state });
}

function normalizeOverlay(icon, description = "") {
  if (typeof description !== "string" || description.length > 100 ||
      CONTROL_CHARACTER_PATTERN.test(description)) {
    throw new TypeError("Taskbar overlay description must be a string of at most 100 characters.");
  }
  if (icon === null) return Object.freeze({ icon: null, description: "" });
  if (typeof icon !== "string" || icon.trim().length === 0) {
    throw new TypeError("Taskbar overlay icon must be a non-empty .ico path or null.");
  }
  const resolved = path.resolve(icon);
  if (path.extname(resolved).toLowerCase() !== ".ico") {
    throw new TypeError("Taskbar overlay icon must use the .ico format.");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Taskbar overlay icon was not found: ${resolved}`);
  }
  return Object.freeze({ icon: resolved, description });
}

function normalizeAttentionType(value = "informational") {
  if (typeof value !== "string" || !ATTENTION_TYPES.has(value)) {
    throw new TypeError(`Unsupported window attention type: ${String(value)}`);
  }
  return value;
}

module.exports = { normalizeAttentionType, normalizeOverlay, normalizeProgress };
