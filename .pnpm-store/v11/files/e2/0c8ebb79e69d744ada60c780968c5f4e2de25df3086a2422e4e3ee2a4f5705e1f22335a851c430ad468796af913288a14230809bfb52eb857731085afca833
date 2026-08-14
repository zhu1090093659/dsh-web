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
var regex_exports = {};
__export(regex_exports, {
  config_regex: () => config_regex,
  conn_regex: () => conn_regex,
  connectorID_regex: () => connectorID_regex,
  disconnect_regex: () => disconnect_regex,
  index_regex: () => index_regex,
  ip_regex: () => ip_regex,
  location_regex: () => location_regex,
  metrics_regex: () => metrics_regex,
  tunnelID_regex: () => tunnelID_regex
});
module.exports = __toCommonJS(regex_exports);
const conn_regex = /connection[= ]([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const ip_regex = /ip=([0-9.]+)/;
const location_regex = /location=([A-Za-z0-9]+)/;
const index_regex = /connIndex=(\d)/;
const disconnect_regex = /Unregistered tunnel connection connIndex=(\d)/i;
const tunnelID_regex = /tunnelID=([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const connectorID_regex = /Connector ID: ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const metrics_regex = /metrics server on ([0-9.:]+\/metrics)/;
const config_regex = /config="(.+[^\\])"/;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  config_regex,
  conn_regex,
  connectorID_regex,
  disconnect_regex,
  index_regex,
  ip_regex,
  location_regex,
  metrics_regex,
  tunnelID_regex
});
