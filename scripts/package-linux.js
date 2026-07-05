#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { embedBridgeInDirectory } = require("./embed-bridge-html");

function globExpression(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
}

function isExcluded(relativePath, patterns) {
  const normalized = relativePath.split(path.sep).join("/");
  return patterns.some((pattern) => globExpression(String(pattern).replace(/\\/g, "/")).test(normalized));
}

function copyPath(source, base, destinationRoot, exclusions) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw new Error(`Linux packaging does not follow symbolic links: ${source}`);
  }
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(source)) {
      copyPath(path.join(source, child), base, destinationRoot, exclusions);
    }
    return;
  }
  if (!stat.isFile()) return;

  const relative = path.relative(base, source);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Package input is outside its configured base directory: ${source}`);
  }
  if (isExcluded(relative, exclusions)) return;
  const destination = path.join(destinationRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function runBuild(runtimeRoot) {
  const result = spawnSync(process.execPath, [path.join(runtimeRoot, "scripts", "build.js")], {
    cwd: runtimeRoot,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function packageLinuxApp(projectRoot = process.cwd(), options = {}) {
  if (process.platform !== "linux" && !options.allowNonLinux) {
    throw new Error("Linux app folders can only be packaged on Linux.");
  }
  const runtimeRoot = options.runtimeRoot ?? path.join(__dirname, "..");
  const root = path.resolve(projectRoot);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const config = packageJson.nodeviewjs ?? {};
  const metadata = config.metadata ?? {};
  const appName = config.name ?? "NodeViewDemo";
  const appId = config.appId ?? packageJson.name;
  const version = metadata.version ?? packageJson.version;
  const entry = path.resolve(root, config.entry ?? "app.js");
  const entryDirectory = path.dirname(entry);
  const iconSetting = config.linuxIcon ?? config.icon;
  const icon = iconSetting ? path.resolve(root, iconSetting) : undefined;
  const addon = path.join(runtimeRoot, "build", "nodeview", "nodeview.node");
  const launcher = path.join(runtimeRoot, "build", "nodeview", "nodeview_launcher");

  if (typeof appName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(appName)) {
    throw new Error("nodeviewjs.name contains characters that are unsafe for a Linux app folder.");
  }
  if (typeof appId !== "string" || appId.trim().length === 0) {
    throw new Error("nodeviewjs.appId must be a non-empty string.");
  }
  const entryRelative = path.relative(root, entry);
  if (entryRelative.startsWith("..") || path.isAbsolute(entryRelative)) {
    throw new Error("The Linux package entry must stay inside the project directory.");
  }
  if (!fs.existsSync(entry)) throw new Error(`App entry file was not found: ${entry}`);
  if (icon && !fs.existsSync(icon)) throw new Error(`Linux app icon was not found: ${icon}`);
  if (!fs.existsSync(addon) || !fs.existsSync(launcher)) runBuild(runtimeRoot);
  if (!fs.existsSync(addon)) throw new Error(`Native addon was not found after build: ${addon}`);
  if (!fs.existsSync(launcher)) throw new Error(`Native launcher was not found after build: ${launcher}`);

  const output = path.join(root, "build", "linux", appName);
  const resources = path.join(output, "resources");
  const appOutput = path.join(resources, "app");
  const runtimeOutput = path.join(resources, "runtime");
  const exclusions = [
    "node_modules", "node_modules/*", ".git", ".git/*",
    ".nodeview-webview", ".nodeview-webview/*", "build", "build/*",
    ...(Array.isArray(config.exclude) ? config.exclude : config.exclude ? [config.exclude] : [])
  ];

  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(appOutput, { recursive: true });
  fs.mkdirSync(path.join(runtimeOutput, "native"), { recursive: true });
  copyPath(entryDirectory, entryDirectory, appOutput, exclusions);
  const includes = Array.isArray(config.include) ? config.include : config.include ? [config.include] : [];
  for (const include of includes) {
    const source = path.resolve(root, include);
    if (!fs.existsSync(source)) throw new Error(`Configured include path was not found: ${source}`);
    copyPath(source, root, appOutput, exclusions);
  }
  embedBridgeInDirectory(appOutput, path.join(runtimeRoot, "runtime", "bridge.js"));

  let appSource = fs.readFileSync(entry, "utf8")
    .replaceAll('require("../../runtime")', 'require("../runtime/nodeview")')
    .replaceAll('require("nodeviewjs")', 'require("../runtime/nodeview")')
    .replaceAll("require('nodeviewjs')", "require('../runtime/nodeview')");
  appSource = `process.env.NODEVIEW_BRIDGE_EMBEDDED = "1";\n` +
    `process.env.NODEVIEW_APP_ID = ${JSON.stringify(appId)};\n` +
    `process.env.NODEVIEW_APP_VERSION = ${JSON.stringify(version)};\n` + appSource;
  if (icon) {
    appSource = `process.env.NODEVIEW_APP_ICON = require("node:path").join(__dirname, ${JSON.stringify(path.relative(entryDirectory, icon))});\n` + appSource;
  }
  fs.writeFileSync(path.join(appOutput, "app.js"), appSource);

  fs.cpSync(path.join(runtimeRoot, "runtime"), path.join(runtimeOutput, "nodeview"), { recursive: true });
  fs.copyFileSync(addon, path.join(runtimeOutput, "native", "nodeview.node"));
  fs.copyFileSync(options.nodeExecutable ?? process.execPath, path.join(runtimeOutput, "node"));
  fs.chmodSync(path.join(runtimeOutput, "node"), 0o755);
  fs.copyFileSync(launcher, path.join(output, appName));
  fs.chmodSync(path.join(output, appName), 0o755);

  console.log(`Created Linux app folder: ${output}`);
  return output;
}

if (require.main === module) {
  const projectRootIndex = process.argv.indexOf("--project-root");
  packageLinuxApp(projectRootIndex === -1 ? process.cwd() : process.argv[projectRootIndex + 1]);
}

module.exports = { packageLinuxApp };
