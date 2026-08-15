"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");

const { App, ipc, net } = require("../runtime");

/* ---------------------------------------------------------------- origins */

assert.deepEqual(net.normalizeAllowedOrigins(undefined), []);
assert.deepEqual(net.normalizeAllowedOrigins(null), []);
assert.deepEqual(
  net.normalizeAllowedOrigins(["https://api.example.com"]),
  ["https://api.example.com"]
);
// Trailing slash and default port collapse to the same origin.
assert.deepEqual(
  net.normalizeAllowedOrigins(["https://api.example.com/", "https://api.example.com:443"]),
  ["https://api.example.com"]
);
assert.deepEqual(
  net.normalizeAllowedOrigins(["http://localhost:3000"]),
  ["http://localhost:3000"]
);
// Listing an origin is the deliberate act that grants it, so plain http and
// private or internal addresses are permitted when named explicitly.
assert.deepEqual(
  net.normalizeAllowedOrigins([
    "http://api.example.com",
    "http://192.168.1.50:8080",
    "https://10.0.0.5:8443",
    "https://internal-api"
  ]),
  [
    "http://api.example.com",
    "http://192.168.1.50:8080",
    "https://10.0.0.5:8443",
    "https://internal-api"
  ]
);

assert.throws(() => net.normalizeAllowedOrigins("https://a.example.com"), /must be an array/);
assert.throws(() => net.normalizeAllowedOrigins(["ftp://example.com"]), /must use http or https/);
assert.throws(() => net.normalizeAllowedOrigins(["ws://example.com"]), /must use http or https/);
assert.throws(() => net.normalizeAllowedOrigins(["file:///etc/passwd"]), /must use http or https/);
assert.throws(() => net.normalizeAllowedOrigins(["https://a.example.com/v1"]), /must not contain a path/);
assert.throws(() => net.normalizeAllowedOrigins(["https://a.example.com?x=1"]), /must not contain a path/);
assert.throws(() => net.normalizeAllowedOrigins(["https://user:pw@a.example.com"]), /must not contain credentials/);
assert.throws(() => net.normalizeAllowedOrigins(["not a url"]), /must be an absolute URL/);
assert.throws(
  () => net.normalizeAllowedOrigins(Array.from({ length: 33 }, (_, i) => `https://h${i}.example.com`)),
  /at most 32 entries/
);

/* ------------------------------------------------------- request rejection */

const ALLOW = ["https://api.example.com"];
const reject = async (options, pattern) => {
  await assert.rejects(
    () => net.request({ url: "https://api.example.com/v1", allowedOrigins: ALLOW, ...options }),
    pattern
  );
};

async function testRequestValidation() {
  // Origin allowlist.
  await reject({ url: "https://evil.example.com/v1" }, /origin is not allowed/);
  await reject({ url: "https://api.example.com.evil.com/" }, /origin is not allowed/);
  await reject({ allowedOrigins: [] }, /No allowed origins are configured/);

  // URL shape.
  await reject({ url: "/relative" }, /must be an absolute URL/);
  await reject({ url: "https://user:pw@api.example.com/" }, /must not contain credentials/);
  await reject({ url: `https://api.example.com/${"a".repeat(2100)}` }, /at most 2048 characters/);
  await reject({ url: " https://api.example.com/v1" }, /control whitespace/);
  await reject({ url: 5 }, /must be a non-empty string/);

  // Method.
  await reject({ method: "TRACE" }, /Unsupported request method/);
  await reject({ method: "CONNECT" }, /Unsupported request method/);
  await reject({ method: 5 }, /must be a string/);

  // Headers.
  await reject({ headers: { Host: "evil.com" } }, /may not be set by the caller/);
  await reject({ headers: { Cookie: "a=b" } }, /may not be set by the caller/);
  await reject({ headers: { "Content-Length": "5" } }, /may not be set by the caller/);
  await reject({ headers: { "Bad Name": "v" } }, /Unsupported request header name/);
  await reject({ headers: { "X-Test": "a\r\nInjected: 1" } }, /must not contain control characters/);
  await reject({ headers: { "X-Test": 5 } }, /must be a string/);
  await reject({ headers: { "X-Test": "v".repeat(3000) } }, /exceeds 2048 characters/);
  await reject({ headers: [] }, /must be an object/);
  await reject(
    { headers: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`X-H${i}`, "v"])) },
    /at most 32 entries/
  );

  // Body.
  await reject({ method: "GET", body: "x" }, /must not include a body/);
  await reject({ method: "HEAD", body: "x" }, /must not include a body/);
  await reject({ method: "POST", body: { a: 1 } }, /must be a string/);
  await reject({ method: "POST", body: "x".repeat(1024 * 1024 + 1) }, /exceeds 1048576 bytes/);

  // Limits.
  await reject({ timeoutMs: 0 }, /between 1 and 120000/);
  await reject({ timeoutMs: 999_999 }, /between 1 and 120000/);
  await reject({ timeoutMs: 1.5 }, /between 1 and 120000/);
  await reject({ maxResponseBytes: 0 }, /between 1 and 8388608/);

  await assert.rejects(() => net.request("nope"), /Request options must be an object/);
}

/* ------------------------------------------ allowlist is the only gate */

async function testUnlistedHostsRefused() {
  // A private or link-local address is refused when it is not listed, which is
  // what stops an allowed public origin from redirecting inward.
  for (const host of ["10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1"]) {
    await assert.rejects(
      () => net.request({
        url: `https://${host}/meta`,
        allowedOrigins: ["https://api.example.com"]
      }),
      /origin is not allowed/,
      `expected unlisted ${host} to be refused`
    );
  }

  // An origin that is configured must not then fail on every request. Anything
  // normalizeAllowedOrigins accepts has to be reachable by assertOriginAllowed.
  for (const origin of ["https://10.0.0.5:8443", "http://192.168.1.50:8080", "https://internal-api"]) {
    const allowedOrigins = net.normalizeAllowedOrigins([origin]);
    await assert.rejects(
      () => net.request({ url: `${origin}/x`, allowedOrigins, timeoutMs: 1 }),
      (error) => !/origin is not allowed|private address/.test(error.message),
      `${origin} was configurable but refused before reaching the network`
    );
  }
}

/* ------------------------------------------------- live loopback behaviour */

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function testLiveRequests() {
  const { server, port } = await startServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/echo") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json", "set-cookie": "session=secret" });
        response.end(JSON.stringify({ method: request.method, body, header: request.headers["x-test"] ?? null }));
      });
      return;
    }
    if (url.pathname === "/redirect-offsite") {
      response.writeHead(302, { location: "https://evil.example.com/stolen" });
      response.end();
      return;
    }
    if (url.pathname === "/redirect-local") {
      response.writeHead(302, { location: "/echo" });
      response.end();
      return;
    }
    if (url.pathname === "/loop") {
      response.writeHead(302, { location: "/loop" });
      response.end();
      return;
    }
    if (url.pathname === "/big") {
      response.writeHead(200);
      response.end("x".repeat(64 * 1024));
      return;
    }
    if (url.pathname === "/slow") {
      setTimeout(() => { response.writeHead(200); response.end("late"); }, 2000).unref();
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });

  const origin = `http://127.0.0.1:${port}`;
  const allowedOrigins = [origin];

  // Success path, including request header and body round trip.
  const ok = await net.request({
    url: `${origin}/echo`,
    method: "POST",
    headers: { "X-Test": "hello" },
    body: "payload",
    allowedOrigins
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.ok, true);
  assert.deepEqual(JSON.parse(ok.body), { method: "POST", body: "payload", header: "hello" });

  // set-cookie must never reach the caller.
  assert.equal(Object.keys(ok.headers).some((h) => h.toLowerCase() === "set-cookie"), false);
  assert.equal(ok.headers["content-type"], "application/json");

  // A redirect off the allowlist is refused rather than followed.
  await assert.rejects(
    () => net.request({ url: `${origin}/redirect-offsite`, allowedOrigins }),
    /Redirect target origin is not allowed/
  );

  // A redirect inside the allowlist is followed.
  const redirected = await net.request({ url: `${origin}/redirect-local`, allowedOrigins });
  assert.equal(redirected.status, 200);
  assert.equal(JSON.parse(redirected.body).method, "GET");

  // Redirect loops terminate.
  await assert.rejects(
    () => net.request({ url: `${origin}/loop`, allowedOrigins }),
    /exceeded 3 redirects/
  );

  // Response size ceiling is enforced against the actual bytes read.
  await assert.rejects(
    () => net.request({ url: `${origin}/big`, allowedOrigins, maxResponseBytes: 1024 }),
    /Response exceeded 1024 bytes/
  );

  // Timeout.
  await assert.rejects(
    () => net.request({ url: `${origin}/slow`, allowedOrigins, timeoutMs: 250 }),
    /timed out after 250ms/
  );

  // Non-2xx is returned, not thrown.
  const missing = await net.request({ url: `${origin}/nope`, allowedOrigins });
  assert.equal(missing.status, 404);
  assert.equal(missing.ok, false);

  server.close();
}

/* ------------------------------------------------------- App integration */

async function testAppIntegration() {
  // net:fetch is a real permission and participates in the net:* group.
  const app = new App({
    entry: __filename,
    allowedOrigins: ["https://api.example.com"],
    permissions: ["net:*"]
  });
  assert.deepEqual(app.options.allowedOrigins, ["https://api.example.com"]);

  app.command("api:get", { permission: "net:fetch" }, () => true);

  // net:fetch is enforced when the command is invoked, not when it is
  // registered, matching how every other permission behaves.
  const denied = new App({ entry: __filename, permissions: ["fs:read"] });
  denied.command("api:get", { permission: "net:fetch" }, () => "reached");

  const responses = [];
  denied.mainWindow._post = (message) => responses.push(JSON.parse(message));
  await denied._handleWindowMessage(
    denied.mainWindow,
    ipc.serialize({ version: 1, type: "invoke", id: 1, command: "api:get" })
  );
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].error, /Permission not granted for command 'api:get': net:fetch/);

  // Scoped grants work through the standard permission machinery.
  const scoped = new App({ entry: __filename, permissions: ["net:fetch:api"] });
  scoped.command("api:scoped", { permission: "net:fetch", scope: "api" }, () => "scoped");
  const scopedResponses = [];
  scoped.mainWindow._post = (message) => scopedResponses.push(JSON.parse(message));
  await scoped._handleWindowMessage(
    scoped.mainWindow,
    ipc.serialize({ version: 1, type: "invoke", id: 2, command: "api:scoped" })
  );
  assert.equal(scopedResponses[0].ok, true);
  assert.equal(scopedResponses[0].result, "scoped");

  // An unsupported permission name is still rejected at registration.
  assert.throws(
    () => app.command("api:bogus", { permission: "net:bogus" }, () => true),
    /Unsupported command permission/
  );

  // app.fetch() binds the app allowlist, so a command cannot widen it.
  await assert.rejects(
    () => app.fetch({ url: "https://evil.example.com/" }),
    /origin is not allowed/
  );
  assert.throws(() => app.fetch("nope"), /must be an object/);

  // An app with no allowedOrigins cannot reach anything.
  const closed = new App({ entry: __filename });
  assert.deepEqual(closed.options.allowedOrigins, []);
  await assert.rejects(
    () => closed.fetch({ url: "https://api.example.com/" }),
    /No allowed origins are configured/
  );
}

Promise.all([
  testRequestValidation(),
  testUnlistedHostsRefused(),
  testLiveRequests(),
  testAppIntegration()
])
  .then(() => console.log("Net API tests passed."))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
