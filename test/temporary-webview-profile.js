"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CHILD_MARKER = "NODEVIEW_TEMP_PROFILE_CHILD";
const RETRYABLE_REMOVE_ERRORS = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const retryWait = new Int32Array(new SharedArrayBuffer(4));

function removeTemporaryProfile(profile) {
  for (let attempt = 0; attempt <= 30; attempt++) {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!RETRYABLE_REMOVE_ERRORS.has(error?.code) || attempt === 30) throw error;
      Atomics.wait(retryWait, 0, 0, 500);
    }
  }
}

function runWithTemporaryWebViewProfile(prefix, timeout) {
  if (process.platform !== "win32" || process.env[CHILD_MARKER] === "1") return;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  let result;
  try {
    result = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
      stdio: "inherit",
      env: {
        ...process.env,
        LOCALAPPDATA: profile,
        [CHILD_MARKER]: "1"
      },
      timeout
    });
  } finally {
    removeTemporaryProfile(profile);
  }

  if (result.error) throw result.error;
  if (result.signal) {
    console.error(`Live WebView test exited from signal ${result.signal}.`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

module.exports = { runWithTemporaryWebViewProfile };
