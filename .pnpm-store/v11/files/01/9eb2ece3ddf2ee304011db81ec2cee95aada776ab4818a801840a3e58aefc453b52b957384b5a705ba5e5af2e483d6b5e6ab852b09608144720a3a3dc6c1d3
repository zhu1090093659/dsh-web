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
var service_exports = {};
__export(service_exports, {
  AlreadyInstalledError: () => AlreadyInstalledError,
  LINUX_SERVICE_PATH: () => LINUX_SERVICE_PATH,
  MACOS_SERVICE_PATH: () => MACOS_SERVICE_PATH,
  NotInstalledError: () => NotInstalledError,
  clean: () => clean,
  current: () => current,
  err: () => err,
  exists: () => exists,
  identifier: () => identifier,
  install: () => install,
  journal: () => journal,
  log: () => log,
  service: () => service,
  service_name: () => service_name,
  uninstall: () => uninstall
});
module.exports = __toCommonJS(service_exports);
var import_node_os = __toESM(require("node:os"));
var import_node_fs = __toESM(require("node:fs"));
var import_node_child_process = require("node:child_process");
var import_constants = require("./constants.js");
var import_regex = require("./regex.js");
const identifier = "com.cloudflare.cloudflared";
const service_name = "cloudflared.service";
const MACOS_SERVICE_PATH = {
  PLIST: is_root() ? `/Library/LaunchDaemons/${identifier}.plist` : `${import_node_os.default.homedir()}/Library/LaunchAgents/${identifier}.plist`,
  OUT: is_root() ? `/Library/Logs/${identifier}.out.log` : `${import_node_os.default.homedir()}/Library/Logs/${identifier}.out.log`,
  ERR: is_root() ? `/Library/Logs/${identifier}.err.log` : `${import_node_os.default.homedir()}/Library/Logs/${identifier}.err.log`
};
const LINUX_SERVICE_PATH = {
  SYSTEMD: `/etc/systemd/system/${service_name}`,
  SERVICE: "/etc/init.d/cloudflared",
  SERVICE_OUT: "/var/log/cloudflared.log",
  SERVICE_ERR: "/var/log/cloudflared.err"
};
const service = { install, uninstall, exists, log, err, current, clean, journal };
class AlreadyInstalledError extends Error {
  constructor() {
    super("service is already installed");
  }
}
class NotInstalledError extends Error {
  constructor() {
    super("service is not installed");
  }
}
function install(token) {
  if (!["darwin", "linux"].includes(process.platform)) {
    throw new Error(`Not Implemented on platform ${process.platform}`);
  }
  if (exists()) {
    throw new AlreadyInstalledError();
  }
  const args = ["service", "install"];
  if (token) {
    args.push(token);
  }
  const result = (0, import_node_child_process.spawnSync)(import_constants.bin, args);
  if (result.status !== 0) {
    throw new Error(`service install failed: ${result.stderr.toString()}`);
  }
}
function uninstall() {
  if (!["darwin", "linux"].includes(process.platform)) {
    throw new Error(`Not Implemented on platform ${process.platform}`);
  }
  if (!exists()) {
    throw new NotInstalledError();
  }
  const result = (0, import_node_child_process.spawnSync)(import_constants.bin, ["service", "uninstall"]);
  if (result.status !== 0) {
    throw new Error(`service uninstall failed: ${result.stderr.toString()}`);
  }
  if (process.platform === "darwin") {
    import_node_fs.default.rmSync(MACOS_SERVICE_PATH.OUT);
    import_node_fs.default.rmSync(MACOS_SERVICE_PATH.ERR);
  } else if (process.platform === "linux" && !is_systemd()) {
    import_node_fs.default.rmSync(LINUX_SERVICE_PATH.SERVICE_OUT);
    import_node_fs.default.rmSync(LINUX_SERVICE_PATH.SERVICE_ERR);
  }
}
function log() {
  if (!exists()) {
    throw new NotInstalledError();
  }
  if (process.platform === "darwin") {
    return import_node_fs.default.readFileSync(MACOS_SERVICE_PATH.OUT, "utf8");
  }
  if (process.platform === "linux" && !is_systemd()) {
    return import_node_fs.default.readFileSync(LINUX_SERVICE_PATH.SERVICE_OUT, "utf8");
  }
  throw new Error(`Not Implemented on platform ${process.platform}`);
}
function err() {
  if (!exists()) {
    throw new NotInstalledError();
  }
  if (process.platform === "darwin") {
    return import_node_fs.default.readFileSync(MACOS_SERVICE_PATH.ERR, "utf8");
  }
  if (process.platform === "linux" && !is_systemd()) {
    return import_node_fs.default.readFileSync(LINUX_SERVICE_PATH.SERVICE_ERR, "utf8");
  }
  throw new Error(`Not Implemented on platform ${process.platform}`);
}
function journal(n = 300) {
  if (process.platform === "linux" && is_systemd()) {
    const args = ["-u", service_name, "-o", "cat", "-n", n.toString()];
    return (0, import_node_child_process.spawnSync)("journalctl", args).stdout.toString();
  }
  throw new Error(`Not Implemented on platform ${process.platform}`);
}
function current() {
  var _a, _b, _c, _d;
  if (!["darwin", "linux"].includes(process.platform)) {
    throw new Error(`Not Implemented on platform ${process.platform}`);
  }
  if (!exists()) {
    throw new NotInstalledError();
  }
  const log2 = is_systemd() ? journal() : err();
  let tunnelID = "";
  let connectorID = "";
  const connections = [];
  let metrics = "";
  let config = {};
  for (const line of log2.split("\n")) {
    try {
      if (line.match(import_regex.tunnelID_regex)) {
        tunnelID = ((_a = line.match(import_regex.tunnelID_regex)) == null ? void 0 : _a[1]) ?? "";
      } else if (line.match(import_regex.connectorID_regex)) {
        connectorID = ((_b = line.match(import_regex.connectorID_regex)) == null ? void 0 : _b[1]) ?? "";
      } else if (line.match(import_regex.conn_regex) && line.match(import_regex.location_regex) && line.match(import_regex.ip_regex) && line.match(import_regex.index_regex)) {
        const [, id] = line.match(import_regex.conn_regex) ?? [];
        const [, location] = line.match(import_regex.location_regex) ?? [];
        const [, ip] = line.match(import_regex.ip_regex) ?? [];
        const [, idx] = line.match(import_regex.index_regex) ?? [];
        connections[parseInt(idx)] = { id, ip, location };
      } else if (line.match(import_regex.disconnect_regex)) {
        const [, idx] = line.match(import_regex.disconnect_regex) ?? [];
        if (parseInt(idx) in connections) {
          connections[parseInt(idx)] = { id: "", ip: "", location: "" };
        }
      } else if (line.match(import_regex.metrics_regex)) {
        metrics = ((_c = line.match(import_regex.metrics_regex)) == null ? void 0 : _c[1]) ?? "";
      } else if (line.match(import_regex.config_regex)) {
        config = JSON.parse(((_d = line.match(import_regex.config_regex)) == null ? void 0 : _d[1].replace(/\\/g, "")) ?? "{}");
      }
    } catch (err2) {
      if (process.env.VERBOSE) {
        console.error("log parsing failed", err2);
      }
    }
  }
  return { tunnelID, connectorID, connections, metrics, config };
}
function clean() {
  if (process.platform !== "darwin") {
    throw new Error(`Not Implemented on platform ${process.platform}`);
  }
  if (exists()) {
    throw new AlreadyInstalledError();
  }
  import_node_fs.default.rmSync(MACOS_SERVICE_PATH.OUT, { force: true });
  import_node_fs.default.rmSync(MACOS_SERVICE_PATH.ERR, { force: true });
}
function exists() {
  if (process.platform === "darwin") {
    return import_node_fs.default.existsSync(MACOS_SERVICE_PATH.PLIST);
  } else if (process.platform === "linux") {
    return is_systemd() ? import_node_fs.default.existsSync(LINUX_SERVICE_PATH.SYSTEMD) : import_node_fs.default.existsSync(LINUX_SERVICE_PATH.SERVICE);
  }
  throw new Error(`Not Implemented on platform ${process.platform}`);
}
function is_root() {
  var _a;
  return ((_a = process.getuid) == null ? void 0 : _a.call(process)) === 0;
}
function is_systemd() {
  return process.platform === "linux" && import_node_fs.default.existsSync("/run/systemd/system");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AlreadyInstalledError,
  LINUX_SERVICE_PATH,
  MACOS_SERVICE_PATH,
  NotInstalledError,
  clean,
  current,
  err,
  exists,
  identifier,
  install,
  journal,
  log,
  service,
  service_name,
  uninstall
});
