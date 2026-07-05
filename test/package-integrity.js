"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  MANIFEST_NAME,
  generateIntegrityManifest,
  parseIntegrityManifest
} = require("../scripts/package-integrity");

if (process.platform !== "win32") {
  console.log("Package integrity test skipped outside Windows.");
  process.exit(0);
}

const root = path.join(__dirname, "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-integrity-"));
const project = path.join(temporaryRoot, "project");
const pristine = path.join(temporaryRoot, "pristine");
const appName = "IntegrityTest";

function launch(packageRoot, marker) {
  fs.rmSync(marker, { force: true });
  return spawnSync(path.join(packageRoot, `${appName}.exe`), [], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODEVIEW_INTEGRITY_STARTED: marker,
      NODEVIEW_NO_ERROR_DIALOG: "1"
    },
    timeout: 15_000
  });
}

function expectTamperFailure(name, mutate) {
  const candidate = path.join(temporaryRoot, `case-${name}`);
  fs.cpSync(pristine, candidate, { recursive: true });
  const resources = path.join(candidate, "resources");
  const marker = path.join(temporaryRoot, `${name}.started`);
  mutate(candidate, resources);
  const result = launch(candidate, marker);
  assert.equal(result.error, undefined, `${name}: ${result.error?.message}`);
  assert.equal(result.status, 1, `${name}: launcher did not fail closed`);
  assert.equal(fs.existsSync(marker), false, `${name}: backend executed after tampering`);
  assert.match(
    fs.readFileSync(path.join(resources, `${appName}.log`), "utf8"),
    /integrity|manifest|unlisted|reparse/i,
    `${name}: integrity failure was not logged`
  );
  fs.rmSync(candidate, { recursive: true, force: true });
}

try {
  fs.mkdirSync(path.join(project, "assets"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({
    name: "integrity-test",
    version: "1.0.0",
    nodeviewjs: { name: appName, entry: "app.js", include: ["assets"] }
  }, null, 2));
  fs.writeFileSync(
    path.join(project, "app.js"),
    'require("node:fs").writeFileSync(process.env.NODEVIEW_INTEGRITY_STARTED, "started");\n'
  );
  fs.writeFileSync(
    path.join(project, "index.html"),
    '<!doctype html><meta http-equiv="Content-Security-Policy" content="script-src \'self\'">'
      + '<title>Integrity</title>'
  );
  fs.writeFileSync(path.join(project, "assets", "empty.txt"), "");

  const packaged = spawnSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", path.join(root, "scripts", "package-portable.ps1"),
    "-ProjectRoot", project
  ], {
    encoding: "utf8",
    env: { ...process.env, NODEVIEW_SKIP_NATIVE_REBUILD: "1" },
    timeout: 60_000
  });
  assert.equal(packaged.error, undefined, packaged.error?.message);
  assert.equal(packaged.status, 0, packaged.stderr);

  const output = path.join(project, "build", "portable", appName);
  fs.cpSync(output, pristine, { recursive: true });
  const resources = path.join(pristine, "resources");
  const manifestText = fs.readFileSync(path.join(resources, MANIFEST_NAME), "utf8");
  const entries = parseIntegrityManifest(manifestText);
  assert.equal(generateIntegrityManifest(resources).manifest, manifestText);
  const manifestPaths = entries.map((entry) => entry.path);
  assert.ok(manifestPaths.includes("app/app.js"));
  assert.ok(manifestPaths.includes("app/index.html"));
  assert.ok(manifestPaths.includes("app/__nodeview/bridge.js"));
  assert.ok(manifestPaths.includes("runtime/node.exe"));
  assert.ok(manifestPaths.includes("runtime/nodeview.js"));
  assert.ok(manifestPaths.includes("runtime/nodeview.node"));

  const baselineMarker = path.join(temporaryRoot, "baseline.started");
  const baseline = launch(pristine, baselineMarker);
  assert.equal(baseline.error, undefined, baseline.error?.message);
  assert.equal(baseline.status, 0, baseline.stderr);
  assert.equal(fs.readFileSync(baselineMarker, "utf8"), "started");
  const repeatedMarker = path.join(temporaryRoot, "repeated.started");
  const repeated = launch(pristine, repeatedMarker);
  assert.equal(repeated.error, undefined, repeated.error?.message);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(fs.readFileSync(repeatedMarker, "utf8"), "started");

  const append = (relative) => (candidate, candidateResources) => {
    fs.appendFileSync(path.join(candidateResources, relative), "tampered");
  };
  expectTamperFailure("backend", append(path.join("app", "app.js")));
  expectTamperFailure("html", append(path.join("app", "index.html")));
  expectTamperFailure("bridge", append(path.join("app", "__nodeview", "bridge.js")));
  expectTamperFailure("runtime", append(path.join("runtime", "nodeview.js")));
  expectTamperFailure("addon", append(path.join("runtime", "nodeview.node")));
  expectTamperFailure("node", append(path.join("runtime", "node.exe")));
  expectTamperFailure("manifest", (candidate, candidateResources) => {
    fs.appendFileSync(path.join(candidateResources, MANIFEST_NAME), "tampered\n");
  });
  expectTamperFailure("rewritten-manifest", (candidate, candidateResources) => {
    fs.appendFileSync(path.join(candidateResources, "app", "app.js"), "tampered");
    generateIntegrityManifest(candidateResources);
  });
  expectTamperFailure("missing", (candidate, candidateResources) => {
    fs.rmSync(path.join(candidateResources, "app", "app.js"));
  });
  expectTamperFailure("extra", (candidate, candidateResources) => {
    fs.writeFileSync(path.join(candidateResources, "runtime", "unexpected.dll"), "unexpected");
  });
  expectTamperFailure("missing-anchor", (candidate) => {
    fs.copyFileSync(
      path.join(root, "build", "nodeview", "nodeview_launcher.exe"),
      path.join(candidate, `${appName}.exe`)
    );
  });
  expectTamperFailure("reparse", (candidate, candidateResources) => {
    const bridgeDirectory = path.join(candidateResources, "app", "__nodeview");
    const outside = path.join(temporaryRoot, "outside-bridge");
    fs.rmSync(bridgeDirectory, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "bridge.js"), "tampered");
    fs.symlinkSync(outside, bridgeDirectory, "junction");
  });

  console.log("Package integrity test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
