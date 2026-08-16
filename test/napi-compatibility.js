"use strict";

// One prebuilt binary per platform should load on every Node.js release this
// package supports. That only holds if the addon is built against a pinned
// N-API version and never calls anything newer, so both halves are checked
// here.
//
// Without the pin, node-addon-api compiles against the newest N-API in
// whichever Node headers built it, and a binary built on a current Node can
// call symbols an older one does not export.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const PINNED_NAPI_VERSION = 8;

/* ------------------------------------------------------- the declaration */

const bindingSource = fs.readFileSync(path.join(root, "src-nodeview", "binding.gyp"), "utf8");
const binding = JSON.parse(bindingSource);
const addon = binding.targets.find((target) => target.target_name === "nodeview");
assert.ok(addon, "the addon target is missing");
assert.ok(
  addon.defines.includes(`NAPI_VERSION=${PINNED_NAPI_VERSION}`),
  `the addon must pin NAPI_VERSION=${PINNED_NAPI_VERSION}, so one binary serves every supported Node`
);

// N-API 8 is available in every Node.js release this package supports.
const engines = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).engines.node;
assert.equal(engines, ">=20", "the supported Node range changed; re-check the pinned N-API version");
assert.ok(
  Number(process.versions.napi) >= PINNED_NAPI_VERSION,
  `this Node provides N-API ${process.versions.napi}, below the pinned ${PINNED_NAPI_VERSION}`
);

/* ----------------------------------------------------------- the binary */

// Every N-API symbol the built addon references. All of these are part of the
// original N-API surface, well below the pinned version.
//
// Adding an entry here is a deliberate act: check the new symbol's minimum
// N-API version before doing so, because it decides which Node releases the
// prebuilt binaries can serve.
const ALLOWED_SYMBOLS = new Set([
  "napi_add_finalizer",
  "napi_call_function",
  "napi_close_escapable_handle_scope",
  "napi_close_handle_scope",
  "napi_create_double",
  "napi_create_error",
  "napi_create_function",
  "napi_create_object",
  "napi_create_range_error",
  "napi_create_reference",
  "napi_create_string_utf16",
  "napi_create_string_utf8",
  "napi_create_type_error",
  "napi_define_properties",
  "napi_delete_reference",
  "napi_escape_handle",
  "napi_fatal_error",
  "napi_get_and_clear_last_exception",
  "napi_get_array_length",
  "napi_get_boolean",
  "napi_get_cb_info",
  "napi_get_element",
  "napi_get_last_error_info",
  "napi_get_named_property",
  "napi_get_null",
  "napi_get_property",
  "napi_get_reference_value",
  "napi_get_undefined",
  "napi_get_value_bool",
  "napi_get_value_double",
  "napi_get_value_int32",
  "napi_get_value_string_utf16",
  "napi_get_value_string_utf8",
  "napi_get_value_uint32",
  "napi_has_property",
  "napi_is_array",
  "napi_is_exception_pending",
  "napi_open_escapable_handle_scope",
  "napi_open_handle_scope",
  "napi_register_module_v1",
  "napi_set_named_property",
  "napi_throw",
  "napi_typeof",
  // Exported by the module to declare the N-API version it targets. Node
  // releases that predate it simply ignore it.
  "node_api_module_get_api_version_v1"
]);

const addonPath = [
  path.join(root, "build", "nodeview", "nodeview.node"),
  path.join(root, "runtime", "nodeview.node")
].find((candidate) => fs.existsSync(candidate));

if (!addonPath) {
  console.log("N-API compatibility test passed (declaration only: the addon is not built).");
} else {
  const binary = fs.readFileSync(addonPath).toString("latin1");
  const referenced = new Set(binary.match(/\b(?:napi_|node_api_)[a-z0-9_]+/g) ?? []);
  assert.ok(referenced.size > 0, "no N-API symbols were found in the addon");

  const unexpected = [...referenced].filter((symbol) => !ALLOWED_SYMBOLS.has(symbol)).sort();
  assert.deepEqual(
    unexpected,
    [],
    "the addon references N-API symbols this test does not know about. Check each one's "
      + "minimum N-API version before adding it to ALLOWED_SYMBOLS, because it decides which "
      + "Node.js releases a single prebuilt binary can serve"
  );

  // The addon must load in this process, which is the only Node version
  // available here. Cross-version loading is a release-pipeline check.
  const loaded = require(addonPath);
  assert.equal(typeof loaded, "object");
  assert.equal(typeof loaded.createWindow, "function");

  console.log(
    `N-API compatibility test passed (pinned to ${PINNED_NAPI_VERSION}, `
      + `${referenced.size} symbols, loaded on Node ${process.versions.node} `
      + `with N-API ${process.versions.napi}).`
  );
}
