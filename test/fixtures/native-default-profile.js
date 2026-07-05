"use strict";

const native = require("../../runtime/native");

native.createWindow({ title: "NodeViewJS Native Profile Test" });
native.loadFile(process.env.NODEVIEW_TEST_ENTRY);
native.run();
setImmediate(() => native.closeWindow());
