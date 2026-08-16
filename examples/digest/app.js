"use strict";

// Shape one: a simple utility. One window, one command, and no permissions at
// all — the work is pure computation, so the application grants nothing.
//
// This is the smallest useful NodeViewJS application, and it exists to check
// that the API stays out of the way at that size.

const crypto = require("node:crypto");
const path = require("node:path");

const { App } = require("nodeviewjs");

const MAX_INPUT_LENGTH = 100_000;
const ALGORITHMS = new Set(["sha256", "sha512", "sha1", "md5"]);

const app = new App({
  title: "Digest",
  appId: "com.example.nodeviewjs-digest",
  width: 640,
  height: 520,
  center: true,
  entry: path.join(__dirname, "index.html")
  // No permissions: this application never touches the filesystem, the
  // network, the clipboard, or any OS integration.
});

app.command("digest:compute", (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("digest:compute requires an object payload.");
  }
  const { text, algorithm } = payload;
  if (typeof text !== "string") {
    throw new TypeError("Text must be a string.");
  }
  if (text.length > MAX_INPUT_LENGTH) {
    throw new RangeError(`Text must be at most ${MAX_INPUT_LENGTH} characters.`);
  }
  if (typeof algorithm !== "string" || !ALGORITHMS.has(algorithm)) {
    throw new TypeError(`Algorithm must be one of: ${[...ALGORITHMS].join(", ")}.`);
  }

  const bytes = Buffer.from(text, "utf8");
  return {
    algorithm,
    bytes: bytes.length,
    hex: crypto.createHash(algorithm).update(bytes).digest("hex"),
    base64: bytes.toString("base64")
  };
});

app.run();

module.exports = { ALGORITHMS, MAX_INPUT_LENGTH, app };
