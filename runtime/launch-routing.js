"use strict";

const path = require("node:path");

const { assertDenseArray, safeDiagnosticString } = require("./validation");

const PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]{1,31}$/;
const EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9-]{0,15}$/;
const RESERVED_PROTOCOLS = new Set(["file", "http", "https", "mailto"]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

function safeObjectKeys(value) {
  try {
    return Object.keys(value);
  } catch {
    return undefined;
  }
}

function parseArrayEnvironment(name, environment) {
  const value = environment[name];
  if (value === undefined || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("value is not an array");
    return parsed;
  } catch (error) {
    throw new TypeError(`${name} must contain a valid JSON array: ${error.message}`);
  }
}

function normalizeProtocols(value = []) {
  assertDenseArray(value, "App protocols");
  const seen = new Set();
  return value.map((item) => {
    const options = typeof item === "string" ? { scheme: item } : item;
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Each app protocol must be a scheme string or options object.");
    }
    const keys = safeObjectKeys(options);
    if (!keys) throw new TypeError("App protocol options object could not be inspected.");
    const unknownKey = keys.find((key) => !["scheme", "name"].includes(key));
    if (unknownKey) {
      throw new TypeError(`Unsupported protocol option: ${safeDiagnosticString(unknownKey)}`);
    }
    const scheme = typeof options.scheme === "string" ? options.scheme.toLowerCase() : "";
    if (!PROTOCOL_PATTERN.test(scheme) || RESERVED_PROTOCOLS.has(scheme)) {
      throw new TypeError(`Unsupported custom protocol scheme: ${safeDiagnosticString(options.scheme)}`);
    }
    if (seen.has(scheme)) throw new TypeError(`Duplicate custom protocol scheme: ${scheme}`);
    seen.add(scheme);
    const name = options.name ?? `${scheme} URL`;
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 100 ||
        CONTROL_CHARACTER_PATTERN.test(name)) {
      throw new TypeError(`Protocol '${scheme}' name must be between 1 and 100 characters.`);
    }
    return Object.freeze({ scheme, name: name.trim() });
  });
}

function normalizeFileAssociations(value = []) {
  assertDenseArray(value, "App fileAssociations");
  const seen = new Set();
  return value.map((item) => {
    const options = typeof item === "string" ? { extension: item } : item;
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Each file association must be an extension string or options object.");
    }
    const keys = safeObjectKeys(options);
    if (!keys) throw new TypeError("File association options object could not be inspected.");
    const unknownKey = keys.find((key) => !["extension", "name"].includes(key));
    if (unknownKey) {
      throw new TypeError(`Unsupported file association option: ${safeDiagnosticString(unknownKey)}`);
    }
    const extension = typeof options.extension === "string"
      ? options.extension.toLowerCase()
      : "";
    if (!EXTENSION_PATTERN.test(extension)) {
      throw new TypeError(`Unsupported file association extension: ${safeDiagnosticString(options.extension)}`);
    }
    if (seen.has(extension)) throw new TypeError(`Duplicate file association extension: ${extension}`);
    seen.add(extension);
    const name = options.name ?? `${extension.slice(1).toUpperCase()} file`;
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 100 ||
        CONTROL_CHARACTER_PATTERN.test(name)) {
      throw new TypeError(`File association '${extension}' name must be between 1 and 100 characters.`);
    }
    return Object.freeze({ extension, name: name.trim() });
  });
}

function resolveLaunchConfiguration(options, environment = process.env) {
  return Object.freeze({
    protocols: Object.freeze(normalizeProtocols(
      options.protocols ?? parseArrayEnvironment("NODEVIEW_PROTOCOLS", environment)
    )),
    fileAssociations: Object.freeze(normalizeFileAssociations(
      options.fileAssociations ?? parseArrayEnvironment("NODEVIEW_FILE_ASSOCIATIONS", environment)
    ))
  });
}

function findLaunchTargets(args, cwd, configuration) {
  if (!Array.isArray(args) || !args.every((value) => typeof value === "string")) {
    throw new TypeError("Launch arguments must be an array of strings.");
  }
  if (args.some((value) => value.trim() !== value || CONTROL_CHARACTER_PATTERN.test(value))) {
    throw new TypeError("Launch arguments must not contain leading, trailing, or control whitespace.");
  }
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new TypeError("Launch working directory must be a non-empty string.");
  }
  if (CONTROL_CHARACTER_PATTERN.test(cwd)) {
    throw new TypeError("Launch working directory must not contain control characters.");
  }
  const protocols = new Set(configuration.protocols.map(({ scheme }) => `${scheme}:`));
  const extensions = new Set(configuration.fileAssociations.map(({ extension }) => extension));
  const targets = [];

  for (const argument of args) {
    try {
      const url = new URL(argument);
      if (protocols.has(url.protocol.toLowerCase())) {
        targets.push({ type: "open-url", value: url.href });
        continue;
      }
    } catch {}

    if (argument.startsWith("-")) continue;
    const extension = path.extname(argument).toLowerCase();
    if (extensions.has(extension)) {
      targets.push({ type: "open-file", value: path.resolve(cwd, argument) });
    }
  }
  return targets;
}

module.exports = {
  findLaunchTargets,
  normalizeFileAssociations,
  normalizeProtocols,
  resolveLaunchConfiguration
};
