"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const MAX_FILE_NAME_LENGTH = 255;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

function resolveConfigDirectory(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Config options must be an object.");
  }

  if (options.directory !== undefined) {
    if (typeof options.directory !== "string" || options.directory.length === 0) {
      throw new TypeError("Config directory must be a non-empty string.");
    }
    if (CONTROL_CHARACTER_PATTERN.test(options.directory)) {
      throw new TypeError("Config directory must not contain control characters.");
    }
    return path.resolve(options.directory);
  }

  const appName = options.appName ?? "NodeViewJS";
  if (typeof appName !== "string" || appName.length === 0) {
    throw new TypeError("Config appName must be a non-empty string.");
  }
  if (CONTROL_CHARACTER_PATTERN.test(appName)) {
    throw new TypeError("Config appName must not contain control characters.");
  }

  const baseDirectory = process.env.APPDATA || path.join(os.homedir(), ".config");
  return path.join(baseDirectory, appName);
}

function resolveConfigPath(options = {}) {
  const fileName = options.fileName ?? "config.json";
  if (typeof fileName !== "string" || fileName.length === 0) {
    throw new TypeError("Config fileName must be a non-empty string.");
  }
  if (CONTROL_CHARACTER_PATTERN.test(fileName)) {
    throw new TypeError("Config fileName must not contain control characters.");
  }
  // Without this the name reaches the filesystem and fails as ENOENT, which
  // reads as a missing directory rather than an over-long file name.
  if (fileName.length > MAX_FILE_NAME_LENGTH) {
    throw new TypeError(
      `Config fileName must be at most ${MAX_FILE_NAME_LENGTH} characters.`
    );
  }
  if (fileName !== path.basename(fileName)) {
    throw new TypeError("Config fileName must not include directories.");
  }
  if (path.extname(fileName).toLowerCase() !== ".json") {
    throw new TypeError("Config fileName must end with .json.");
  }

  return path.join(resolveConfigDirectory(options), fileName);
}

async function read(options = {}) {
  const configPath = resolveConfigPath(options);
  const defaults = options.defaults ?? {};

  try {
    const contents = await fs.readFile(configPath, "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return defaults;
    }
    throw error;
  }
}

async function write(options = {}) {
  if (!Object.hasOwn(options, "data")) {
    throw new TypeError("Config write requires a data value.");
  }

  const configPath = resolveConfigPath(options);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(options.data, null, 2)}\n`, "utf8");
  return options.data;
}

module.exports = {
  read,
  resolveConfigDirectory,
  resolveConfigPath,
  write
};
