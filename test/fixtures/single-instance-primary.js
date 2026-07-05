"use strict";

const fs = require("node:fs");
const { SingleInstanceCoordinator } = require("../../runtime/single-instance");

const coordinator = new SingleInstanceCoordinator(process.env.NODEVIEW_TEST_APP_ID);
const timeout = setTimeout(() => {
  fs.writeFileSync(process.env.NODEVIEW_TEST_ERROR, "Timed out waiting for a second instance.");
  coordinator.close();
  process.exitCode = 1;
}, 10_000);

const request = coordinator.request(
  { args: [], cwd: process.cwd() },
  (payload) => {
    fs.writeFileSync(process.env.NODEVIEW_TEST_RESULT, JSON.stringify(payload));
    clearTimeout(timeout);
    coordinator.close();
  },
  (error) => {
    fs.writeFileSync(process.env.NODEVIEW_TEST_ERROR, String(error?.stack ?? error));
    clearTimeout(timeout);
    coordinator.close();
    process.exitCode = 1;
  }
);

if (!request.primary) {
  throw new Error("The test primary process did not acquire the single-instance lock.");
}

fs.writeFileSync(process.env.NODEVIEW_TEST_READY, "ready");
