"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var lib_exports = {};
__export(lib_exports, {
  AlreadyInstalledError: () => import_service.AlreadyInstalledError,
  MACOS_SERVICE_PATH: () => import_service.MACOS_SERVICE_PATH,
  NotInstalledError: () => import_service.NotInstalledError,
  identifier: () => import_service.identifier,
  service: () => import_service.service
});
module.exports = __toCommonJS(lib_exports);
__reExport(lib_exports, require("./constants.js"), module.exports);
__reExport(lib_exports, require("./install.js"), module.exports);
__reExport(lib_exports, require("./tunnel.js"), module.exports);
var import_service = require("./service.js");
__reExport(lib_exports, require("./handler.js"), module.exports);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AlreadyInstalledError,
  MACOS_SERVICE_PATH,
  NotInstalledError,
  identifier,
  service,
  ...require("./constants.js"),
  ...require("./install.js"),
  ...require("./tunnel.js"),
  ...require("./handler.js")
});
