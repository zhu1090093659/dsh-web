"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var constants_exports = {};
__export(constants_exports, {
  CLOUDFLARED_VERSION: () => CLOUDFLARED_VERSION,
  DEFAULT_CLOUDFLARED_BIN: () => DEFAULT_CLOUDFLARED_BIN,
  RELEASE_BASE: () => RELEASE_BASE,
  bin: () => bin,
  use: () => use
});
module.exports = __toCommonJS(constants_exports);
var import_node_path = __toESM(require("node:path"));
const DEFAULT_CLOUDFLARED_BIN = import_node_path.default.join(
  __dirname,
  "..",
  "bin",
  process.platform === "win32" ? "cloudflared.exe" : "cloudflared"
);
let bin = process.env.CLOUDFLARED_BIN || DEFAULT_CLOUDFLARED_BIN;
function use(executable) {
  bin = executable;
}
const CLOUDFLARED_VERSION = process.env.CLOUDFLARED_VERSION || "latest";
const RELEASE_BASE = "https://github.com/cloudflare/cloudflared/releases/";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CLOUDFLARED_VERSION,
  DEFAULT_CLOUDFLARED_BIN,
  RELEASE_BASE,
  bin,
  use
});
