"use strict";

const fs = require("node:fs");
const path = require("node:path");

const developmentAddon = path.join(__dirname, "..", "build", "nodeview", "nodeview.node");
const bundledAddon = path.join(__dirname, "nodeview.node");
const packagedAddon = path.join(__dirname, "..", "native", "nodeview.node");
const addonPath = [developmentAddon, bundledAddon, packagedAddon]
  .find((candidate) => fs.existsSync(candidate));

if (!addonPath) {
  throw new Error([
    "NodeViewJS native addon was not found.",
    "",
    "The addon is built during installation. It is missing when the build was",
    "skipped (`npm install --ignore-scripts`) or failed.",
    "",
    "Next steps:",
    "  npx nodeviewjs doctor   # reports which prerequisite is missing",
    "  npm run build           # build it once the prerequisites are present",
    "",
    `Searched: ${[developmentAddon, bundledAddon, packagedAddon].join(", ")}`
  ].join("\n"));
}

try {
  module.exports = require(addonPath);
} catch (error) {
  const message = String(error?.message ?? error);
  // A version mismatch is the common failure after switching Node versions,
  // and its native message does not say what to do about it.
  const abiMismatch = /NODE_MODULE_VERSION|was compiled against a different/i.test(message);
  throw new Error([
    `NodeViewJS could not load its native addon: ${message}`,
    "",
    abiMismatch
      ? "The addon was built for a different Node.js version. Rebuild it:\n  npm run build"
      : "Next steps:\n  npx nodeviewjs doctor   # checks the addon and its dependencies\n"
        + "  npm run build           # rebuild the addon",
    "",
    `Addon: ${addonPath}`
  ].join("\n"), { cause: error });
}
