"use strict";

// The release-candidate gate. Everything here runs against the package as it
// would actually be published: packed with `npm pack`, installed into a clean
// project, and driven through that installation rather than through this
// repository's source tree.
//
// It covers the sequence a release candidate has to survive:
//
//   1. install from the packed tarball;
//   2. generate an application with the installed CLI;
//   3. run it — a real window opens;
//   4. frontend to backend IPC;
//   5. backend to frontend events;
//   6. close cleanly, with the expected exit code;
//   7. package that application with the installed CLI;
//   8. verify the packaged integrity manifest;
//   9. parse and verify signed update metadata.
//
// Steps 3 to 6 open a native window, so run this from an interactive desktop
// session. By default the native addon is copied from this repository's build
// instead of being recompiled inside the temporary project, which keeps the
// gate to about a minute; set NODEVIEW_RC_BUILD=1 to compile it there instead
// and exercise the real install path end to end.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync, execSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const buildDirectory = path.join(root, "build", "nodeview");
const compileInProject = process.env.NODEVIEW_RC_BUILD === "1";
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-rc-"));
const project = path.join(workspace, "app");

function runNpm(args, cwd, options = {}) {
  const command = [npm, ...args.map((argument) => JSON.stringify(argument))].join(" ");
  return execSync(command, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout ?? 600_000
  });
}

function step(number, description) {
  console.log(`  ${number}. ${description}`);
}

let failed = true;
try {
  /* --------------------------------------------- 1. install from the tarball */

  step(1, "Packing and installing from the tarball");
  const [artifact] = JSON.parse(runNpm(["pack", "--json", "--pack-destination", workspace], root));
  const tarball = path.join(workspace, artifact.filename);

  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(project, "package.json"),
    `${JSON.stringify({ name: "rc-app", version: "1.0.0", private: true }, null, 2)}\n`
  );
  runNpm(
    ["install", tarball, "--no-audit", "--no-fund", ...(compileInProject ? [] : ["--ignore-scripts"])],
    project
  );

  const installed = path.join(project, "node_modules", "nodeviewjs");
  assert.ok(fs.existsSync(installed), "the package did not install");

  if (!compileInProject) {
    // Stage the native artifacts this repository already built, so the gate
    // exercises the packaged JavaScript, the CLI, and the runtime without
    // paying for a second compile. NODEVIEW_RC_BUILD=1 skips this branch.
    assert.ok(
      fs.existsSync(path.join(buildDirectory, "nodeview.node")),
      "run `npm run build` before the release-candidate gate, or set NODEVIEW_RC_BUILD=1"
    );
    const stagedBuild = path.join(installed, "build", "nodeview");
    fs.mkdirSync(stagedBuild, { recursive: true });
    for (const file of fs.readdirSync(buildDirectory)) {
      fs.copyFileSync(path.join(buildDirectory, file), path.join(stagedBuild, file));
    }
  }
  assert.ok(
    fs.existsSync(path.join(installed, "build", "nodeview", "nodeview.node")),
    "the installed package has no native addon"
  );

  /* ------------------------------------------ 2. generate with the installed CLI */

  step(2, "Generating an application with the installed CLI");
  const cli = path.join(installed, "bin", "nodeviewjs.js");
  execFileSync(process.execPath, [cli, "create", "SampleApp"], {
    cwd: project,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const sample = path.join(project, "SampleApp");
  for (const file of ["package.json", "app.js", "index.html"]) {
    assert.ok(fs.existsSync(path.join(sample, file)), `the generated app is missing ${file}`);
  }
  // The generated app resolves the runtime from the installed package.
  fs.mkdirSync(path.join(sample, "node_modules"), { recursive: true });
  fs.cpSync(installed, path.join(sample, "node_modules", "nodeviewjs"), { recursive: true });

  /* ------------------------- 3-6. run it: window, IPC both ways, clean exit */

  step(3, "Running it: window, IPC in both directions, clean exit");
  const resultFile = path.join(workspace, "ipc-result.json");
  // A purpose-built entry rather than the starter, because the gate has to
  // assert on both IPC directions and then exit on its own.
  fs.writeFileSync(path.join(sample, "rc-entry.js"), `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { App } = require("nodeviewjs");

const app = new App({
  title: "Release Candidate",
  appId: "nodeviewjs-release-candidate",
  entry: path.join(__dirname, "rc-page.html"),
  permissions: ["fs:read"]
});

const observed = { invoked: false, payload: null, acknowledged: false };
const timer = setTimeout(() => finish("timed out waiting for the page"), 30000);

function finish(error) {
  clearTimeout(timer);
  fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ ...observed, error }));
  app.quit();
  process.exit(error ? 1 : 0);
}

// Frontend to backend, through a permission-gated command.
app.command("rc:ping", { permission: "fs:read" }, (payload) => {
  observed.invoked = true;
  observed.payload = payload;
  // Backend to frontend: the page must receive this and acknowledge it.
  setImmediate(() => app.emit("rc:pong", { token: payload && payload.token }));
  return { ok: true };
});

app.on("rc:ack", (payload) => {
  observed.acknowledged = Boolean(payload && payload.token === "rc-token");
  finish(observed.acknowledged ? undefined : "the acknowledgement payload was wrong");
});

app.run();
`);
  fs.writeFileSync(path.join(sample, "rc-page.html"), `<!doctype html>
<html>
  <body>
    <script>
      window.addEventListener("load", async () => {
        NodeViewJS.on("rc:pong", (payload) => {
          NodeViewJS.emit("rc:ack", { token: payload.token });
        });
        await NodeViewJS.invoke("rc:ping", { token: "rc-token" });
      });
    </script>
  </body>
</html>
`);

  const run = spawnSync(process.execPath, [path.join(sample, "rc-entry.js")], {
    cwd: sample,
    encoding: "utf8",
    timeout: 90_000,
    env: {
      ...process.env,
      // Keep the WebView profile out of the developer's real app data.
      LOCALAPPDATA: path.join(workspace, "local-app-data"),
      APPDATA: path.join(workspace, "app-data")
    }
  });

  assert.equal(run.error, undefined, run.error?.message);
  assert.ok(fs.existsSync(resultFile), `the app produced no result:\n${run.stdout}\n${run.stderr}`);
  const observed = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(observed.error, undefined, `IPC round trip failed: ${observed.error}`);
  assert.equal(observed.invoked, true, "the frontend never reached a backend command");
  assert.deepEqual(observed.payload, { token: "rc-token" }, "the invoke payload did not arrive intact");
  assert.equal(observed.acknowledged, true, "the backend event never reached the frontend");
  assert.equal(run.status, 0, `the app did not exit cleanly:\n${run.stdout}\n${run.stderr}`);

  /* ------------------------------------ 7-8. package it and verify integrity */

  if (process.platform === "win32") {
    step(7, "Packaging the application with the installed CLI");
    execFileSync(process.execPath, [cli, "package"], {
      cwd: sample,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000
    });

    const portable = path.join(sample, "build", "portable", "SampleApp");
    assert.ok(fs.existsSync(path.join(portable, "SampleApp.exe")), "no launcher was produced");
    const manifestPath = path.join(portable, "resources", "integrity.manifest");
    assert.ok(fs.existsSync(manifestPath), "no integrity manifest was produced");

    step(8, "Verifying the packaged integrity manifest");
    const { parseIntegrityManifest } = require(
      path.join(installed, "scripts", "package-integrity.js")
    );
    const entries = parseIntegrityManifest(fs.readFileSync(manifestPath, "utf8"));
    assert.ok(entries.length > 0, "the integrity manifest is empty");
    for (const entry of entries) {
      const file = path.join(portable, "resources", entry.path);
      assert.ok(fs.existsSync(file), `the manifest lists a missing file: ${entry.path}`);
      const contents = fs.readFileSync(file);
      assert.equal(contents.length, entry.size, `size mismatch for ${entry.path}`);
      assert.equal(
        crypto.createHash("sha256").update(contents).digest("hex"),
        entry.sha256,
        `digest mismatch for ${entry.path}`
      );
    }
  } else {
    step(7, "Skipping packaging: the portable launcher is Windows-only");
  }

  /* --------------------------------------- 9. signed update metadata parsing */

  step(9, "Verifying signed update metadata through the installed package");
  const { validateManifest } = require(path.join(installed, "runtime", "updater.js"));
  const keys = crypto.generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  const payload = Buffer.from("release-candidate-artifact");
  const manifest = {
    schemaVersion: 1,
    appId: "nodeviewjs-release-candidate",
    version: "2.0.0",
    url: "https://updates.example.com/SampleApp-2.0.0-setup.exe",
    size: payload.length,
    sha256: crypto.createHash("sha256").update(payload).digest("hex")
  };
  const { canonicalizeManifest } = require(path.join(installed, "runtime", "updater.js"));
  manifest.signature = crypto.sign(
    null,
    Buffer.from(canonicalizeManifest(manifest), "utf8"),
    keys.privateKey
  ).toString("base64");

  const verified = validateManifest(manifest, {
    appId: "nodeviewjs-release-candidate",
    maxDownloadBytes: 1024 * 1024,
    publicKey
  });
  assert.equal(verified.version, "2.0.0");

  // A tampered manifest must be refused.
  assert.throws(
    () => validateManifest({ ...manifest, version: "3.0.0" }, {
      appId: "nodeviewjs-release-candidate",
      maxDownloadBytes: 1024 * 1024,
      publicKey
    }),
    /signature verification failed/
  );

  failed = false;
} finally {
  if (failed) {
    console.error(`Release-candidate workspace kept for inspection: ${workspace}`);
  } else {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

console.log("Release candidate gate passed.");
