"use strict";

const assert = require("node:assert/strict");
const ipc = require("../runtime/ipc");

function parse(value) {
  return ipc.parseMessage(JSON.stringify(value));
}

const invoke = {
  version: 1,
  type: "invoke",
  id: 1,
  command: "settings:read",
  payload: { section: "editor", values: [true, 3, null] }
};
assert.deepEqual(parse(invoke), invoke);
assert.deepEqual(parse({ version: 1, type: "event", event: "app.ready" }), {
  version: 1,
  type: "event",
  event: "app.ready"
});

for (const invalid of [
  { type: "invoke", id: 1, command: "valid" },
  { ...invoke, version: 2 },
  { ...invoke, extra: true },
  { ...invoke, id: 0 },
  { ...invoke, id: -1 },
  { ...invoke, id: Number.MAX_SAFE_INTEGER + 1 },
  { ...invoke, command: "invalid name" },
  { ...invoke, command: "a".repeat(ipc.IPC_MAX_NAME_LENGTH + 1) },
  { version: 1, type: "event", event: "bad/name" },
  { version: 1, type: "unknown" }
]) {
  assert.equal(parse(invalid), undefined);
}

assert.equal(ipc.parseMessage("{"), undefined);
assert.equal(ipc.parseMessage("null"), undefined);
assert.equal(ipc.parseMessage(JSON.stringify(invoke) + "x"), undefined);
assert.equal(ipc.parseMessage(JSON.stringify(invoke).padEnd(
  ipc.IPC_MAX_SERIALIZED_BYTES + 1,
  " "
)), undefined);
assert.equal(ipc.parseMessage(JSON.stringify({
  ...invoke,
  payload: "\u20ac".repeat(90_000)
})), undefined);

for (const key of ["__proto__", "constructor", "prototype"]) {
  const serialized = `{"version":1,"type":"invoke","id":2,"command":"valid","payload":{"${key}":{}}}`;
  assert.equal(ipc.parseMessage(serialized), undefined);
}

const throwingPayload = {};
Object.defineProperty(throwingPayload, "secret", {
  enumerable: true,
  get() {
    throw new Error("getter should not escape IPC validation");
  }
});
assert.equal(ipc.isSafePayload(throwingPayload), false);
assert.throws(
  () => ipc.serialize(ipc.createEventMessage("hostile", throwingPayload)),
  /unsupported payload/
);

const throwingArray = [];
Object.defineProperty(throwingArray, "0", {
  enumerable: true,
  get() {
    throw new Error("array getter should not escape IPC validation");
  }
});
assert.equal(ipc.isSafePayload(throwingArray), false);

const throwingLengthArray = new Proxy([], {
  get(target, property, receiver) {
    if (property === "length") {
      throw new Error("array length trap should not escape IPC validation");
    }
    return Reflect.get(target, property, receiver);
  }
});
assert.equal(ipc.isSafePayload(throwingLengthArray), false);

const throwingPrototype = new Proxy({}, {
  getPrototypeOf() {
    throw new Error("prototype trap should not escape IPC validation");
  }
});
assert.equal(ipc.isSafePayload(throwingPrototype), false);

const throwingKeys = new Proxy({}, {
  ownKeys() {
    throw new Error("ownKeys trap should not escape IPC validation");
  }
});
assert.equal(ipc.isSafePayload(throwingKeys), false);

const revoked = Proxy.revocable({}, {});
revoked.revoke();
assert.equal(ipc.isSafePayload(revoked.proxy), false);

let depth = "leaf";
for (let index = 0; index < ipc.IPC_MAX_DEPTH; index += 1) depth = [depth];
assert.equal(ipc.isSafePayload(depth), true);
depth = [depth];
assert.equal(ipc.isSafePayload(depth), false);
assert.equal(ipc.isSafePayload(new Array(ipc.IPC_MAX_NODES).fill(null)), false);
assert.equal(ipc.isSafePayload(new Array(ipc.IPC_MAX_NODES + 1)), false);

const throwingToJSON = { value: "safe" };
Object.defineProperty(throwingToJSON, "toJSON", {
  get() {
    throw new Error("toJSON getter should not escape IPC serialization");
  }
});
assert.throws(
  () => ipc.serialize(ipc.createEventMessage("hostile", throwingToJSON)),
  /size limit/
);

let changingReads = 0;
let unsafeAfterValidation = "leaf";
for (let index = 0; index <= ipc.IPC_MAX_DEPTH; index += 1) {
  unsafeAfterValidation = [unsafeAfterValidation];
}
const changingPayload = {};
Object.defineProperty(changingPayload, "value", {
  enumerable: true,
  get() {
    changingReads++;
    return changingReads === 1 ? "safe" : unsafeAfterValidation;
  }
});
assert.throws(
  () => ipc.serialize(ipc.createEventMessage("changing", changingPayload)),
  /changed to an unsupported payload/
);

const oversized = ipc.createEventMessage("large", "x".repeat(ipc.IPC_MAX_SERIALIZED_BYTES));
assert.throws(() => ipc.serialize(oversized), /size limit/);
assert.throws(() => ipc.createEventMessage("bad name"), /invalid/);
assert.throws(() => ipc.createResponseMessage(0, true, null), /id/);

const throwingStringError = {
  toString() {
    throw new Error("toString should not escape IPC error response creation");
  }
};
assert.deepEqual(ipc.createResponseMessage(3, false, throwingStringError), {
  version: 1,
  type: "response",
  id: 3,
  ok: false,
  error: "Unknown IPC error."
});

let seed = 0x12345678;
for (let index = 0; index < 500; index += 1) {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  const sample = String.fromCharCode(seed & 0xffff).repeat(seed % 128);
  assert.doesNotThrow(() => ipc.parseMessage(sample));
}

console.log("IPC security unit test passed.");
