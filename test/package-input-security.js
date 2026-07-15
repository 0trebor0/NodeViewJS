"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  DEFAULT_EXCLUSIONS,
  collectPackageFiles,
  copyPackageInputs
} = require("../scripts/package-inputs");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-package-security-"));
const project = path.join(temporaryRoot, "project");
const outside = path.join(temporaryRoot, "outside");
fs.mkdirSync(path.join(project, "assets"), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
const fakeNpmToken = `npm_${"abcdefghijklmnopqrstuvwxyz1234567890"}`;

function writePackage(nodeviewjs = {}) {
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({
    name: "package-security-test",
    version: "1.0.0",
    nodeviewjs: {
      name: "PackageSecurityTest",
      entry: "app.js",
      include: ["assets"],
      ...nodeviewjs
    }
  }, null, 2));
}

try {
  writePackage();
  fs.writeFileSync(path.join(project, "app.js"), "require('nodeviewjs');");
  fs.writeFileSync(path.join(project, "index.html"), "<!doctype html><title>Security test</title>");
  fs.writeFileSync(path.join(project, "assets", "safe.txt"), "safe");
  fs.writeFileSync(path.join(project, "npm-token.txt"), fakeNpmToken);
  fs.writeFileSync(path.join(project, "config.js"), 'const apiKey = "not-a-real-secret-value";');
  fs.writeFileSync(path.join(project, ".env"), "TOKEN=must-not-package");
  fs.writeFileSync(path.join(project, "bundle.js.map"), "{}");
  fs.writeFileSync(path.join(project, "private.pem"), "-----BEGIN PRIVATE KEY-----");
  fs.writeFileSync(path.join(outside, "outside.txt"), "outside");

  assert.ok(DEFAULT_EXCLUSIONS.includes(".env"));
  assert.ok(DEFAULT_EXCLUSIONS.includes("*.map"));
  const collected = collectPackageFiles(project);
  const relativeFiles = collected.files.map(({ relative }) => relative);
  assert.ok(relativeFiles.includes("app.js"));
  assert.ok(relativeFiles.includes("assets/safe.txt"));
  assert.ok(!relativeFiles.includes(".env"));
  assert.ok(!relativeFiles.includes("bundle.js.map"));
  assert.ok(!relativeFiles.includes("private.pem"));
  assert.deepEqual(
    collected.warnings.sort((left, right) => left.file.localeCompare(right.file)),
    [
      { file: "config.js", pattern: "credential assignment" },
      { file: "npm-token.txt", pattern: "npm token" }
    ]
  );

  const destination = path.join(project, "build", "portable", "PackageSecurityTest", "resources", "app");
  copyPackageInputs(project, destination);
  assert.equal(fs.readFileSync(path.join(destination, "assets", "safe.txt"), "utf8"), "safe");
  assert.equal(fs.existsSync(path.join(destination, ".env")), false);

  for (const [config, message] of [
    [{ include: ["../outside"] }, /path traversal/],
    [{ include: [outside] }, /inside the project/],
    [{ include: ["assets/safe.txt\0hidden"] }, /must not contain control characters/],
    [{ entry: "../outside/outside.txt" }, /path traversal/],
    [{ entry: "app.js\nhidden" }, /must not contain control characters/],
    [{ exclude: ["../*"] }, /path traversal/],
    [{ exclude: ["assets\rprivate"] }, /must not contain control characters/],
    [{ icon: "assets/app.ico\0hidden" }, /must not contain control characters/],
    [{ name: "../escape" }, /unsafe/],
    [{ name: "CON" }, /unsafe/]
  ]) {
    writePackage(config);
    assert.throws(() => collectPackageFiles(project), message);
  }

  writePackage({ secretWarnings: false });
  assert.deepEqual(collectPackageFiles(project).warnings, []);

  writePackage();
  const link = path.join(project, "linked-outside");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => collectPackageFiles(project), /symbolic link|reparse point/);
  fs.unlinkSync(link);

  const linkedDestination = path.join(project, "build", "linked-destination", "resources", "app");
  fs.mkdirSync(linkedDestination, { recursive: true });
  fs.symlinkSync(outside, path.join(linkedDestination, "assets"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => copyPackageInputs(project, linkedDestination),
    /destination contains a symbolic link or reparse point/
  );

  if (process.platform === "win32") {
    writePackage({ metadata: { version: "../escape" } });
    const unsafeInstaller = spawnSync("powershell", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", path.join(__dirname, "..", "scripts", "package-installer.ps1"),
      "-ProjectRoot", project
    ], { encoding: "utf8", timeout: 30_000 });
    assert.notEqual(unsafeInstaller.status, 0);
    assert.match(unsafeInstaller.stderr, /unsafe for an installer filename/);

    writePackage();
    fs.rmSync(path.join(project, "build"), { recursive: true, force: true });
    const packaged = spawnSync("powershell", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", path.join(__dirname, "..", "scripts", "package-portable.ps1"),
      "-ProjectRoot", project
    ], {
      encoding: "utf8",
      env: { ...process.env, NODEVIEW_SKIP_NATIVE_REBUILD: "1" },
      timeout: 60_000
    });
    assert.equal(packaged.error, undefined, packaged.error?.message);
    assert.equal(packaged.status, 0, packaged.stderr);
    assert.match(packaged.stderr, /possible credential assignment/);
    assert.match(packaged.stderr, /possible npm token/);
    assert.doesNotMatch(packaged.stderr, /not-a-real-secret-value/);
    assert.equal(packaged.stderr.includes(fakeNpmToken), false);
    const packagedApp = path.join(
      project,
      "build", "portable", "PackageSecurityTest", "resources", "app"
    );
    assert.equal(fs.existsSync(path.join(packagedApp, ".env")), false);
    assert.equal(fs.existsSync(path.join(packagedApp, "bundle.js.map")), false);
    assert.equal(fs.readFileSync(path.join(packagedApp, "assets", "safe.txt"), "utf8"), "safe");
  }

  console.log("Package input security test passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
