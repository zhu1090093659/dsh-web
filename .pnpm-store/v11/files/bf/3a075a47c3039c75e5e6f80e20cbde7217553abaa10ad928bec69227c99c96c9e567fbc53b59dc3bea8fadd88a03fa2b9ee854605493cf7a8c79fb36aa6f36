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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var tunnel_exports = {};
__export(tunnel_exports, {
  Tunnel: () => Tunnel,
  build_args: () => build_args,
  build_options: () => build_options,
  tunnel: () => tunnel
});
module.exports = __toCommonJS(tunnel_exports);
var import_node_child_process = require("node:child_process");
var import_node_events = require("node:events");
var import_constants = require("./constants.js");
var import_handler = require("./handler.js");
class Tunnel extends import_node_events.EventEmitter {
  constructor(options = ["tunnel", "--hello-world"]) {
    super();
    this.outputHandlers = [];
    this.stop = this._stop.bind(this);
    this.setupDefaultHandlers();
    const args = Array.isArray(options) ? options : build_args(options);
    this._process = this.createProcess(args);
    this.setupEventHandlers();
  }
  get process() {
    return this._process;
  }
  setupDefaultHandlers() {
    new import_handler.ConnectionHandler(this);
    new import_handler.TryCloudflareHandler(this);
  }
  /**
   * Add a custom output handler
   * @param handler Function to handle cloudflared output
   */
  addHandler(handler) {
    this.outputHandlers.push(handler);
  }
  /**
   * Remove a previously added output handler
   * @param handler The handler to remove
   */
  removeHandler(handler) {
    const index = this.outputHandlers.indexOf(handler);
    if (index !== -1) {
      this.outputHandlers.splice(index, 1);
    }
  }
  processOutput(output) {
    for (const handler of this.outputHandlers) {
      try {
        handler(output, this);
      } catch (error) {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  setupEventHandlers() {
    this.on("stdout", (output) => {
      this.processOutput(output);
    });
    this.on("stderr", (output) => {
      this.processOutput(output);
    });
  }
  createProcess(args) {
    var _a, _b;
    const child = (0, import_node_child_process.spawn)(import_constants.bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", (error) => this.emit("error", error));
    child.on("exit", (code, signal) => this.emit("exit", code, signal));
    if (process.env.VERBOSE) {
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
    }
    (_a = child.stdout) == null ? void 0 : _a.on("data", (data) => this.emit("stdout", data.toString()));
    (_b = child.stderr) == null ? void 0 : _b.on("data", (data) => this.emit("stderr", data.toString()));
    return child;
  }
  _stop() {
    return this.process.kill("SIGINT");
  }
  on(event, listener) {
    return super.on(event, listener);
  }
  once(event, listener) {
    return super.once(event, listener);
  }
  off(event, listener) {
    return super.off(event, listener);
  }
  emit(event, ...args) {
    return super.emit(event, ...args);
  }
  /**
   * Create a quick tunnel without a Cloudflare account.
   * @param url The local service URL to connect to. If not provided, the hello world mode will be used.
   * @param options The options to pass to cloudflared.
   */
  static quick(url, options = {}) {
    const args = ["tunnel"];
    if (url) {
      args.push("--url", url);
    } else {
      args.push("--hello-world");
    }
    args.push(...build_options(options));
    return new Tunnel(args);
  }
  /**
   * Create a tunnel with a Cloudflare account.
   * @param token The Cloudflare Tunnel token.
   * @param options The options to pass to cloudflared.
   */
  static withToken(token, options = {}) {
    options["--token"] = token;
    return new Tunnel(build_args(options));
  }
}
function tunnel(options = {}) {
  return new Tunnel(options);
}
function build_args(options) {
  const args = "--hello-world" in options ? ["tunnel"] : ["tunnel", "run"];
  args.push(...build_options(options));
  return args;
}
function build_options(options) {
  const opts = [];
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "string") {
      opts.push(`${key}`, value);
    } else if (typeof value === "number") {
      opts.push(`${key}`, value.toString());
    } else if (typeof value === "boolean") {
      if (value === true) {
        opts.push(`${key}`);
      }
    }
  }
  return opts;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Tunnel,
  build_args,
  build_options,
  tunnel
});
