"use strict";

// The prebuilt install path, with fetch injected. Nothing here touches the
// network or the real build directory.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ChecksumMismatchError,
  digestOf,
  installPrebuilt,
  readChecksums,
  resolveBinaryHost,
  resolveTarget,
  targetFiles
} = require("../scripts/install-native");

const root = path.join(__dirname, "..");

/* ------------------------------------------------------------- targets */

assert.deepEqual(targetFiles("win32"), ["nodeview.node", "nodeview_launcher.exe"]);
assert.deepEqual(targetFiles("darwin"), ["nodeview.node", "nodeview_launcher"]);
assert.deepEqual(targetFiles("linux"), ["nodeview.node", "nodeview_launcher"]);
assert.equal(targetFiles("aix"), undefined);

assert.equal(resolveTarget({ platform: "win32", arch: "x64" }).key, "win32-x64");
assert.equal(resolveTarget({ platform: "darwin", arch: "arm64" }).key, "darwin-arm64");
assert.equal(resolveTarget({ platform: "linux", arch: "arm64" }).key, "linux-arm64");
assert.equal(resolveTarget({ platform: "aix", arch: "ppc64" }), undefined);

/* ---------------------------------------------------------- binary host */

assert.equal(resolveBinaryHost({ env: {}, manifest: {} }), undefined);
assert.equal(resolveBinaryHost({ env: { NODEVIEW_BINARY_HOST: "  " }, manifest: {} }), undefined);
assert.equal(
  resolveBinaryHost({ env: { NODEVIEW_BINARY_HOST: "https://cdn.example.com/nodeviewjs" }, manifest: {} }).href,
  "https://cdn.example.com/nodeviewjs/"
);
// An npm config value and the package manifest are both accepted sources.
assert.equal(
  resolveBinaryHost({ env: { npm_config_nodeview_binary_host: "https://cdn.example.com/" }, manifest: {} }).href,
  "https://cdn.example.com/"
);
assert.equal(
  resolveBinaryHost({ env: {}, manifest: { nodeviewjs: { binaryHost: "https://cdn.example.com/x" } } }).href,
  "https://cdn.example.com/x/"
);
// The transport authenticates code that will run on the machine.
assert.throws(
  () => resolveBinaryHost({ env: { NODEVIEW_BINARY_HOST: "http://cdn.example.com" }, manifest: {} }),
  /must use https/
);
assert.throws(
  () => resolveBinaryHost({ env: { NODEVIEW_BINARY_HOST: "https://user:pass@cdn.example.com" }, manifest: {} }),
  /must not contain credentials/
);
assert.throws(
  () => resolveBinaryHost({ env: { NODEVIEW_BINARY_HOST: "not a url" }, manifest: {} }),
  /not a valid URL/
);

/* ------------------------------------------------------------ checksums */

// The file that ships with the package must stay parseable and, while no
// binaries are published, empty.
const shipped = readChecksums(path.join(root, "native-checksums.json"));
assert.ok(shipped, "native-checksums.json must ship with the package");
assert.equal(typeof shipped.artifacts, "object");
for (const [key, digest] of Object.entries(shipped.artifacts)) {
  assert.match(key, /^[a-z0-9]+-[a-z0-9]+\/[A-Za-z0-9_.]+$/, `bad artifact key: ${key}`);
  assert.match(digest, /^[a-f0-9]{64}$/, `bad digest for ${key}`);
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "nodeviewjs-install-"));

function checksumFile(contents) {
  const file = path.join(workspace, `checksums-${crypto.randomUUID()}.json`);
  fs.writeFileSync(file, contents);
  return file;
}

assert.equal(readChecksums(path.join(workspace, "missing.json")), undefined);
assert.throws(() => readChecksums(checksumFile("{ not json")), /not valid JSON/);
assert.throws(() => readChecksums(checksumFile('["array"]')), /must contain an object/);
assert.throws(() => readChecksums(checksumFile('{"artifacts": []}')), /artifacts must be an object/);

/* -------------------------------------------------------------- install */

const target = { key: "win32-x64", platform: "win32", arch: "x64", files: ["nodeview.node", "nodeview_launcher.exe"] };
const addonBytes = Buffer.from("fake addon bytes");
const launcherBytes = Buffer.from("fake launcher bytes");
const bodies = new Map([
  ["nodeview.node", addonBytes],
  ["nodeview_launcher.exe", launcherBytes]
]);

function goodChecksums() {
  return {
    version: "9.9.9",
    artifacts: {
      "win32-x64/nodeview.node": digestOf(addonBytes),
      "win32-x64/nodeview_launcher.exe": digestOf(launcherBytes)
    }
  };
}

function fakeFetch(behaviour = {}) {
  const requested = [];
  const impl = async (url, options) => {
    requested.push({ url, options });
    if (behaviour.reject) throw new Error(behaviour.reject);
    const file = url.split("/").pop();
    const body = behaviour.bodies?.get(file) ?? bodies.get(file);
    if (!body) return { ok: false, status: 404, headers: new Map() };
    if (behaviour.status && behaviour.status !== 200) {
      return { ok: false, status: behaviour.status, headers: new Headers() };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers(behaviour.headers ?? { "content-length": String(body.length) }),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    };
  };
  impl.requested = requested;
  return impl;
}

function outputDirectory() {
  return path.join(workspace, `out-${crypto.randomUUID()}`);
}

function baseOptions(overrides = {}) {
  return {
    log: () => {},
    env: { NODEVIEW_BINARY_HOST: "https://cdn.example.com/nodeviewjs" },
    manifest: { version: "9.9.9" },
    target,
    checksums: goodChecksums(),
    outputDirectory: outputDirectory(),
    fetch: fakeFetch(),
    ...overrides
  };
}

async function main() {
  // The happy path writes both files and records provenance.
  {
    const options = baseOptions();
    const outcome = await installPrebuilt(options);
    assert.equal(outcome.installed, true, outcome.reason);
    assert.deepEqual(
      fs.readFileSync(path.join(options.outputDirectory, "nodeview.node")),
      addonBytes
    );
    assert.deepEqual(
      fs.readFileSync(path.join(options.outputDirectory, "nodeview_launcher.exe")),
      launcherBytes
    );
    const provenance = JSON.parse(
      fs.readFileSync(path.join(options.outputDirectory, "provenance.json"), "utf8")
    );
    assert.equal(provenance.source, "prebuilt");
    assert.equal(provenance.target, "win32-x64");
    assert.equal(provenance.host, "https://cdn.example.com");
    // The version in the checksum file, not the host, decides the path.
    assert.deepEqual(
      options.fetch.requested.map(({ url }) => url),
      [
        "https://cdn.example.com/nodeviewjs/9.9.9/win32-x64/nodeview.node",
        "https://cdn.example.com/nodeviewjs/9.9.9/win32-x64/nodeview_launcher.exe"
      ]
    );
    // Redirects are refused rather than followed.
    assert.equal(options.fetch.requested[0].options.redirect, "error");
  }

  // A tampered artifact must stop the install rather than silently compiling,
  // which would hide the mismatch.
  {
    const options = baseOptions({
      fetch: fakeFetch({ bodies: new Map([["nodeview.node", Buffer.from("evil")]]) })
    });
    await assert.rejects(
      () => installPrebuilt(options),
      (error) => error instanceof ChecksumMismatchError
        && /does not match the digest published/.test(error.message)
        && /NODEVIEW_BUILD_FROM_SOURCE=1/.test(error.message)
    );
    assert.equal(fs.existsSync(options.outputDirectory), false, "nothing may be written on mismatch");
  }

  // A later file failing verification must not leave the earlier one installed.
  {
    const options = baseOptions({
      fetch: fakeFetch({
        bodies: new Map([
          ["nodeview.node", addonBytes],
          ["nodeview_launcher.exe", Buffer.from("evil launcher")]
        ])
      })
    });
    await assert.rejects(() => installPrebuilt(options), ChecksumMismatchError);
    assert.equal(fs.existsSync(options.outputDirectory), false, "a partial install was left behind");
  }

  // Everything else falls back to a source build, reporting why.
  const fallbacks = [
    ["NODEVIEW_BUILD_FROM_SOURCE=1", baseOptions({
      env: { NODEVIEW_BUILD_FROM_SOURCE: "1", NODEVIEW_BINARY_HOST: "https://cdn.example.com" }
    }), /NODEVIEW_BUILD_FROM_SOURCE/],
    ["no host configured", baseOptions({ env: {} }), /no prebuilt binary host/],
    ["unsupported platform", baseOptions({
      target: undefined,
      env: { NODEVIEW_PLATFORM: "aix", NODEVIEW_BINARY_HOST: "https://cdn.example.com" }
    }), /no prebuilt target for aix/],
    ["no checksums file", baseOptions({ checksums: undefined, checksumPath: path.join(workspace, "missing.json") }), /native-checksums\.json is not present/],
    ["target not published", baseOptions({ checksums: { version: "9.9.9", artifacts: { "linux-x64/nodeview.node": "a".repeat(64) } } }), /no published binary for win32-x64/],
    ["network failure", baseOptions({ fetch: fakeFetch({ reject: "getaddrinfo ENOTFOUND" }) }), /could not download/],
    ["http error", baseOptions({ fetch: fakeFetch({ status: 503 }) }), /HTTP 503/],
    ["empty artifact", baseOptions({ fetch: fakeFetch({ bodies: new Map([["nodeview.node", Buffer.alloc(0)]]) }) }), /empty|could not download/],
    // Stands in for a runtime without a global fetch.
    ["no fetch available", baseOptions({ fetch: false }), /does not provide fetch/]
  ];

  for (const [label, options, expected] of fallbacks) {
    const outcome = await installPrebuilt(options);
    assert.equal(outcome.installed, false, `${label} should fall back to a source build`);
    assert.match(outcome.reason, expected, label);
    if (options.outputDirectory) {
      assert.equal(fs.existsSync(options.outputDirectory), false, `${label} wrote output anyway`);
    }
  }

  // An oversized artifact is refused on the declared length alone, before the
  // body is read.
  {
    const options = baseOptions({
      fetch: fakeFetch({ headers: { "content-length": String(1024 * 1024 * 1024) } })
    });
    const outcome = await installPrebuilt(options);
    assert.equal(outcome.installed, false);
    assert.match(outcome.reason, /maximum allowed size/);
  }

  // A digest that is not a SHA-256 is a packaging error, not a fallback.
  {
    const options = baseOptions({
      checksums: { version: "9.9.9", artifacts: { "win32-x64/nodeview.node": "short" } }
    });
    await assert.rejects(() => installPrebuilt(options), /invalid digest/);
  }

  fs.rmSync(workspace, { recursive: true, force: true });
  console.log("Prebuilt native install test passed.");
}

main().catch((error) => {
  fs.rmSync(workspace, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
