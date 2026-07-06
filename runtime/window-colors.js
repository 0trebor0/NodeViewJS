"use strict";

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const COLOR_KEYS = ["titleBar", "titleText", "border"];

function normalizeWindowColors(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null) value = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Window colors must be an object or null.");
  }
  const unknown = Object.keys(value).find((key) => !COLOR_KEYS.includes(key));
  if (unknown) throw new TypeError(`Unsupported window color option: ${unknown}`);

  const result = {};
  for (const key of COLOR_KEYS) {
    const color = value[key] ?? null;
    if (color !== null && (typeof color !== "string" || !COLOR_PATTERN.test(color))) {
      throw new TypeError(`Window ${key} color must use #RRGGBB format or be null.`);
    }
    result[key] = color === null ? null : Number.parseInt(color.slice(1), 16);
  }
  return Object.freeze(result);
}

module.exports = { normalizeWindowColors };
