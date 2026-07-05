"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const projectRootIndex = process.argv.indexOf("--project-root");
const projectRoot = projectRootIndex === -1
  ? root
  : path.resolve(process.argv[projectRootIndex + 1]);
const packageJson = require(path.join(projectRoot, "package.json"));
const outputDirectory = path.join(root, "src-nodeview", "generated");
const output = path.join(outputDirectory, "launcher_metadata.rc");

const config = packageJson.nodeviewjs || {};
const metadata = config.metadata || {};
const iconPath = config.icon && path.resolve(projectRoot, config.icon);
const version = metadata.version || packageJson.version || "0.1.0";
const versionParts = version.split(".").map((part) => Number.parseInt(part, 10));
while (versionParts.length < 4) versionParts.push(0);

const fileVersion = versionParts.slice(0, 4).map((part) => Number.isFinite(part) ? part : 0).join(",");
const stringVersion = versionParts.slice(0, 3).join(".");

function escapeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function value(name, fallback) {
  return escapeValue(metadata[name] || fallback);
}

const iconResource = iconPath ? `1 ICON "${escapeValue(iconPath)}"\n\n` : "";
const header = `#include <windows.h>

${iconResource}

1 VERSIONINFO
FILEVERSION ${fileVersion}
PRODUCTVERSION ${fileVersion}
FILEFLAGSMASK 0x3fL
FILEFLAGS 0x0L
FILEOS 0x40004L
FILETYPE 0x1L
FILESUBTYPE 0x0L
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904b0"
    BEGIN
      VALUE "CompanyName", "${value("companyName", "NodeViewJS")}\\0"
      VALUE "FileDescription", "${value("fileDescription", "NodeViewJS Application Launcher")}\\0"
      VALUE "FileVersion", "${escapeValue(metadata.fileVersion || stringVersion)}\\0"
      VALUE "InternalName", "${value("internalName", "nodeview_launcher")}\\0"
      VALUE "OriginalFilename", "${value("originalFilename", `${config.name || "NodeViewDemo"}.exe`)}\\0"
      VALUE "ProductName", "${value("productName", config.name || "NodeViewJS")}\\0"
      VALUE "ProductVersion", "${escapeValue(metadata.productVersion || stringVersion)}\\0"
      VALUE "LegalCopyright", "${value("copyright", "Copyright (C) 2026 NodeViewJS contributors")}\\0"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x0409, 1200
  END
END
`;

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(output, header);
