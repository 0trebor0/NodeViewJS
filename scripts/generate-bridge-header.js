"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = path.join(root, "runtime", "bridge.js");
const outputDirectory = path.join(root, "src-nodeview", "generated");
const output = path.join(outputDirectory, "bridge_script.h");
const delimiter = "NVJS_BRIDGE";
const maxLiteralCharacters = 6_000;

const bridgeScript = fs.readFileSync(source, "utf8").replace(/\r\n/g, "\n");

if (bridgeScript.includes(`)${delimiter}"`)) {
  throw new Error(`Bridge script cannot contain the raw string delimiter ${delimiter}.`);
}

function renderLiterals(value, prefix) {
  const literals = [];
  for (let offset = 0; offset < value.length; offset += maxLiteralCharacters) {
    const chunk = value.slice(offset, offset + maxLiteralCharacters);
    literals.push(`${prefix}R"${delimiter}(${chunk})${delimiter}"`);
  }
  return literals.join("\n");
}

const embeddedBridgeScript = `\n${bridgeScript}\n`;

const header = `#pragma once

namespace nodeview::generated {

constexpr wchar_t kBridgeScript[] =
${renderLiterals(embeddedBridgeScript, "L")};

constexpr char kBridgeScriptUtf8[] =
${renderLiterals(embeddedBridgeScript, "")};

}  // namespace nodeview::generated
`;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(output, header);
