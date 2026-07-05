"use strict";

const fs = require("node:fs");
const path = require("node:path");

const developmentAddon = path.join(__dirname, "..", "build", "nodeview", "nodeview.node");
const bundledAddon = path.join(__dirname, "nodeview.node");
const packagedAddon = path.join(__dirname, "..", "native", "nodeview.node");
const addonPath = [developmentAddon, bundledAddon, packagedAddon]
  .find((candidate) => fs.existsSync(candidate));

if (!addonPath) {
  throw new Error(
    "NodeViewJS native addon was not found. Run `npm run build` in NodeViewJS or reinstall the package."
  );
}

try {
  module.exports = require(addonPath);
} catch (error) {
  throw new Error(`NodeViewJS could not load its native addon: ${error.message}`, { cause: error });
}
