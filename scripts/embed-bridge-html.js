#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BRIDGE_MARKER = 'data-nodeview-bridge="embedded"';
const PACKAGED_BRIDGE_PATH = path.join("__nodeview", "bridge.js");

function embedBridgeInHtml(html, bridgeSource, options = {}) {
  if (typeof html !== "string" || typeof bridgeSource !== "string") {
    throw new TypeError("HTML and bridge source must be strings.");
  }
  if (html.includes(BRIDGE_MARKER)) return { html, changed: false };

  const safeBridge = bridgeSource.replace(/<\/script/gi, "<\\/script");
  const script = options.src
    ? `<script ${BRIDGE_MARKER} src="${options.src}"></script>`
    : `<script ${BRIDGE_MARKER}>\n${safeBridge.trim()}\n</script>`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head) {
    const offset = head.index + head[0].length;
    return {
      html: `${html.slice(0, offset)}\n    ${script}${html.slice(offset)}`,
      changed: true
    };
  }

  const doctype = /<!doctype\s+html[^>]*>/i.exec(html);
  if (doctype) {
    const offset = doctype.index + doctype[0].length;
    return { html: `${html.slice(0, offset)}\n${script}${html.slice(offset)}`, changed: true };
  }
  return { html: `${script}\n${html}`, changed: true };
}

function embedBridgeInDirectory(appDirectory, bridgeFile) {
  const root = path.resolve(appDirectory);
  const bridgeSource = fs.readFileSync(path.resolve(bridgeFile), "utf8");
  const packagedBridge = path.join(root, PACKAGED_BRIDGE_PATH);
  if (fs.existsSync(packagedBridge) && fs.readFileSync(packagedBridge, "utf8") !== bridgeSource) {
    throw new Error(`Package input uses reserved bridge path: ${PACKAGED_BRIDGE_PATH}`);
  }
  fs.mkdirSync(path.dirname(packagedBridge), { recursive: true });
  fs.writeFileSync(packagedBridge, bridgeSource);
  let embedded = 0;

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(target);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".html") {
        const source = path.relative(path.dirname(target), packagedBridge).split(path.sep).join("/");
        const result = embedBridgeInHtml(fs.readFileSync(target, "utf8"), bridgeSource, { src: source });
        if (result.changed) {
          fs.writeFileSync(target, result.html);
          embedded += 1;
        }
      }
    }
  }

  visit(root);
  return embedded;
}

if (require.main === module) {
  const appDirectoryIndex = process.argv.indexOf("--app-dir");
  const bridgeIndex = process.argv.indexOf("--bridge");
  const appDirectory = process.argv[appDirectoryIndex + 1];
  const bridgeFile = process.argv[bridgeIndex + 1];
  if (appDirectoryIndex === -1 || bridgeIndex === -1 || !appDirectory || !bridgeFile) {
    throw new Error("Usage: embed-bridge-html --app-dir <directory> --bridge <bridge.js>");
  }
  const count = embedBridgeInDirectory(appDirectory, bridgeFile);
  console.log(`Embedded the NodeViewJS bridge in ${count} HTML file(s).`);
}

module.exports = {
  BRIDGE_MARKER,
  PACKAGED_BRIDGE_PATH,
  embedBridgeInDirectory,
  embedBridgeInHtml
};
