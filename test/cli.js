"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "..", "bin", "nodeviewjs.js");

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
assert.match(fs.readFileSync(path.join(createRoot, "StarterApp", "package.json"), "utf8"), /"installer": "nodeviewjs installer"/);
assert.match(fs.readFileSync(path.join(createRoot, "StarterApp", "package.json"), "utf8"), /"update:manifest": "nodeviewjs update-manifest"/);
assert.match(
  fs.readFileSync(path.join(createRoot, "StarterApp", "app.js"), "utf8"),
  /app\.command\("greet", async \(name\)/
);
assert.match(
  fs.readFileSync(path.join(createRoot, "StarterApp", "index.html"), "utf8"),
  /NodeViewJS\.invoke\("greet", nameInput\.value\)/
);
assert.match(
  fs.readFileSync(path.join(createRoot, "StarterApp", "index.html"), "utf8"),
  /const nameInput = document\.querySelector\("#name"\)/
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

const skipNativeRebuild = process.platform === "win32" && process.env.CI === "true";
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
