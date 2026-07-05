"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  BRIDGE_MARKER,
  PACKAGED_BRIDGE_PATH,
  embedBridgeInDirectory,
  embedBridgeInHtml
} = require("../scripts/embed-bridge-html");

const bridge = "(() => { window.NodeViewJS = Object.freeze({}); })();";
const source = "<!doctype html>\n<html><head><title>Test</title></head><body></body></html>";
const first = embedBridgeInHtml(source, bridge);
assert.equal(first.changed, true);
assert.match(first.html, new RegExp(BRIDGE_MARKER));
assert.ok(first.html.indexOf(BRIDGE_MARKER) < first.html.indexOf("<title>"));
assert.equal(embedBridgeInHtml(first.html, bridge).changed, false);

const withoutHead = embedBridgeInHtml("<!doctype html><main>Test</main>", bridge);
assert.ok(withoutHead.html.indexOf(BRIDGE_MARKER) > withoutHead.html.indexOf("<!doctype html>"));
assert.match(embedBridgeInHtml("<main>Test</main>", bridge).html, /^<script data-nodeview-bridge/);
assert.match(embedBridgeInHtml("<html></html>", "const closing = '</script>'; ").html, /<\\\/script>/);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-bridge-embed-"));
const nestedDirectory = path.join(temporaryDirectory, "nested");
const bridgeFile = path.join(temporaryDirectory, "bridge.js");
fs.mkdirSync(nestedDirectory);
fs.writeFileSync(bridgeFile, bridge);
fs.writeFileSync(path.join(temporaryDirectory, "index.html"), source);
fs.writeFileSync(path.join(nestedDirectory, "settings.HTML"), source);
fs.writeFileSync(path.join(temporaryDirectory, "app.js"), "unchanged");

try {
  assert.equal(embedBridgeInDirectory(temporaryDirectory, bridgeFile), 2);
  assert.equal(embedBridgeInDirectory(temporaryDirectory, bridgeFile), 0);
  assert.match(
    fs.readFileSync(path.join(temporaryDirectory, "index.html"), "utf8"),
    /src="__nodeview\/bridge\.js"/
  );
  assert.match(
    fs.readFileSync(path.join(nestedDirectory, "settings.HTML"), "utf8"),
    /src="\.\.\/__nodeview\/bridge\.js"/
  );
  assert.equal(
    fs.readFileSync(path.join(temporaryDirectory, PACKAGED_BRIDGE_PATH), "utf8"),
    bridge
  );
  assert.equal(fs.readFileSync(path.join(temporaryDirectory, "app.js"), "utf8"), "unchanged");
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("Packaged HTML bridge embedding test passed.");
