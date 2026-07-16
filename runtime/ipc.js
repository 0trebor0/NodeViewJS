"use strict";

const IPC_VERSION = 1;
const IPC_MAX_SERIALIZED_BYTES = 256 * 1024;
const IPC_MAX_DEPTH = 32;
const IPC_MAX_NODES = 10_000;
const IPC_MAX_NAME_LENGTH = 128;
const IPC_MAX_CONCURRENT_REQUESTS = 64;
const IPC_MAX_COMPLETED_REQUEST_IDS = 1_024;
const IPC_REQUEST_TIMEOUT_MS = 30_000;
const IPC_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function safeIsArray(value) {
  try {
    return Array.isArray(value);
  } catch {
    return undefined;
  }
}

function safeGetPrototypeOf(value) {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    return undefined;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const isArray = safeIsArray(value);
  if (isArray !== false) return false;
  const prototype = safeGetPrototypeOf(value);
  if (prototype === undefined) return false;
  return prototype === Object.prototype || prototype === null;
}

function isValidName(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= IPC_MAX_NAME_LENGTH
    && IPC_NAME_PATTERN.test(value);
}

function safeEntries(value) {
  try {
    return Object.entries(value);
  } catch {
    return undefined;
  }
}

function safeArrayValues(value) {
  const values = [];
  try {
    const length = value.length;
    if (!Number.isSafeInteger(length) || length > IPC_MAX_NODES) {
      return undefined;
    }
    for (let index = 0; index < length; index += 1) {
      values.push(value[index]);
    }
  } catch {
    return undefined;
  }
  return values;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function safeString(value) {
  try {
    return String(value);
  } catch {
    return "Unknown IPC error.";
  }
}

function hasExactKeys(value, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  let keys;
  try {
    keys = Object.keys(value);
  } catch {
    return false;
  }
  try {
    return required.every((key) => Object.hasOwn(value, key))
      && keys.every((key) => allowed.has(key));
  } catch {
    return false;
  }
}

function isSafePayload(value) {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > IPC_MAX_NODES || current.depth > IPC_MAX_DEPTH) return false;

    const type = typeof current.value;
    if (current.value === null || type === "string" || type === "boolean") continue;
    if (type === "number") {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (type !== "object") return false;

    const isArray = safeIsArray(current.value);
    if (isArray === undefined) return false;
    if (isArray) {
      const values = safeArrayValues(current.value);
      if (!values) return false;
      for (const child of values) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    if (!isPlainObject(current.value)) return false;
    const entries = safeEntries(current.value);
    if (!entries) return false;
    for (const [key, child] of entries) {
      if (DANGEROUS_KEYS.has(key)) return false;
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }

  return true;
}

function parseMessage(serializedMessage) {
  if (typeof serializedMessage !== "string"
      || Buffer.byteLength(serializedMessage, "utf8") > IPC_MAX_SERIALIZED_BYTES) {
    return undefined;
  }

  let message;
  try {
    message = JSON.parse(serializedMessage);
  } catch {
    return undefined;
  }

  if (!isPlainObject(message) || message.version !== IPC_VERSION || !isSafePayload(message)) {
    return undefined;
  }

  if (message.type === "invoke") {
    if (!hasExactKeys(message, ["version", "type", "id", "command"], ["payload"])) return undefined;
    if (!Number.isSafeInteger(message.id) || message.id <= 0 || !isValidName(message.command)) return undefined;
    return message;
  }

  if (message.type === "event") {
    if (!hasExactKeys(message, ["version", "type", "event"], ["payload"])) return undefined;
    if (!isValidName(message.event)) return undefined;
    return message;
  }

  return undefined;
}

function createEventMessage(eventName, payload) {
  if (!isValidName(eventName)) throw new TypeError("IPC event name is invalid.");
  const message = { version: IPC_VERSION, type: "event", event: eventName };
  if (payload !== undefined) message.payload = payload;
  return message;
}

function createResponseMessage(id, ok, resultOrError) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("IPC response id is invalid.");
  if (typeof ok !== "boolean") throw new TypeError("IPC response status is invalid.");
  if (!ok) {
    return { version: IPC_VERSION, type: "response", id, ok, error: safeString(resultOrError) };
  }
  const message = { version: IPC_VERSION, type: "response", id, ok };
  if (resultOrError !== undefined) message.result = resultOrError;
  return message;
}

function serialize(message) {
  if (!isSafePayload(message)) throw new TypeError("IPC message contains an unsupported payload.");
  const serialized = safeStringify(message);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > IPC_MAX_SERIALIZED_BYTES) {
    throw new RangeError("IPC message exceeds the serialized size limit.");
  }
  let snapshot;
  try {
    snapshot = JSON.parse(serialized);
  } catch {
    throw new TypeError("IPC message changed during serialization.");
  }
  if (!isSafePayload(snapshot)) {
    throw new TypeError("IPC message changed to an unsupported payload during serialization.");
  }
  return serialized;
}

module.exports = {
  IPC_VERSION,
  IPC_MAX_SERIALIZED_BYTES,
  IPC_MAX_DEPTH,
  IPC_MAX_NODES,
  IPC_MAX_NAME_LENGTH,
  IPC_MAX_CONCURRENT_REQUESTS,
  IPC_MAX_COMPLETED_REQUEST_IDS,
  IPC_REQUEST_TIMEOUT_MS,
  isSafePayload,
  isValidName,
  parseMessage,
  createEventMessage,
  createResponseMessage,
  serialize
};
