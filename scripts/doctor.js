#!/usr/bin/env node
"use strict";

// `nodeviewjs doctor` answers one question: can this machine build, run, and
// package a NodeViewJS app, and if not, what exactly should be installed?
// Every probe is injectable so the checks can be tested without the tools
// actually being present.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { hasUsablePython } = require("./check-native-prerequisites");

const MINIMUM_NODE_MAJOR = 20;
const WEBVIEW2_CLIENT_KEY = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
const packageRoot = path.join(__dirname, "..");

function defaultExec(command, args) {
  return spawnSync(command, args, { encoding: "utf8", windowsHide: true });
}

function defaultLoadNative() {
  try {
    require("../runtime/native");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function succeeded(result) {
  return Boolean(result) && !result.error && result.status === 0;
}

function output(result) {
  if (!result) return "";
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function check(id, title, status, detail, fix) {
  const entry = { id, title, status, detail };
  if (fix !== undefined) entry.fix = fix;
  return entry;
}

function checkNode(nodeVersion) {
  const major = Number.parseInt(nodeVersion.split(".", 1)[0], 10);
  if (!Number.isInteger(major)) {
    return check(
      "node",
      "Node.js version",
      "fail",
      `Could not read a version number from "${nodeVersion}".`,
      `Install Node.js ${MINIMUM_NODE_MAJOR} or newer.`
    );
  }
  if (major < MINIMUM_NODE_MAJOR) {
    return check(
      "node",
      "Node.js version",
      "fail",
      `Node.js ${nodeVersion} is older than the supported minimum.`,
      `Install Node.js ${MINIMUM_NODE_MAJOR} or newer, then reinstall dependencies.`
    );
  }
  return check("node", "Node.js version", "ok", `Node.js ${nodeVersion}`);
}

function checkNativeAddon(exists, loadNative) {
  const candidates = [
    path.join(packageRoot, "build", "nodeview", "nodeview.node"),
    path.join(packageRoot, "runtime", "nodeview.node"),
    path.join(packageRoot, "native", "nodeview.node")
  ];
  const found = candidates.find((candidate) => exists(candidate));
  if (!found) {
    return check(
      "native-addon",
      "Native addon",
      "fail",
      "The native addon has not been built for this installation.",
      "Run `npm run build` inside NodeViewJS, or reinstall the package."
    );
  }

  const loaded = loadNative();
  if (!loaded.ok) {
    return check(
      "native-addon",
      "Native addon",
      "fail",
      `The addon at ${found} could not be loaded: ${loaded.message}`,
      "Rebuild it with `npm run build`. A rebuild is required after changing Node.js major versions."
    );
  }
  return check("native-addon", "Native addon", "ok", found);
}

function checkPython(exec, env, platform) {
  if (hasUsablePython({ exec, env, platform })) {
    return check("python", "Python 3 (node-gyp)", "ok", "A usable Python 3 was found.");
  }
  return check(
    "python",
    "Python 3 (node-gyp)",
    "fail",
    "node-gyp could not find a Python 3 interpreter.",
    platform === "win32"
      ? "Install it with `winget install Python.Python.3.12`, or set PYTHON to an existing python.exe."
      : "Install Python 3 from your package manager, or set PYTHON to an existing interpreter."
  );
}

function checkToolchain(exec, env, platform) {
  if (platform === "win32") {
    const programFiles = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const vswhere = path.join(programFiles, "Microsoft Visual Studio", "Installer", "vswhere.exe");
    const result = exec(vswhere, [
      "-products", "*",
      "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property", "installationPath",
      "-latest"
    ]);
    const installation = succeeded(result) ? output(result).trim() : "";
    if (installation.length > 0) {
      return check("toolchain", "C++ build tools", "ok", installation.split(/\r?\n/)[0]);
    }
    return check(
      "toolchain",
      "C++ build tools",
      "fail",
      "Visual Studio 2022 with the Desktop development with C++ workload was not found.",
      "Install it with `winget install Microsoft.VisualStudio.2022.BuildTools --override \"--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended\"`."
    );
  }

  if (platform === "darwin") {
    const result = exec("xcode-select", ["-p"]);
    if (succeeded(result)) {
      return check("toolchain", "C++ build tools", "ok", output(result).trim());
    }
    return check(
      "toolchain",
      "C++ build tools",
      "fail",
      "The Xcode command-line tools were not found.",
      "Install them with `xcode-select --install`."
    );
  }

  if (platform === "linux") {
    const missing = ["gtk+-3.0", "webkit2gtk-4.1"].filter(
      (library) => !succeeded(exec("pkg-config", ["--exists", library]))
    );
    if (missing.length === 0) {
      return check("toolchain", "C++ build tools", "ok", "GTK 3 and WebKitGTK 4.1 development files were found.");
    }
    return check(
      "toolchain",
      "C++ build tools",
      "fail",
      `Missing development packages: ${missing.join(", ")}.`,
      "Install them with `sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config`."
    );
  }

  return check(
    "toolchain",
    "C++ build tools",
    "fail",
    `NodeViewJS does not support ${platform}.`,
    "Use Windows, macOS, or Linux."
  );
}

function checkWebView(exec, platform) {
  if (platform === "win32") {
    const installed = [
      ["HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients", WEBVIEW2_CLIENT_KEY],
      ["HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients", WEBVIEW2_CLIENT_KEY]
    ].some(([root, key]) => succeeded(exec("reg", ["query", `${root}\\${key}`, "/v", "pv"])));

    if (installed) {
      return check("webview", "System WebView", "ok", "The Microsoft Edge WebView2 Runtime is installed.");
    }
    return check(
      "webview",
      "System WebView",
      "fail",
      "The Microsoft Edge WebView2 Runtime was not found. Windows will open a blank window without it.",
      "Install it with `winget install Microsoft.EdgeWebView2Runtime`."
    );
  }

  if (platform === "darwin") {
    return check("webview", "System WebView", "ok", "WKWebView ships with macOS.");
  }

  if (platform === "linux") {
    if (succeeded(exec("pkg-config", ["--exists", "webkit2gtk-4.1"]))) {
      return check("webview", "System WebView", "ok", "WebKitGTK 4.1 was found.");
    }
    return check(
      "webview",
      "System WebView",
      "fail",
      "WebKitGTK 4.1 was not found.",
      "Install it with `sudo apt-get install libwebkit2gtk-4.1-0`, or the equivalent for your distribution."
    );
  }

  return check("webview", "System WebView", "fail", `No system WebView is supported on ${platform}.`);
}

function checkPackaging(exec, env, exists, platform) {
  if (platform === "win32") {
    const powershell = succeeded(exec("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"]));
    const windowsDirectory = env.WINDIR ?? "C:\\Windows";
    const iexpress = exists(path.join(windowsDirectory, "System32", "iexpress.exe"));
    if (powershell && iexpress) {
      return check("packaging", "Packaging prerequisites", "ok", "PowerShell and IExpress are available.");
    }
    if (!powershell) {
      return check(
        "packaging",
        "Packaging prerequisites",
        "fail",
        "Windows PowerShell was not found; portable packaging and the installer both use it.",
        "Repair the Windows PowerShell feature, or add it back to PATH."
      );
    }
    return check(
      "packaging",
      "Packaging prerequisites",
      "warn",
      "IExpress was not found. Portable packaging works; `nodeviewjs installer` does not.",
      "Enable the Windows IExpress component, or ship the portable folder instead."
    );
  }

  if (platform === "darwin") {
    if (succeeded(exec("hdiutil", ["help"]))) {
      return check("packaging", "Packaging prerequisites", "ok", "hdiutil is available for DMG creation.");
    }
    return check(
      "packaging",
      "Packaging prerequisites",
      "warn",
      "hdiutil was not found. The .app bundle still builds; the DMG step does not.",
      "hdiutil ships with macOS. Check PATH if this is unexpected."
    );
  }

  return check("packaging", "Packaging prerequisites", "ok", "Linux packaging needs no extra tools.");
}

function checkSigning(exec, env, platform) {
  if (platform === "win32") {
    const configured = Boolean(env.NODEVIEW_SIGN_CERTIFICATE || env.NODEVIEW_SIGN_THUMBPRINT);
    if (!configured) {
      return check(
        "signing",
        "Code signing",
        "warn",
        "No signing identity is configured; packages will be unsigned and may trigger SmartScreen.",
        "Set NODEVIEW_SIGN_CERTIFICATE (with NODEVIEW_SIGN_PASSWORD) or NODEVIEW_SIGN_THUMBPRINT."
      );
    }
    if (env.NODEVIEW_SIGN_CERTIFICATE && !env.NODEVIEW_SIGN_TIMESTAMP_URL) {
      return check(
        "signing",
        "Code signing",
        "warn",
        "A signing certificate is configured without a timestamp URL, so signatures expire with the certificate.",
        "Set NODEVIEW_SIGN_TIMESTAMP_URL to an RFC 3161 timestamp service."
      );
    }
    return check("signing", "Code signing", "ok", "A Windows signing identity is configured.");
  }

  if (platform === "darwin") {
    if (!env.NODEVIEW_MAC_SIGN_IDENTITY) {
      return check(
        "signing",
        "Code signing",
        "warn",
        "NODEVIEW_MAC_SIGN_IDENTITY is not set, so the app will not be signed or notarized.",
        "Set it to a Developer ID Application identity, and NODEVIEW_MAC_NOTARY_PROFILE to notarize."
      );
    }
    if (!succeeded(exec("codesign", ["--help"]))) {
      return check(
        "signing",
        "Code signing",
        "fail",
        "A signing identity is configured but codesign was not found.",
        "Install the Xcode command-line tools with `xcode-select --install`."
      );
    }
    return check("signing", "Code signing", "ok", "A macOS signing identity is configured.");
  }

  return check("signing", "Code signing", "ok", "Linux packages are not signed by NodeViewJS.");
}

function checkUpdateSigning(env) {
  if (!env.NODEVIEW_UPDATE_PRIVATE_KEY) {
    return check(
      "update-signing",
      "Update signing key",
      "warn",
      "NODEVIEW_UPDATE_PRIVATE_KEY is not set, so update manifests cannot be signed.",
      "Point it at an Ed25519 private key kept outside the repository."
    );
  }
  return check("update-signing", "Update signing key", "ok", "An update signing key is configured.");
}

function collectChecks(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Doctor options must be an object.");
  }

  // Only an absent option falls back to the live probe. A supplied null is a
  // caller mistake, not a request for the default.
  function resolve(name, fallback, isValid, requirement) {
    const value = options[name];
    if (value === undefined) return fallback;
    if (!isValid(value)) throw new TypeError(`Doctor ${name} must be ${requirement}.`);
    return value;
  }

  const isFunction = (value) => typeof value === "function";
  const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
  const isPlainObject = (value) =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const platform = resolve("platform", process.platform, isNonEmptyString, "a non-empty string");
  const nodeVersion = resolve("nodeVersion", process.versions.node, isNonEmptyString, "a non-empty string");
  const env = resolve("env", process.env, isPlainObject, "an object");
  const exec = resolve("exec", defaultExec, isFunction, "a function");
  const exists = resolve("exists", fs.existsSync, isFunction, "a function");
  const loadNative = resolve("loadNative", defaultLoadNative, isFunction, "a function");
  const signing = resolve("signing", false, (value) => typeof value === "boolean", "a boolean");

  const checks = [
    checkNode(nodeVersion),
    checkNativeAddon(exists, loadNative),
    checkPython(exec, env, platform),
    checkToolchain(exec, env, platform),
    checkWebView(exec, platform),
    checkPackaging(exec, env, exists, platform)
  ];

  // Signing is only a prerequisite when someone intends to sign, so it stays
  // off the default report instead of warning on every developer machine.
  if (signing) {
    checks.push(checkSigning(exec, env, platform), checkUpdateSigning(env));
  }

  return checks;
}

function formatReport(checks) {
  if (!Array.isArray(checks)) {
    throw new TypeError("Doctor report requires an array of checks.");
  }

  const symbols = { ok: "ok  ", warn: "warn", fail: "FAIL" };
  const lines = ["NodeViewJS doctor", ""];
  for (const entry of checks) {
    lines.push(`  [${symbols[entry.status] ?? "?   "}] ${entry.title}: ${entry.detail}`);
    if (entry.status !== "ok" && entry.fix) {
      lines.push(`         ${entry.fix}`);
    }
  }

  const failures = checks.filter((entry) => entry.status === "fail").length;
  const warnings = checks.filter((entry) => entry.status === "warn").length;
  lines.push("");
  if (failures > 0) {
    lines.push(`${failures} check${failures === 1 ? "" : "s"} failed. Fix the items above, then run doctor again.`);
  } else if (warnings > 0) {
    lines.push(`Everything required is present. ${warnings} optional item${warnings === 1 ? "" : "s"} to review.`);
  } else {
    lines.push("Everything required is present.");
  }
  return lines.join("\n");
}

function runDoctor(argv = [], streams = {}) {
  const log = streams.log ?? console.log;
  const signing = argv.includes("--signing");
  const checks = collectChecks({ signing });
  if (argv.includes("--json")) {
    log(JSON.stringify({ checks }, null, 2));
  } else {
    log(formatReport(checks));
  }
  return checks.some((entry) => entry.status === "fail") ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = runDoctor(process.argv.slice(2));
}

module.exports = { collectChecks, formatReport, runDoctor, MINIMUM_NODE_MAJOR };
