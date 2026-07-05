"use strict";

const { App } = require("../../runtime");

const app = new App({
  appId: process.env.NODEVIEW_TEST_APP_ID,
  entry: __filename,
  singleInstance: true
});

if (app.run() !== false) {
  throw new Error("The test secondary process unexpectedly became the primary instance.");
}
