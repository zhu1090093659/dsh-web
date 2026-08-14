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
var handler_exports = {};
__export(handler_exports, {
  ConfigHandler: () => ConfigHandler,
  ConnectionHandler: () => ConnectionHandler,
  TryCloudflareHandler: () => TryCloudflareHandler
});
module.exports = __toCommonJS(handler_exports);
var import_node_stream = require("node:stream");
var import_regex = require("./regex");
class ConnectionHandler {
  constructor(tunnel) {
    this.connections = [];
    this.connected_handler = (output, tunnel) => {
      const conn_match = output.match(import_regex.conn_regex);
      const ip_match = output.match(import_regex.ip_regex);
      const location_match = output.match(import_regex.location_regex);
      const index_match = output.match(import_regex.index_regex);
      if (conn_match && ip_match && location_match && index_match) {
        const connection = {
          id: conn_match[1],
          ip: ip_match[1],
          location: location_match[1]
        };
        this.connections[Number(index_match[1])] = connection;
        tunnel.emit("connected", connection);
      }
    };
    this.disconnected_handler = (output, tunnel) => {
      const index_match = output.includes("terminated") ? output.match(import_regex.index_regex) : null;
      if (index_match) {
        const index = Number(index_match[1]);
        if (this.connections[index]) {
          tunnel.emit("disconnected", this.connections[index]);
          this.connections[index] = void 0;
        }
      }
    };
    tunnel.addHandler(this.connected_handler.bind(this));
    tunnel.addHandler(this.disconnected_handler.bind(this));
  }
}
class TryCloudflareHandler {
  constructor(tunnel) {
    this.url_handler = (output, tunnel) => {
      const url_match = output.match(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/);
      if (url_match) {
        tunnel.emit("url", url_match[0]);
      }
    };
    tunnel.addHandler(this.url_handler.bind(this));
  }
}
class ConfigHandler extends import_node_stream.EventEmitter {
  constructor(tunnel) {
    super();
    this.config_handler = (output, tunnel) => {
      const config_match = output.match(/\bconfig="(.+?)" version=(\d+)/);
      if (config_match) {
        try {
          const config_str = config_match[1].replace(/\\"/g, '"');
          const config = JSON.parse(config_str);
          const version = parseInt(config_match[2], 10);
          this.emit("config", {
            config,
            version
          });
          if (config && typeof config === "object" && "ingress" in config && Array.isArray(config.ingress)) {
            for (const ingress of config.ingress) {
              if ("hostname" in ingress) {
                tunnel.emit("url", ingress.hostname);
              }
            }
          }
        } catch (error) {
          this.emit("error", new Error(`Failed to parse config: ${error}`));
        }
      }
    };
    tunnel.addHandler(this.config_handler.bind(this));
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
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConfigHandler,
  ConnectionHandler,
  TryCloudflareHandler
});
