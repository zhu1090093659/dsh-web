#!/usr/bin/env node
"use strict";
var import_error = require("./error.js");
var import_index = require("./index.js");
(0, import_index.main)().catch((err) => {
  if (err instanceof import_error.UnsupportedError) {
    console.error(err.message);
    process.exit(1);
  }
});
