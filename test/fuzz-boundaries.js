"use strict";

// Systematic malformed-input coverage for the validators that sit on a trust
// boundary. This is not a fuzzing framework: it is a seeded, structure-aware
// mutator plus a set of properties every validator must hold, whatever it is
// handed.
//
// The properties are:
//
//   1. Total          - the call returns or throws; it never leaves the process.
//   2. Typed failure  - a rejection is an Error, never a string, object, or
//                       undefined, so callers can report it.
//   3. No pollution   - no input can reach Object.prototype or Array.prototype.
//   4. Sound output   - whatever is accepted satisfies that validator's own
//                       contract, checked by an invariant per target.
//
// The seed is printed on every run and can be pinned with NODEVIEW_FUZZ_SEED,
// so a failure is reproducible.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ipc = require("../runtime/ipc");
const config = require("../runtime/config");
const net = require("../runtime/net");
const { App } = require("../runtime/app");
const {
  findLaunchTargets,
  normalizeFileAssociations,
  normalizeProtocols,
  resolveLaunchConfiguration
} = require("../runtime/launch-routing");
const {
  normalizeAccelerator,
  normalizeContextPosition,
  normalizeMenuTemplate,
  normalizeTrayMenuTemplate
} = require("../runtime/menu");
const { normalizeNotificationOptions } = require("../runtime/notification");
const { normalizeAttentionType, normalizeOverlay, normalizeProgress } = require("../runtime/taskbar");
const { normalizeWindowColors } = require("../runtime/window-colors");
const { validateManifest } = require("../runtime/updater");
const { parseIntegrityManifest, serializeIntegrityManifest } = require("../scripts/package-integrity");

const ITERATIONS = Number.parseInt(process.env.NODEVIEW_FUZZ_ITERATIONS ?? "400", 10);
const seed = Number.parseInt(process.env.NODEVIEW_FUZZ_SEED ?? "", 10) || 0x9e3779b9;

// mulberry32: small, deterministic, and good enough to spread mutations.
function createRandom(state) {
  let value = state >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(seed);

function pick(values) {
  return values[Math.floor(random() * values.length) % values.length];
}

function throwingGetterObject() {
  const value = {};
  Object.defineProperty(value, "label", {
    enumerable: true,
    get() { throw new Error("hostile getter"); }
  });
  return value;
}

function cyclicObject() {
  const value = { name: "cycle" };
  value.self = value;
  return value;
}

function unstableObject() {
  // Returns a different value on each read, to catch validators that check one
  // snapshot and then use another.
  let reads = 0;
  return {
    get id() {
      reads += 1;
      return reads > 1 ? "mutated" : "stable";
    }
  };
}

const HOSTILE_SCALARS = [
  undefined, null, true, false, 0, -0, 1, -1, NaN, Infinity, -Infinity,
  Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER,
  0.1, 1e308, -1e308,
  "", " ", "\u0000", "\u0000embedded", "\r\n", "\u202E", "\u001B[31m",
  "../../etc/passwd", "..\\..\\windows\\system32", "C:\\absolute\\path",
  "\\\\server\\share", "file:///etc/passwd", "https://user:pass@example.com",
  "a".repeat(1024), "a".repeat(70000), "\uD83D\uDCA9", "\uD800", "e\u0301".repeat(200),
  "__proto__", "constructor", "prototype", "toString", "valueOf",
  "CON", "NUL", "COM1", ".", "..", "/", "\\",
  Symbol("hostile"), 10n, () => {}, Symbol.iterator
];

const HOSTILE_CONTAINERS = [
  () => ({}),
  () => [],
  () => Object.create(null),
  () => ({ __proto__: { polluted: true } }),
  () => JSON.parse('{"__proto__": {"polluted": true}}'),
  () => ({ constructor: { prototype: { polluted: true } } }),
  () => new Array(5),
  () => [undefined, null],
  () => new Date(),
  () => Buffer.from("bytes"),
  () => new Map(),
  () => new Set(),
  () => /regex/,
  () => new Error("hostile"),
  () => Promise.resolve(1),
  () => cyclicObject(),
  () => throwingGetterObject(),
  () => unstableObject(),
  () => new Proxy({}, { get() { throw new Error("hostile proxy"); } }),
  () => ({ length: 2 ** 32 }),
  () => Object.freeze({ frozen: true })
];

function hostileValue(depth = 0) {
  if (depth > 3 || random() < 0.55) {
    return pick(HOSTILE_SCALARS);
  }
  if (random() < 0.5) {
    return pick(HOSTILE_CONTAINERS)();
  }
  if (random() < 0.5) {
    const length = Math.floor(random() * 4);
    return Array.from({ length }, () => hostileValue(depth + 1));
  }
  const value = {};
  const keys = Math.floor(random() * 4);
  for (let index = 0; index < keys; index += 1) {
    const key = random() < 0.25
      ? pick(["__proto__", "constructor", "prototype", "", "0", "length"])
      : `key${Math.floor(random() * 6)}`;
    try {
      value[key] = hostileValue(depth + 1);
    } catch {
      // Assigning __proto__ a primitive is a silent no-op; a getter can throw.
    }
  }
  return value;
}

// Structure-aware mutation: start from something valid and break one thing, so
// the input keeps reaching deep into the validator instead of being rejected by
// the first type check.
function mutate(seedValue, depth = 0) {
  if (depth > 4) return hostileValue();
  const roll = random();

  if (roll < 0.12) return hostileValue();

  if (Array.isArray(seedValue)) {
    const copy = seedValue.map((item) => (random() < 0.4 ? mutate(item, depth + 1) : item));
    if (random() < 0.2) copy.push(hostileValue(depth + 1));
    if (random() < 0.15) copy.length = 0;
    if (random() < 0.1) return Array.from({ length: 600 }, () => copy[0] ?? hostileValue(depth + 1));
    if (random() < 0.1 && copy.length > 0) copy.splice(Math.floor(random() * copy.length), 1);
    return copy;
  }

  if (seedValue && typeof seedValue === "object") {
    const copy = {};
    for (const [key, value] of Object.entries(seedValue)) {
      if (random() < 0.15) continue;                    // drop a required key
      copy[key] = random() < 0.45 ? mutate(value, depth + 1) : value;
    }
    if (random() < 0.25) copy[`extra${Math.floor(random() * 4)}`] = hostileValue(depth + 1);
    if (random() < 0.1) copy.__proto__ = { polluted: true };
    if (random() < 0.08) {
      // Deep nesting, to exercise depth limits.
      let nested = copy;
      for (let index = 0; index < 40; index += 1) nested = { child: nested };
      return nested;
    }
    return copy;
  }

  if (typeof seedValue === "string") {
    const mutations = [
      // Identity keeps the valid input in the stream, so targets whose every
      // corruption is fatal — the text parsers — still exercise their accept
      // path and have their invariants checked.
      () => seedValue,
      () => "",
      () => `${seedValue}\u0000`,
      () => `${seedValue}${pick(["\r\n", "\u202E", "\u001B", "\t", " "])}`,
      () => seedValue.repeat(3000),
      () => seedValue.slice(0, Math.floor(random() * seedValue.length)),
      () => seedValue.toUpperCase(),
      () => `../${seedValue}`,
      () => pick(HOSTILE_SCALARS)
    ];
    return pick(mutations)();
  }

  if (typeof seedValue === "number") {
    return pick([NaN, Infinity, -Infinity, -1, 0, 2 ** 53, -(2 ** 53), 1.5, "1", null]);
  }

  return hostileValue(depth + 1);
}

// Property 3 needs a witness that survives the whole run.
const prototypeKeys = Object.getOwnPropertyNames(Object.prototype).sort().join(",");
const arrayPrototypeKeys = Object.getOwnPropertyNames(Array.prototype).sort().join(",");

function assertPrototypesIntact(label) {
  assert.equal(
    Object.getOwnPropertyNames(Object.prototype).sort().join(","),
    prototypeKeys,
    `${label} added a property to Object.prototype`
  );
  assert.equal(
    Object.getOwnPropertyNames(Array.prototype).sort().join(","),
    arrayPrototypeKeys,
    `${label} added a property to Array.prototype`
  );
  assert.equal({}.polluted, undefined, `${label} polluted Object.prototype`);
  assert.equal([].polluted, undefined, `${label} polluted Array.prototype`);
}

// Describing a hostile value must never itself throw: a proxy or a throwing
// getter would otherwise crash the reporter instead of the assertion.
function describe(value) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (typeof text === "string") return text.slice(0, 300);
  } catch {}
  try {
    return `<${typeof value}>`;
  } catch {
    return "<undescribable>";
  }
}

// Runs one validator against ITERATIONS mutations of its valid input and
// enforces the four properties. `invariant` checks anything that is accepted.
// Parser-style targets signal rejection by returning a sentinel rather than
// throwing, so `isRejection` tells the two apart.
function fuzz(label, seedInput, call, invariant, options = {}) {
  const isRejection = options.isRejection ?? (() => false);
  let accepted = 0;
  let rejected = 0;

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const input = mutate(seedInput);
    let result;
    try {
      result = call(input);
      if (isRejection(result)) {
        rejected += 1;
        continue;
      }
      accepted += 1;
    } catch (error) {
      rejected += 1;
      // Property 2: a rejection must be a real Error with a message.
      assert.ok(
        error instanceof Error,
        `${label} threw a non-Error for ${describe(input)}: ${Object.prototype.toString.call(error)}`
      );
      assert.equal(
        typeof error.message,
        "string",
        `${label} threw an Error without a message for ${describe(input)}`
      );
      assert.ok(
        error.message.length > 0 && error.message.length < 4096,
        `${label} threw an unusable message for ${describe(input)}`
      );
      continue;
    }

    if (invariant) {
      // Property 4: anything accepted has to satisfy the contract.
      try {
        invariant(result, input);
      } catch (error) {
        error.message = `${label} accepted ${describe(input)} but ${error.message}`;
        throw error;
      }
    }
  }

  assertPrototypesIntact(label);
  // A target that rejects or accepts literally everything is not being
  // exercised, which usually means the seed input stopped being valid.
  assert.ok(rejected > 0, `${label} accepted every mutation; the seed may be wrong`);
  return { accepted, rejected };
}

const summary = [];
function record(label, counts) {
  summary.push(`${label}: ${counts.accepted} accepted, ${counts.rejected} rejected`);
}

// ---------------------------------------------------------------- IPC parsing

const validInvoke = { version: 1, type: "invoke", id: 7, command: "settings.read", payload: { key: "theme" } };

record("ipc.parseMessage (structured)", fuzz(
  "ipc.parseMessage (structured)",
  validInvoke,
  (input) => {
    let serialized;
    try {
      serialized = JSON.stringify(input);
    } catch {
      serialized = String(input);
    }
    return ipc.parseMessage(typeof serialized === "string" ? serialized : "");
  },
  (result) => {
    assert.equal(result.version, ipc.IPC_VERSION, "returned a message with the wrong version");
    assert.ok(result.type === "invoke" || result.type === "event", "returned an unknown message type");
    if (result.type === "invoke") {
      assert.ok(Number.isSafeInteger(result.id) && result.id > 0, "returned an invalid request id");
      assert.ok(ipc.isValidName(result.command), "returned an invalid command name");
    } else {
      assert.ok(ipc.isValidName(result.event), "returned an invalid event name");
    }
    assert.ok(ipc.isSafePayload(result), "returned a message that is not a safe payload");
    // Anything accepted must survive a round trip through the serializer.
    assert.deepEqual(ipc.parseMessage(ipc.serialize(result)), result, "does not round-trip");
  },
  { isRejection: (result) => result === undefined }
));

// The same boundary reached as raw text, which is what the native host delivers.
record("ipc.parseMessage (text)", fuzz(
  "ipc.parseMessage (text)",
  JSON.stringify(validInvoke),
  (input) => ipc.parseMessage(typeof input === "string" ? input : String(input)),
  (result) => {
    assert.equal(result.version, ipc.IPC_VERSION, "returned the wrong version");
    assert.ok(ipc.isSafePayload(result), "returned an unsafe payload");
  },
  { isRejection: (result) => result === undefined }
));

record("ipc.serialize", fuzz(
  "ipc.serialize",
  ipc.createEventMessage("theme.changed", { theme: "dark" }),
  (input) => ipc.serialize(input),
  (result, input) => {
    assert.equal(typeof result, "string", "did not return a string");
    assert.ok(
      Buffer.byteLength(result, "utf8") <= ipc.IPC_MAX_SERIALIZED_BYTES,
      "returned an oversized message"
    );
    assert.deepEqual(JSON.parse(result), JSON.parse(JSON.stringify(input)), "changed the message");
  }
));

record("ipc.createEventMessage", fuzz(
  "ipc.createEventMessage",
  "theme.changed",
  (input) => ipc.createEventMessage(input, { ok: true }),
  (result) => {
    assert.ok(ipc.isValidName(result.event), "produced an invalid event name");
    assert.equal(result.version, ipc.IPC_VERSION, "produced the wrong version");
  }
));

record("ipc.createResponseMessage", fuzz(
  "ipc.createResponseMessage",
  { id: 12, ok: false, value: "failed" },
  (input) => ipc.createResponseMessage(input?.id, input?.ok, input?.value),
  (result) => {
    assert.ok(Number.isSafeInteger(result.id) && result.id > 0, "produced an invalid id");
    assert.equal(typeof result.ok, "boolean", "produced a non-boolean status");
    if (result.ok === false) {
      assert.equal(typeof result.error, "string", "produced a non-string error");
    }
  }
));

// ------------------------------------------------------ Permission manifests

record("App permissions policy", fuzz(
  "App permissions policy",
  { allow: ["fs:read", "dialog:open:settings"], deny: ["fs:write"] },
  (input) => new App({ entry: __filename, permissions: input }),
  (app) => {
    assert.ok(app instanceof App, "did not return an App");
    assert.equal(app.mainWindow.lifecycleState, "configured", "left the window in a bad state");
  }
));

const permissionApp = new App({ entry: __filename, permissions: ["fs:*", "dialog:*"] });
let commandIndex = 0;
record("app.command options", fuzz(
  "app.command options",
  { permission: "fs:read", scope: "config" },
  (input) => permissionApp.command(`fuzz.command${commandIndex++}`, input, () => "ok"),
  (result) => {
    assert.equal(result, permissionApp, "did not return the app");
  }
));

// --------------------------------------------- Protocols and launch routing

record("normalizeProtocols", fuzz(
  "normalizeProtocols",
  ["my-app", { scheme: "my-app2", name: "My App URL" }],
  (input) => normalizeProtocols(input),
  (result) => {
    assert.ok(Array.isArray(result), "did not return an array");
    for (const entry of result) {
      assert.match(entry.scheme, /^[a-z][a-z0-9+.-]*$/, `accepted scheme ${entry.scheme}`);
      assert.ok(
        !["file", "http", "https", "mailto"].includes(entry.scheme),
        `accepted the reserved scheme ${entry.scheme}`
      );
    }
  }
));

record("normalizeFileAssociations", fuzz(
  "normalizeFileAssociations",
  [".myapp", { extension: ".other", name: "Other document" }],
  (input) => normalizeFileAssociations(input),
  (result) => {
    assert.ok(Array.isArray(result), "did not return an array");
    for (const entry of result) {
      assert.match(entry.extension, /^\.[a-z0-9-]+$/, `accepted extension ${entry.extension}`);
    }
  }
));

const launchConfiguration = resolveLaunchConfiguration({
  protocols: ["my-app"],
  fileAssociations: [".myapp"]
});

record("findLaunchTargets", fuzz(
  "findLaunchTargets",
  ["my-app://open/document", "C:\\data\\file.myapp"],
  (input) => findLaunchTargets(
    Array.isArray(input) ? input : [input],
    process.cwd(),
    launchConfiguration
  ),
  (result) => {
    assert.ok(Array.isArray(result), "did not return an array");
    for (const target of result) {
      assert.ok(
        target.type === "open-url" || target.type === "open-file",
        `returned an unknown target type ${target.type}`
      );
      assert.equal(typeof target.value, "string", "returned a non-string target");
      assert.ok(target.value.length > 0, "returned an empty target");
    }
  }
));

record("resolveLaunchConfiguration", fuzz(
  "resolveLaunchConfiguration",
  { protocols: ["my-app"], fileAssociations: [".myapp"] },
  (input) => resolveLaunchConfiguration(input),
  (result) => {
    assert.ok(Array.isArray(result.protocols), "returned non-array protocols");
    assert.ok(Array.isArray(result.fileAssociations), "returned non-array associations");
  }
));

// ------------------------------------------------------------ Menu templates

const validMenu = [
  {
    label: "File",
    submenu: [
      { id: "file.open", label: "Open", accelerator: "Ctrl+O" },
      { type: "separator" },
      { id: "file.autosave", label: "Auto save", type: "checkbox", checked: true }
    ]
  }
];

function assertMenuShape(items, depth = 0) {
  assert.ok(Array.isArray(items), "returned a non-array menu");
  assert.ok(depth <= 8, "returned a menu deeper than the documented limit");
  assert.ok(items.length <= 256, "returned more items than the documented limit");
  for (const item of items) {
    assert.ok(
      ["normal", "separator", "checkbox", "submenu"].includes(item.type),
      `returned an unknown item type ${item.type}`
    );
    if (item.id !== undefined) assert.equal(typeof item.id, "string", "returned a non-string id");
    if (item.submenu !== undefined) assertMenuShape(item.submenu, depth + 1);
  }
}

record("normalizeMenuTemplate", fuzz(
  "normalizeMenuTemplate",
  validMenu,
  (input) => normalizeMenuTemplate(input, { allowNull: true }),
  (result) => {
    if (result === null) return;
    assertMenuShape(result);
  }
));

record("normalizeTrayMenuTemplate", fuzz(
  "normalizeTrayMenuTemplate",
  [{ id: "tray.show", label: "Show" }, { type: "separator" }, { id: "tray.quit", label: "Quit" }],
  (input) => normalizeTrayMenuTemplate(input, { allowNull: true }),
  (result) => {
    if (result === null) return;
    assertMenuShape(result);
    for (const item of result) {
      assert.equal(item.accelerator, undefined, "accepted a tray accelerator");
    }
  }
));

record("normalizeAccelerator", fuzz(
  "normalizeAccelerator",
  "Ctrl+Shift+O",
  (input) => normalizeAccelerator(input),
  (result) => {
    if (result === undefined || result === null) return;
    assert.equal(typeof result, "object", "returned an unexpected accelerator shape");
  }
));

record("normalizeContextPosition", fuzz(
  "normalizeContextPosition",
  { x: 40, y: 80 },
  (input) => normalizeContextPosition(input),
  (result) => {
    if (result === undefined) return;
    for (const key of ["x", "y"]) {
      if (result[key] === undefined) continue;
      assert.ok(Number.isInteger(result[key]), `returned a non-integer ${key}`);
    }
  }
));

// -------------------------------------------------------------- Update metadata

const validManifest = {
  schemaVersion: 1,
  appId: "com.example.my-app",
  version: "1.2.0",
  url: "https://updates.example.com/MyApp-1.2.0-setup.exe",
  size: 1024,
  sha256: "a".repeat(64),
  signature: "b".repeat(86)
};

record("validateManifest", fuzz(
  "validateManifest",
  validManifest,
  (input) => validateManifest(input, {
    appId: "com.example.my-app",
    maxDownloadBytes: 1024 * 1024,
    publicKey: null
  }),
  (result) => {
    // Reaching here at all would mean an unsigned manifest was accepted.
    assert.fail(`accepted a manifest without verifying its signature: ${describe(result)}`);
  }
));

// --------------------------------------------------- Package integrity manifests

record("parseIntegrityManifest", fuzz(
  "parseIntegrityManifest",
  // Generated by the real serializer, so mutations start from a manifest the
  // parser genuinely accepts.
  serializeIntegrityManifest([
    { path: "app/index.html", size: 128, sha256: "c".repeat(64) },
    { path: "runtime/nodeview.js", size: 4096, sha256: "d".repeat(64) }
  ]),
  (input) => parseIntegrityManifest(typeof input === "string" ? input : String(input)),
  (result) => {
    assert.ok(result && typeof result === "object", "returned a non-object manifest");
    const entries = Array.isArray(result) ? result : result.entries ?? [];
    for (const entry of entries) {
      assert.equal(typeof entry.path, "string", "returned a non-string path");
      assert.ok(!path.isAbsolute(entry.path), `returned an absolute path ${entry.path}`);
      assert.ok(!entry.path.includes(".."), `returned a traversing path ${entry.path}`);
      assert.ok(Number.isSafeInteger(entry.size) && entry.size >= 0, "returned an invalid size");
      assert.match(entry.sha256, /^[0-9a-f]{64}$/, "returned an invalid digest");
    }
  }
));

// ---------------------------------------------------------- Other boundaries

record("normalizeAllowedOrigins", fuzz(
  "normalizeAllowedOrigins",
  ["https://api.example.com", "http://localhost:3000"],
  (input) => net.normalizeAllowedOrigins(input),
  (result) => {
    assert.ok(Array.isArray(result), "did not return an array");
    assert.ok(result.length <= 32, "returned more origins than the documented limit");
    for (const origin of result) {
      const url = new URL(origin);
      assert.ok(["http:", "https:"].includes(url.protocol), `accepted scheme ${url.protocol}`);
      assert.equal(url.pathname, "/", `accepted a path in ${origin}`);
      assert.equal(url.search, "", `accepted a query in ${origin}`);
      assert.equal(url.username, "", `accepted credentials in ${origin}`);
    }
  }
));

record("config.resolveConfigPath", fuzz(
  "config.resolveConfigPath",
  { appName: "MyApp", fileName: "settings.json" },
  (input) => config.resolveConfigPath(input),
  (result) => {
    assert.equal(typeof result, "string", "did not return a string");
    assert.ok(path.isAbsolute(result), "returned a relative path");
    assert.ok(path.basename(result).length <= 255, "returned an over-long file name");
    assert.ok(!/[\u0000-\u001F\u007F]/.test(result), "returned a path with control characters");
  }
));

record("normalizeNotificationOptions", fuzz(
  "normalizeNotificationOptions",
  { title: "My App", message: "Finished loading." },
  (input) => normalizeNotificationOptions(input),
  (result) => {
    assert.ok(result.title.length <= 63, "accepted an over-long title");
    assert.ok(result.message.length <= 255, "accepted an over-long message");
    assert.ok(!/[\u0000-\u001F\u007F]/.test(result.title + result.message), "accepted control characters");
  }
));

record("normalizeWindowColors", fuzz(
  "normalizeWindowColors",
  { titleBar: "#162033", titleText: "#ffffff", border: "#3b82f6" },
  (input) => normalizeWindowColors(input, undefined),
  (result) => {
    if (result === undefined || result === null) return;
    assert.deepEqual(
      Object.keys(result).sort(),
      ["border", "titleBar", "titleText"],
      "returned unexpected color keys"
    );
    // Colors are normalized to the 24-bit value the native host expects.
    for (const [key, value] of Object.entries(result)) {
      if (value === null || value === undefined) continue;
      assert.ok(
        Number.isInteger(value) && value >= 0 && value <= 0xffffff,
        `accepted ${key} = ${describe(value)}`
      );
    }
  }
));

record("normalizeProgress", fuzz(
  "normalizeProgress",
  { value: 0.65, state: "normal" },
  (input) => normalizeProgress(input?.value, input?.state),
  (result) => {
    assert.ok(
      ["normal", "paused", "error", "indeterminate", "none"].includes(result.state),
      `returned an unknown state ${result.state}`
    );
    assert.ok(
      typeof result.value === "number" && result.value >= 0 && result.value <= 1,
      `returned an out-of-range value ${result.value}`
    );
  }
));

record("normalizeAttentionType", fuzz(
  "normalizeAttentionType",
  "informational",
  (input) => normalizeAttentionType(input),
  (result) => {
    assert.ok(
      ["informational", "critical", "stop"].includes(result),
      `returned an unknown attention type ${result}`
    );
  }
));

// The overlay validator requires an existing .ico file, so give it one.
const iconWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-fuzz-icon-"));
const overlayIcon = path.join(iconWorkspace, "badge.ico");
fs.writeFileSync(overlayIcon, Buffer.alloc(16));

record("normalizeOverlay", fuzz(
  "normalizeOverlay",
  { icon: overlayIcon, description: "New messages" },
  (input) => normalizeOverlay(input?.icon, input?.description),
  (result) => {
    if (result.icon !== null && result.icon !== undefined) {
      assert.equal(typeof result.icon, "string", "returned a non-string icon");
      assert.ok(path.isAbsolute(result.icon), "returned a relative icon path");
    }
    assert.equal(typeof result.description, "string", "returned a non-string description");
  }
));

// --------------------------------------------- Malformed frontend messages

// The whole inbound path, as the native host drives it: whatever arrives, the
// dispatch must settle without throwing and must only ever post a well-formed
// response back to the page.
async function fuzzWindowMessages() {
  const app = new App({ entry: __filename });
  app._reportError = () => {};
  const originalConsoleError = console.error;
  console.error = () => {};

  app.command("fuzz.echo", (payload) => payload);
  app.on("fuzz.event", () => {});

  const posted = [];
  const window = {
    _dispatch: async () => {},
    _markBridgeReady() {},
    _resetBridgeReady() {},
    _post(message) { posted.push(message); }
  };

  let settled = 0;
  try {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const input = mutate(pick([
        validInvoke,
        { version: 1, type: "event", event: "fuzz.event", payload: { ok: true } },
        { version: 1, type: "event", event: "nodeview:ready" },
        JSON.stringify(validInvoke)
      ]));

      let serialized;
      try {
        serialized = typeof input === "string" ? input : JSON.stringify(input);
      } catch {
        serialized = "{";
      }

      // Must not reject: the native callback has nowhere to report to.
      await app._handleWindowMessage(window, serialized ?? "");
      settled += 1;
    }
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(settled, ITERATIONS, "a frontend message rejected the dispatch");
  assertPrototypesIntact("_handleWindowMessage");

  // Every response that reached the page has to be a valid response message.
  for (const message of posted) {
    assert.equal(typeof message, "string", "posted a non-string message");
    const parsed = JSON.parse(message);
    assert.equal(parsed.version, ipc.IPC_VERSION, "posted the wrong protocol version");
    assert.equal(parsed.type, "response", "posted a non-response message");
    assert.ok(Number.isSafeInteger(parsed.id) && parsed.id > 0, "posted an invalid response id");
    assert.equal(typeof parsed.ok, "boolean", "posted a non-boolean status");
    if (parsed.ok === false) {
      assert.equal(typeof parsed.error, "string", "posted a non-string error");
      assert.ok(parsed.error.length <= 1024, "posted an unbounded error detail");
    }
    assert.ok(ipc.isSafePayload(parsed), "posted an unsafe payload");
  }

  summary.push(`_handleWindowMessage: ${settled} dispatched, ${posted.length} responses`);
}

// ------------------------------------------------------------- Corpus replay

// The fixed corpus stays as a regression floor: these exact inputs must always
// be rejected, whatever the generator happens to produce on a given seed.
const corpus = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "security-corpus.json"),
  "utf8"
));
for (const sample of corpus.ipc) {
  assert.equal(ipc.parseMessage(sample), undefined, `corpus sample was accepted: ${sample}`);
}

fuzzWindowMessages()
  .then(() => {
    fs.rmSync(iconWorkspace, { recursive: true, force: true });
    console.log(`Trust boundary fuzz test passed (seed ${seed}, ${ITERATIONS} iterations per target).`);
    for (const line of summary) console.log(`  ${line}`);
  })
  .catch((error) => {
    fs.rmSync(iconWorkspace, { recursive: true, force: true });
    console.error(`Seed ${seed} reproduces this failure: NODEVIEW_FUZZ_SEED=${seed}`);
    console.error(error);
    process.exit(1);
  });
