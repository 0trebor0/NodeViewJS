#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { notarizeMacApp, signMacApp } = require("./sign-macos");
const { embedBridgeInDirectory } = require("./embed-bridge-html");

function xml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createInfoPlist({ appId, appName, version, iconName }) {
  const icon = iconName
    ? `\n  <key>CFBundleIconFile</key>\n  <string>${xml(iconName)}</string>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${xml(appName)}</string>
  <key>CFBundleExecutable</key>
  <string>${xml(appName)}</string>
  <key>CFBundleIdentifier</key>
  <string>${xml(appId)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>${icon}
  <key>CFBundleName</key>
  <string>${xml(appName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${xml(version)}</string>
  <key>CFBundleVersion</key>
  <string>${xml(version)}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
`;
}

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
    throw new Error(`macOS packaging does not follow symbolic links: ${source}`);
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

function defaultRun(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? "unknown"}.`);
  }
}

function createMacDmg(appBundle, options = {}) {
  const bundle = path.resolve(appBundle);
  if (!fs.existsSync(bundle)) throw new Error(`macOS app bundle was not found: ${bundle}`);

  const appName = path.basename(bundle, ".app");
  const output = path.resolve(options.output ?? path.join(path.dirname(bundle), `${appName}.dmg`));
  const staging = `${output}.staging`;
  const run = options.run ?? defaultRun;

  fs.rmSync(output, { force: true });
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    fs.cpSync(bundle, path.join(staging, path.basename(bundle)), { recursive: true });
    if (options.linkApplications !== false) {
      fs.symlinkSync("/Applications", path.join(staging, "Applications"));
    }
    run("hdiutil", [
      "create", "-volname", appName, "-srcfolder", staging,
      "-ov", "-format", "UDZO", output
    ]);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  return output;
}

function packageMacApp(projectRoot = process.cwd(), options = {}) {
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
  const icon = config.macIcon ? path.resolve(root, config.macIcon) : undefined;
  const addon = path.join(runtimeRoot, "build", "nodeview", "nodeview.node");
  const launcher = path.join(runtimeRoot, "build", "nodeview", "nodeview_launcher");

  if (process.platform !== "darwin" && !options.allowNonMac) {
    throw new Error("macOS app bundles can only be packaged on macOS.");
  }
  if (typeof appName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(appName)) {
    throw new Error("nodeviewjs.name contains characters that are unsafe for a macOS bundle.");
  }
  if (typeof appId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(appId)) {
    throw new Error("nodeviewjs.appId must be a bundle-safe identifier.");
  }
  const entryRelative = path.relative(root, entry);
  if (entryRelative.startsWith("..") || path.isAbsolute(entryRelative)) {
    throw new Error("The macOS package entry must stay inside the project directory.");
  }
  if (!fs.existsSync(entry)) throw new Error(`App entry file was not found: ${entry}`);
  if (icon && path.extname(icon).toLowerCase() !== ".icns") {
    throw new Error("nodeviewjs.macIcon must point to an .icns file.");
  }
  if (icon && !fs.existsSync(icon)) throw new Error(`macOS app icon was not found: ${icon}`);
  if (!fs.existsSync(addon) || !fs.existsSync(launcher)) runBuild(runtimeRoot);
  if (!fs.existsSync(addon)) throw new Error(`Native addon was not found after build: ${addon}`);
  if (!fs.existsSync(launcher)) throw new Error(`Native launcher was not found after build: ${launcher}`);

  const appBundle = path.join(root, "build", "macos", `${appName}.app`);
  const contents = path.join(appBundle, "Contents");
  const macos = path.join(contents, "MacOS");
  const resources = path.join(contents, "Resources");
  const appOutput = path.join(resources, "app");
  const runtimeOutput = path.join(resources, "runtime");
  const exclusions = [
    "node_modules", "node_modules/*", ".git", ".git/*",
    ".nodeview-webview", ".nodeview-webview/*", "build", "build/*",
    ...(Array.isArray(config.exclude) ? config.exclude : config.exclude ? [config.exclude] : [])
  ];

  fs.rmSync(appBundle, { recursive: true, force: true });
  fs.mkdirSync(macos, { recursive: true });
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
    appSource = `process.env.NODEVIEW_APP_ICON = ${JSON.stringify(path.join(resources, path.basename(icon)))};\n` + appSource;
  }
  fs.writeFileSync(path.join(appOutput, "app.js"), appSource);

  fs.cpSync(path.join(runtimeRoot, "runtime"), path.join(runtimeOutput, "nodeview"), { recursive: true });
  fs.copyFileSync(addon, path.join(runtimeOutput, "native", "nodeview.node"));
  fs.copyFileSync(options.nodeExecutable ?? process.execPath, path.join(runtimeOutput, "node"));
  fs.chmodSync(path.join(runtimeOutput, "node"), 0o755);

  if (icon) fs.copyFileSync(icon, path.join(resources, path.basename(icon)));
  fs.writeFileSync(path.join(contents, "Info.plist"), createInfoPlist({
    appId,
    appName,
    version,
    iconName: icon && path.basename(icon)
  }));

  const launcherPath = path.join(macos, appName);
  fs.copyFileSync(launcher, launcherPath);
  fs.chmodSync(launcherPath, 0o755);

  if (process.env.NODEVIEW_MAC_SIGN_IDENTITY) {
    signMacApp(appBundle);
  }
  if (process.env.NODEVIEW_MAC_NOTARY_PROFILE) {
    if (!process.env.NODEVIEW_MAC_SIGN_IDENTITY) {
      throw new Error("Notarization requires NODEVIEW_MAC_SIGN_IDENTITY.");
    }
    notarizeMacApp(appBundle);
  }

  const createDmg = options.createDmg ?? (process.platform === "darwin" && !options.allowNonMac);
  if (createDmg) {
    const dmg = createMacDmg(appBundle, options.dmgOptions);
    console.log(`Created macOS disk image: ${dmg}`);
  }

  console.log(`Created macOS app bundle: ${appBundle}`);
  return appBundle;
}

if (require.main === module) {
  const projectRootIndex = process.argv.indexOf("--project-root");
  packageMacApp(projectRootIndex === -1 ? process.cwd() : process.argv[projectRootIndex + 1]);
}

module.exports = { createInfoPlist, createMacDmg, packageMacApp };
