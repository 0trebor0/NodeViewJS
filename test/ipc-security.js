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

let depth = "leaf";
for (let index = 0; index < ipc.IPC_MAX_DEPTH; index += 1) depth = [depth];
assert.equal(ipc.isSafePayload(depth), true);
depth = [depth];
assert.equal(ipc.isSafePayload(depth), false);
assert.equal(ipc.isSafePayload(new Array(ipc.IPC_MAX_NODES).fill(null)), false);

const oversized = ipc.createEventMessage("large", "x".repeat(ipc.IPC_MAX_SERIALIZED_BYTES));
assert.throws(() => ipc.serialize(oversized), /size limit/);
assert.throws(() => ipc.createEventMessage("bad name"), /invalid/);
assert.throws(() => ipc.createResponseMessage(0, true, null), /id/);

let seed = 0x12345678;
for (let index = 0; index < 500; index += 1) {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  const sample = String.fromCharCode(seed & 0xffff).repeat(seed % 128);
  assert.doesNotThrow(() => ipc.parseMessage(sample));
}

console.log("IPC security unit test passed.");
