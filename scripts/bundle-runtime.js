#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function bundleRuntime(sourceRoot, outputFile) {
  const root = path.resolve(sourceRoot);
  const files = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort();
  if (!files.includes("index.js")) {
    throw new Error(`Runtime entry was not found at ${path.join(root, "index.js")}.`);
  }

  const wrappers = files.map((name) => {
    const source = fs.readFileSync(path.join(root, name), "utf8");
    return `${JSON.stringify(name)}: function(module, exports, require, __filename, __dirname) {\n${source}\n}`;
  });
  const bundle = `"use strict";

const nodePath = require("node:path");
const nodeRequire = require;
const moduleFactories = {
${wrappers.join(",\n")}
};
const moduleCache = Object.create(null);

function loadBundledModule(id) {
  if (moduleCache[id]) return moduleCache[id].exports;
  const factory = moduleFactories[id];
  if (!factory) throw new Error(\`Unknown bundled NodeViewJS runtime module: \${id}\`);
  const module = { exports: {} };
  moduleCache[id] = module;
  const filename = nodePath.join(__dirname, id);
  const localRequire = (request) => {
    if (typeof request === "string" && request.startsWith(".")) {
      const normalized = nodePath.posix.normalize(
        nodePath.posix.join(nodePath.posix.dirname(id), request.replaceAll("\\\\", "/"))
      );
      for (const candidate of [normalized, \`\${normalized}.js\`, \`\${normalized}/index.js\`]) {
        if (moduleFactories[candidate]) return loadBundledModule(candidate);
      }
    }
    return nodeRequire(request);
  };
  factory(module, module.exports, localRequire, filename, nodePath.dirname(filename));
  return module.exports;
}

module.exports = loadBundledModule("index.js");
`;

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, bundle);
  return { files, outputFile: path.resolve(outputFile) };
}

if (require.main === module) {
  const sourceIndex = process.argv.indexOf("--source");
  const outputIndex = process.argv.indexOf("--output");
  if (sourceIndex === -1 || outputIndex === -1 || !process.argv[sourceIndex + 1] ||
      !process.argv[outputIndex + 1]) {
    throw new Error("Usage: bundle-runtime --source <runtime-directory> --output <bundle-file>");
  }
  bundleRuntime(process.argv[sourceIndex + 1], process.argv[outputIndex + 1]);
}

module.exports = { bundleRuntime };
