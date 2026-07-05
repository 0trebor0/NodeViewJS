#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeFileAssociations,
  normalizeProtocols
} = require("../runtime/launch-routing");

const projectRootIndex = process.argv.indexOf("--project-root");
const projectRoot = projectRootIndex === -1
  ? process.cwd()
  : path.resolve(process.argv[projectRootIndex + 1]);
const packagePath = path.join(projectRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const config = packageJson.nodeviewjs ?? {};

process.stdout.write(JSON.stringify({
  protocols: normalizeProtocols(config.protocols ?? []),
  fileAssociations: normalizeFileAssociations(config.fileAssociations ?? [])
}));
