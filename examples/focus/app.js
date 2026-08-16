"use strict";

const { createFocusApp } = require("./create-app");

const { app } = createFocusApp();

// A second launch returns false: its arguments were forwarded to the running
// instance, which is what singleInstance is for. Do not force-exit here — that
// would interrupt delivery.
app.run();
