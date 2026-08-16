"use strict";

// Every probe the doctor uses is injected here, so the failure paths are tested
// on a machine where the tools are actually present.

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { collectChecks, formatReport, runDoctor, MINIMUM_NODE_MAJOR } = require("../scripts/doctor");

const cli = path.join(__dirname, "..", "bin", "nodeviewjs.js");

function byId(checks, id) {
  const entry = checks.find((check) => check.id === id);
  assert.ok(entry, `missing check: ${id}`);
  return entry;
}

// A machine with nothing installed: every probe fails and no file exists.
function missingEverything(overrides = {}) {
  return {
    platform: "win32",
    nodeVersion: "20.11.0",
    env: {},
    exec: () => ({ status: 1, stdout: "", stderr: "" }),
    exists: () => false,
    loadNative: () => ({ ok: false, message: "addon not built" }),
    ...overrides
  };
}

// A fully equipped machine, per platform.
function healthy(platform, overrides = {}) {
  const execByPlatform = {
    win32(command, args) {
      if (command.endsWith("vswhere.exe")) {
        return { status: 0, stdout: "C:\\BuildTools\n", stderr: "" };
      }
      if (command === "reg") return { status: 0, stdout: "pv REG_SZ 120.0\n", stderr: "" };
      if (command === "powershell") return { status: 0, stdout: "5\n", stderr: "" };
      if (command === "py") return { status: 0, stdout: "Python 3.12.1\n", stderr: "" };
      return { status: 1, stdout: "", stderr: "" };
    },
    darwin(command) {
      if (command === "xcode-select") return { status: 0, stdout: "/Library/Developer/CommandLineTools\n", stderr: "" };
      if (command === "hdiutil" || command === "codesign") return { status: 0, stdout: "", stderr: "" };
      if (command === "python3") return { status: 0, stdout: "Python 3.11.6\n", stderr: "" };
      return { status: 1, stdout: "", stderr: "" };
    },
    linux(command) {
      if (command === "pkg-config") return { status: 0, stdout: "", stderr: "" };
      if (command === "python3") return { status: 0, stdout: "Python 3.12.3\n", stderr: "" };
      return { status: 1, stdout: "", stderr: "" };
    }
  };

  return {
    platform,
    nodeVersion: "22.11.0",
    env: { WINDIR: "C:\\Windows", "ProgramFiles(x86)": "C:\\Program Files (x86)" },
    exec: execByPlatform[platform],
    exists: () => true,
    loadNative: () => ({ ok: true }),
    ...overrides
  };
}

// Argument validation.
assert.throws(() => collectChecks(null), /must be an object/);
assert.throws(() => collectChecks([]), /must be an object/);
assert.throws(() => collectChecks({ platform: "" }), /platform must be a non-empty string/);
assert.throws(() => collectChecks({ nodeVersion: 22 }), /nodeVersion must be a non-empty string/);
assert.throws(() => collectChecks({ env: [] }), /env must be an object/);
assert.throws(() => collectChecks({ exec: "sh" }), /exec must be a function/);
assert.throws(() => collectChecks({ exists: 1 }), /exists must be a function/);
assert.throws(() => collectChecks({ loadNative: null }), /loadNative must be a function/);
assert.throws(() => collectChecks({ signing: "yes" }), /signing must be a boolean/);
assert.throws(() => formatReport("checks"), /requires an array/);

// Healthy machines report no failures on any supported platform.
for (const platform of ["win32", "darwin", "linux"]) {
  const checks = collectChecks(healthy(platform));
  const failures = checks.filter((check) => check.status === "fail");
  assert.deepEqual(failures, [], `${platform} healthy report had failures`);
  assert.equal(byId(checks, "webview").status, "ok");
  assert.equal(byId(checks, "toolchain").status, "ok");
  assert.equal(byId(checks, "python").status, "ok");
  // Signing stays off the default report so a developer machine is not warned
  // about a release-only prerequisite.
  assert.equal(checks.some((check) => check.id === "signing"), false);
  assert.match(formatReport(checks), /Everything required is present\./);
}

// A bare machine fails every required check and offers a fix for each.
const bare = collectChecks(missingEverything());
for (const id of ["native-addon", "python", "toolchain", "webview"]) {
  const entry = byId(bare, id);
  assert.equal(entry.status, "fail", `${id} should fail on a bare machine`);
  assert.ok(entry.fix && entry.fix.length > 0, `${id} must suggest a fix`);
}
assert.match(byId(bare, "native-addon").detail, /has not been built/);
assert.match(byId(bare, "python").fix, /winget install Python/);
assert.match(byId(bare, "toolchain").fix, /VisualStudio/);
assert.match(byId(bare, "webview").fix, /EdgeWebView2Runtime/);
assert.match(formatReport(bare), /checks failed/);

// Node version gate.
assert.equal(byId(collectChecks(healthy("linux", { nodeVersion: "18.20.4" })), "node").status, "fail");
assert.match(
  byId(collectChecks(healthy("linux", { nodeVersion: "18.20.4" })), "node").fix,
  new RegExp(`Node\\.js ${MINIMUM_NODE_MAJOR} or newer`)
);
assert.equal(byId(collectChecks(healthy("linux", { nodeVersion: "20.0.0" })), "node").status, "ok");
assert.equal(byId(collectChecks(healthy("linux", { nodeVersion: "not-a-version" })), "node").status, "fail");

// A present but unloadable addon is a different failure from a missing one:
// the usual cause is a Node.js major version change.
const brokenAddon = collectChecks(healthy("win32", {
  loadNative: () => ({ ok: false, message: "NODE_MODULE_VERSION mismatch" })
}));
assert.equal(byId(brokenAddon, "native-addon").status, "fail");
assert.match(byId(brokenAddon, "native-addon").detail, /NODE_MODULE_VERSION mismatch/);
assert.match(byId(brokenAddon, "native-addon").fix, /npm run build/);

// WebView2 registered only for the current user still counts as installed.
const userScopedWebView = collectChecks(healthy("win32", {
  exec(command, args) {
    if (command === "reg") {
      return args[1].startsWith("HKCU")
        ? { status: 0, stdout: "pv REG_SZ 120.0\n", stderr: "" }
        : { status: 1, stdout: "", stderr: "" };
    }
    return healthy("win32").exec(command, args);
  }
}));
assert.equal(byId(userScopedWebView, "webview").status, "ok");

// Missing IExpress only blocks the installer, so it warns rather than fails.
const noIExpress = collectChecks(healthy("win32", {
  exists: (candidate) => !candidate.endsWith("iexpress.exe")
}));
assert.equal(byId(noIExpress, "packaging").status, "warn");
assert.match(byId(noIExpress, "packaging").detail, /Portable packaging works/);
assert.match(formatReport(noIExpress), /optional item/);

// A configured PYTHON overrides interpreter discovery.
const configuredPython = collectChecks(healthy("linux", {
  env: { PYTHON: "/opt/python3/bin/python3" },
  exec(command) {
    if (command === "/opt/python3/bin/python3") return { status: 0, stdout: "Python 3.12.0\n", stderr: "" };
    if (command === "pkg-config") return { status: 0, stdout: "", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  }
}));
assert.equal(byId(configuredPython, "python").status, "ok");

// A Python 2 interpreter is not accepted.
const python2 = collectChecks(healthy("linux", {
  exec(command) {
    if (command === "pkg-config") return { status: 0, stdout: "", stderr: "" };
    if (command === "python3" || command === "python") {
      return { status: 0, stdout: "Python 2.7.18\n", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "" };
  }
}));
assert.equal(byId(python2, "python").status, "fail");

// Signing checks appear only when requested.
const unsignedWindows = collectChecks(healthy("win32", { signing: true }));
assert.equal(byId(unsignedWindows, "signing").status, "warn");
assert.match(byId(unsignedWindows, "signing").detail, /unsigned/);
assert.equal(byId(unsignedWindows, "update-signing").status, "warn");

const signedWindows = collectChecks(healthy("win32", {
  signing: true,
  env: {
    WINDIR: "C:\\Windows",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    NODEVIEW_SIGN_THUMBPRINT: "AA".repeat(20),
    NODEVIEW_UPDATE_PRIVATE_KEY: "C:\\secure\\update.pem"
  }
}));
assert.equal(byId(signedWindows, "signing").status, "ok");
assert.equal(byId(signedWindows, "update-signing").status, "ok");

// A certificate without a timestamp URL produces signatures that expire.
const untimestamped = collectChecks(healthy("win32", {
  signing: true,
  env: {
    WINDIR: "C:\\Windows",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    NODEVIEW_SIGN_CERTIFICATE: "C:\\secure\\sign.pfx"
  }
}));
assert.equal(byId(untimestamped, "signing").status, "warn");
assert.match(byId(untimestamped, "signing").fix, /NODEVIEW_SIGN_TIMESTAMP_URL/);

// macOS signing configured without the tools present is a failure, not a warning.
const macMissingCodesign = collectChecks(healthy("darwin", {
  signing: true,
  env: { NODEVIEW_MAC_SIGN_IDENTITY: "Developer ID Application: Example" },
  exec(command) {
    if (command === "xcode-select") return { status: 0, stdout: "/tools\n", stderr: "" };
    if (command === "python3") return { status: 0, stdout: "Python 3.11.6\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  }
}));
assert.equal(byId(macMissingCodesign, "signing").status, "fail");

// An unsupported platform is reported rather than crashing.
const unsupported = collectChecks(missingEverything({ platform: "aix" }));
assert.equal(byId(unsupported, "toolchain").status, "fail");
assert.match(byId(unsupported, "toolchain").detail, /does not support aix/);
assert.equal(byId(unsupported, "webview").status, "fail");

// The report names every check and only prints fixes for the ones that need one.
const report = formatReport(collectChecks(healthy("linux")));
for (const title of ["Node.js version", "Native addon", "Python 3", "System WebView"]) {
  assert.ok(report.includes(title), `report is missing ${title}`);
}
assert.equal(report.includes("         "), false, "a healthy report must not print fixes");

// runDoctor reports its outcome through the exit code.
const lines = [];
const exitCode = runDoctor([], { log: (line) => lines.push(line) });
assert.ok(exitCode === 0 || exitCode === 1);
assert.match(lines.join("\n"), /NodeViewJS doctor/);

const json = [];
runDoctor(["--json"], { log: (line) => json.push(line) });
const parsed = JSON.parse(json.join("\n"));
assert.ok(Array.isArray(parsed.checks));
assert.deepEqual(
  parsed.checks.map((check) => check.id),
  ["node", "native-addon", "python", "toolchain", "webview", "packaging"]
);

const signingJson = [];
runDoctor(["--json", "--signing"], { log: (line) => signingJson.push(line) });
assert.ok(JSON.parse(signingJson.join("\n")).checks.some((check) => check.id === "signing"));

// The CLI exposes it. What is asserted here is the command's contract — valid
// output and an exit code that matches the report — not which tools happen to
// be installed on the machine running the tests.
const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
assert.match(help.stdout, /nodeviewjs doctor/);

const cliRun = spawnSync(process.execPath, [cli, "doctor", "--json"], { encoding: "utf8" });
const cliChecks = JSON.parse(cliRun.stdout).checks;
assert.deepEqual(
  cliChecks.map((check) => check.id),
  ["node", "native-addon", "python", "toolchain", "webview", "packaging"]
);
for (const entry of cliChecks) {
  assert.ok(["ok", "warn", "fail"].includes(entry.status), `bad status: ${entry.status}`);
  assert.ok(typeof entry.detail === "string" && entry.detail.length > 0);
  if (entry.status !== "ok") assert.ok(entry.fix, `${entry.id} must suggest a fix`);
}
assert.equal(
  cliRun.status,
  cliChecks.some((check) => check.status === "fail") ? 1 : 0,
  "exit code must match whether a required check failed"
);

console.log("Doctor diagnostics test passed.");
