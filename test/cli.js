"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "..", "bin", "nodeviewjs.js");
const prerequisiteCheck = path.join(__dirname, "..", "scripts", "check-native-prerequisites.js");

function findPythonExecutable() {
  const configured = process.env.PYTHON || process.env.npm_config_python;
  if (configured) {
    const result = spawnSync(
      configured,
      ["-c", "import sys; print(sys.executable)"],
      { encoding: "utf8" }
    );
    if (result.status === 0) return result.stdout.trim();
    return undefined;
  }
  for (const [command, args] of process.platform === "win32"
    ? [["py", ["-3"]], ["python3", []], ["python", []]]
    : [["python3", []], ["python", []]]) {
    const result = spawnSync(
      command,
      [...args, "-c", "import sys; print(sys.executable)"],
      { encoding: "utf8" }
    );
    if (result.status === 0) return result.stdout.trim();
  }
  return undefined;
}

function hasPython() {
  return Boolean(findPythonExecutable());
}

const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
assert.equal(help.status, 0);
assert.match(help.stdout, /nodeviewjs create/);
assert.match(help.stdout, /nodeviewjs dev/);
assert.match(help.stdout, /nodeviewjs package/);
assert.match(help.stdout, /nodeviewjs installer/);
assert.match(help.stdout, /nodeviewjs update-manifest/);

const missing = spawnSync(process.execPath, [cli, "dev", path.join(__dirname, "fixtures", "missing-app.js")], {
  encoding: "utf8"
});
assert.equal(missing.status, 1);
assert.match(missing.stderr, /App entry file was not found/);

const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-broken-app-"));
const brokenEntry = path.join(brokenRoot, "app.js");
fs.writeFileSync(brokenEntry, "throw new Error('deliberate dev failure');\n");
const broken = spawnSync(process.execPath, [cli, "dev", brokenEntry], { encoding: "utf8" });
assert.equal(broken.status, 1);
assert.match(broken.stderr, /\[NodeViewJS dev\] Backend crashed with an uncaught exception/);
assert.match(broken.stderr, /deliberate dev failure/);

const rejectedEntry = path.join(brokenRoot, "rejected.js");
fs.writeFileSync(rejectedEntry, "Promise.reject(new Error('deliberate rejection'));\n");
const rejected = spawnSync(process.execPath, [cli, "dev", rejectedEntry], { encoding: "utf8" });
assert.equal(rejected.status, 1);
assert.match(rejected.stderr, /\[NodeViewJS dev\] Backend crashed with an unhandled promise rejection/);
assert.match(rejected.stderr, /deliberate rejection/);

const pythonExecutable = findPythonExecutable();
if (pythonExecutable) {
  const configuredPython = spawnSync(process.execPath, [prerequisiteCheck], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${path.dirname(pythonExecutable)}${path.delimiter}${process.env.PATH ?? ""}`,
      PYTHON: path.basename(pythonExecutable)
    }
  });
  assert.equal(configuredPython.status, 0, configuredPython.stderr);
}

const missingPython = spawnSync(process.execPath, [prerequisiteCheck], {
  encoding: "utf8",
  env: {
    ...process.env,
    PYTHON: path.join(brokenRoot, "missing-python.exe")
  }
});
assert.equal(missingPython.status, 1);
assert.match(missingPython.stderr, /NodeViewJS native builds require Python 3 for node-gyp/);
assert.match(missingPython.stderr, /winget install Python\.Python\.3\.12/);

const buildScript = fs.readFileSync(path.join(__dirname, "..", "scripts", "build.ps1"), "utf8");
assert.ok(
  buildScript.indexOf("check-native-prerequisites.js")
    < buildScript.indexOf("setup-webview2.ps1"),
  "Native prerequisite checks must run before WebView2 setup."
);

const createRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-create-"));
const created = spawnSync(process.execPath, [cli, "create", "StarterApp"], {
  cwd: createRoot,
  encoding: "utf8"
});
assert.equal(created.status, 0, created.stderr);
assert.ok(fs.existsSync(path.join(createRoot, "StarterApp", "package.json")));
assert.ok(fs.existsSync(path.join(createRoot, "StarterApp", "app.js")));
assert.ok(fs.existsSync(path.join(createRoot, "StarterApp", "index.html")));
assert.ok(fs.existsSync(path.join(createRoot, "StarterApp", "assets", ".gitkeep")));
assert.ok(fs.existsSync(path.join(createRoot, "StarterApp", "assets", "README.md")));
assert.match(fs.readFileSync(path.join(createRoot, "StarterApp", "package.json"), "utf8"), /"package": "nodeviewjs package"/);

// examples/basic is the canonical starter: it runs against the repository
// runtime and is what `nodeviewjs create` generates.
const basicBackend = fs.readFileSync(path.join(__dirname, "..", "examples", "basic", "app.js"), "utf8");
const basicFrontend = fs.readFileSync(path.join(__dirname, "..", "examples", "basic", "index.html"), "utf8");
assert.match(basicBackend, /require\("\.\.\/\.\.\/runtime"\)/);
assert.match(basicBackend, /app\.command\("note:save", \{ permission: "fs:write" \}/);
assert.match(basicBackend, /app\.emit\("note:saved"/);
assert.match(basicFrontend, /NodeViewJS\.invoke\("note:load"\)/);
assert.match(fs.readFileSync(path.join(createRoot, "StarterApp", "package.json"), "utf8"), /"installer": "nodeviewjs installer"/);
assert.match(fs.readFileSync(path.join(createRoot, "StarterApp", "package.json"), "utf8"), /"update:manifest": "nodeviewjs update-manifest"/);
// The generated app is the canonical starter from examples/basic, retargeted
// at the installed package. These assertions pin that relationship: if the two
// drift, the documentation and the smoke tests stop describing the same app.
const generatedApp = fs.readFileSync(path.join(createRoot, "StarterApp", "app.js"), "utf8");
const generatedPage = fs.readFileSync(path.join(createRoot, "StarterApp", "index.html"), "utf8");
const starterApp = fs.readFileSync(path.join(__dirname, "..", "examples", "basic", "app.js"), "utf8");
const starterPage = fs.readFileSync(path.join(__dirname, "..", "examples", "basic", "index.html"), "utf8");

// Retargeted at the package, with no path back into the repository.
assert.match(generatedApp, /require\("nodeviewjs"\)/);
assert.equal(generatedApp.includes("../../runtime"), false);
assert.equal(generatedApp.includes("canonical NodeViewJS starter"), false);
assert.match(generatedApp, /created with `nodeviewjs create`/);

// Named after the created app rather than the starter.
assert.match(generatedApp, /const APP_TITLE = "Starter App";/);
assert.match(generatedApp, /const APP_ID = "starter-app";/);
assert.equal(generatedApp.includes("NodeViewJS Starter"), false);
assert.equal(generatedPage.includes("NodeViewJS Starter"), false);
assert.match(generatedPage, /<title>Starter App<\/title>/);

// Generated files are written with CRLF endings. A CRLF checkout of the
// starter used to be converted a second time, producing CR CR LF, and the
// comment strip above used to miss for the same reason.
for (const [name, contents] of [["app.js", generatedApp], ["index.html", generatedPage]]) {
  assert.equal(/\r\r/.test(contents), false, `${name} was given doubled carriage returns`);
  assert.equal(/[^\r]\n/.test(contents), false, `${name} mixes bare newlines with CRLF`);
}

// The generated file must be valid JavaScript.
new (require("node:vm").Script)(generatedApp, { filename: "app.js" });

// Everything the starter is supposed to demonstrate survives generation.
for (const [label, pattern] of [
  ["a declared permission policy", /permissions: \["fs:read", "fs:write"\]/],
  ["a native menu", /menu: \[/],
  ["a permission-gated read command", /app\.command\("note:load", \{ permission: "fs:read" \}/],
  ["a permission-gated write command", /app\.command\("note:save", \{ permission: "fs:write" \}/],
  ["payload validation", /function requireText\(payload\)/],
  ["a backend-to-frontend event", /app\.emit\("note:saved"/],
  ["a menu event handler", /app\.on\("menu", /],
  ["an update configuration stub", /const updater = new Updater\(\{/],
  ["error handling around notifications", /Notification unavailable/]
]) {
  assert.match(generatedApp, pattern, `generated app is missing ${label}`);
}

for (const [label, pattern] of [
  ["a command call", /NodeViewJS\.invoke\("note:save"/],
  ["an event subscription", /NodeViewJS\.on\("note:saved"/],
  ["rejection handling", /catch \(error\) \{/]
]) {
  assert.match(generatedPage, pattern, `generated page is missing ${label}`);
}

// The starter and the generated app differ only by the retargeting: comments,
// the two name constants, the require path, and the title. Normalizing those
// away, the files must be identical, so neither can quietly drift.
function normalizeStarter(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.trimStart().startsWith("//"))
    .filter((line) => !line.startsWith("const APP_TITLE") && !line.startsWith("const APP_ID"))
    .map((line) => line.split("../../runtime").join("nodeviewjs"))
    .map((line) => line.split("NodeViewJS Starter").join("Starter App"))
    .join("\n");
}

assert.equal(
  normalizeStarter(generatedApp),
  normalizeStarter(starterApp),
  "the generated app has drifted from examples/basic/app.js"
);
assert.equal(
  normalizeStarter(generatedPage),
  normalizeStarter(starterPage),
  "the generated page has drifted from examples/basic/index.html"
);

const blocked = spawnSync(process.execPath, [cli, "create", "StarterApp"], {
  cwd: createRoot,
  encoding: "utf8"
});
assert.equal(blocked.status, 1);
assert.match(blocked.stderr, /Target folder is not empty/);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-cli-app-"));
fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
  name: "external-nodeview-app",
  version: "0.1.0",
  nodeviewjs: {
    name: "ExternalDemo",
    entry: "app.js",
    protocols: [{ scheme: "external-demo", name: "External Demo URL" }],
    fileAssociations: [{ extension: ".external", name: "External Demo file" }],
    icon: "assets/app.ico",
    include: ["assets"],
    exclude: ["assets\\private", "assets\\private\\*"]
  }
}, null, 2));
fs.writeFileSync(path.join(fixture, "app.js"), `
"use strict";

const path = require("node:path");
const { App } = require("nodeviewjs");

const app = new App({
  title: "External Demo",
  entry: path.join(__dirname, "index.html")
});

app.command("bridge-ready", () => {
  require("node:fs").writeFileSync(path.join(__dirname, "bridge-result.txt"), "ready");
  setTimeout(() => app.quit(), 0);
  return "ready";
});

app.run();
`);
fs.writeFileSync(
  path.join(fixture, "index.html"),
  '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'">' +
    '<title>External Demo</title></head>' +
    '<body><script src="frontend.js"></script></body></html>'
);
fs.writeFileSync(path.join(fixture, "frontend.js"), 'NodeViewJS.invoke("bridge-ready");');
fs.mkdirSync(path.join(fixture, "assets", "private"), { recursive: true });
fs.writeFileSync(path.join(fixture, "assets", "app.ico"), Buffer.from([
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00,
  0x30, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  0x28, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x80, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00
]));
fs.writeFileSync(path.join(fixture, "assets", "logo.txt"), "logo");
fs.writeFileSync(path.join(fixture, "assets", "private", "secret.txt"), "secret");

const skipNativeRebuild = process.platform === "win32"
  && (process.env.CI === "true" || !hasPython());
const packaged = spawnSync(process.execPath, [cli, "package"], {
  cwd: fixture,
  encoding: "utf8",
  env: {
    ...process.env,
    ...(skipNativeRebuild ? { NODEVIEW_SKIP_NATIVE_REBUILD: "1" } : {})
  },
  timeout: 120_000
});
assert.equal(packaged.error, undefined, packaged.error?.message);
assert.equal(packaged.status, 0, packaged.stderr);
const packagedRoot = process.platform === "darwin"
  ? path.join(fixture, "build", "macos", "ExternalDemo.app", "Contents", "Resources")
  : process.platform === "linux"
    ? path.join(fixture, "build", "linux", "ExternalDemo", "resources")
    : path.join(fixture, "build", "portable", "ExternalDemo", "resources");
assert.ok(fs.existsSync(process.platform === "darwin"
  ? path.join(fixture, "build", "macos", "ExternalDemo.app", "Contents", "MacOS", "ExternalDemo")
  : process.platform === "linux"
    ? path.join(fixture, "build", "linux", "ExternalDemo", "ExternalDemo")
    : path.join(fixture, "build", "portable", "ExternalDemo", "ExternalDemo.exe")));
assert.ok(fs.existsSync(path.join(packagedRoot, "app", "app.js")));
assert.match(
  fs.readFileSync(path.join(packagedRoot, "app", "index.html"), "utf8"),
  /data-nodeview-bridge="embedded"[^>]+src="__nodeview\/bridge\.js"/
);
assert.ok(fs.existsSync(path.join(packagedRoot, "app", "__nodeview", "bridge.js")));
assert.ok(fs.existsSync(path.join(packagedRoot, "app", "assets", "app.ico")));
assert.ok(fs.existsSync(path.join(packagedRoot, "app", "assets", "logo.txt")));
assert.ok(!fs.existsSync(path.join(packagedRoot, "app", "assets", "private", "secret.txt")));
if (process.platform === "win32") {
  assert.ok(fs.existsSync(path.join(packagedRoot, "integrity.manifest")));
  assert.ok(fs.existsSync(path.join(packagedRoot, "runtime", "nodeview.js")));
  assert.ok(fs.existsSync(path.join(packagedRoot, "runtime", "apply-update.ps1")));
  assert.ok(fs.existsSync(path.join(packagedRoot, "runtime", "nodeview.node")));
  assert.equal(fs.existsSync(path.join(packagedRoot, "runtime", "nodeview")), false);
} else {
  assert.ok(fs.existsSync(path.join(packagedRoot, "runtime", "nodeview", "index.js")));
  assert.ok(fs.existsSync(path.join(packagedRoot, "runtime", "native", "nodeview.node")));
}
assert.match(
  fs.readFileSync(path.join(packagedRoot, "app", "app.js"), "utf8"),
  /NODEVIEW_BRIDGE_EMBEDDED = "1"/
);
if (process.platform === "win32") {
  const portableRoot = path.join(fixture, "build", "portable", "ExternalDemo");
  assert.deepEqual(fs.readdirSync(portableRoot).sort(), ["ExternalDemo.exe", "resources"]);
  assert.deepEqual(
    fs.readdirSync(path.join(packagedRoot, "runtime")).sort(),
    ["apply-update.ps1", "node.exe", "nodeview.js", "nodeview.node"]
  );
  assert.equal(fs.existsSync(path.join(packagedRoot, "native")), false);
  const packagedApp = fs.readFileSync(path.join(packagedRoot, "app", "app.js"), "utf8");
  assert.match(packagedApp, /NODEVIEW_PROTOCOLS/);
  assert.match(packagedApp, /external-demo/);
  assert.match(packagedApp, /NODEVIEW_FILE_ASSOCIATIONS/);
  assert.match(packagedApp, /\.external/);
}

if (process.platform === "win32" && !skipNativeRebuild) {
  const packagedExe = path.join(fixture, "build", "portable", "ExternalDemo", "ExternalDemo.exe");
  const versionInfo = spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    "& { param($file) (Get-Item -LiteralPath $file).VersionInfo | Select-Object ProductName, OriginalFilename | ConvertTo-Json -Compress }",
    packagedExe
  ], { encoding: "utf8" });
  assert.equal(versionInfo.status, 0, versionInfo.stderr);
  assert.deepEqual(JSON.parse(versionInfo.stdout), {
    ProductName: "ExternalDemo",
    OriginalFilename: "ExternalDemo.exe"
  });

  const packagedBridgeResult = path.join(packagedRoot, "app", "bridge-result.txt");
  const launched = spawnSync(packagedExe, [], {
    encoding: "utf8",
    env: {
      ...process.env,
      LOCALAPPDATA: path.join(fixture, "local-app-data")
    },
    timeout: 20_000
  });
  assert.equal(launched.error, undefined, launched.error?.message);
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(fs.readFileSync(packagedBridgeResult, "utf8"), "ready");
}

console.log("CLI test passed.");
