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
var index_exports = {};
__export(index_exports, {
  main: () => main
});
module.exports = __toCommonJS(index_exports);
var import_node_fs = __toESM(require("node:fs"));
var import_node_https = __toESM(require("node:https"));
var import_node_child_process = require("node:child_process");
var import_lib = require("./lib.js");
var import_constants = require("./constants.js");
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "bin") {
    if (!args[1]) {
      console.log(import_lib.bin);
      return;
    }
    if (args[1] === "remove") {
      import_node_fs.default.unlinkSync(import_lib.bin);
      console.log("Removed cloudflared");
      return;
    }
    if (args[1] === "install") {
      const version = args[2] || import_constants.CLOUDFLARED_VERSION;
      if (version !== "latest") {
        console.log(`Installing cloudflared ${version}`);
        console.log(await (0, import_lib.install)(import_lib.bin, version));
      } else {
        console.log("Installing latest version of cloudflared");
        await (0, import_lib.install)(import_lib.bin, version);
      }
      return;
    }
    if (args[1] === "list") {
      import_node_https.default.get(
        {
          hostname: "api.github.com",
          path: "/repos/cloudflare/cloudflared/releases",
          headers: {
            "user-agent": "node-cloudflared"
          }
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            const releases = JSON.parse(data);
            for (const release of releases) {
              console.log(
                `${release.tag_name.padEnd(10)} (${release.published_at}) [${release.html_url}]`
              );
            }
          });
        }
      );
      return;
    }
    if (args[1] === "help" || args[1] === "--help" || args[1] === "-h") {
      console.log(`cloudflared bin                    : Prints the path to the binary`);
      console.log(`cloudflared bin remove             : Removes the binary`);
      console.log(`cloudflared bin install [version]  : Installs the binary`);
      console.log(`cloudflared bin list               : Lists 30 latest releases`);
      console.log(`cloudflared bin help               : Prints this help message`);
      console.log(`Examples:`);
      console.log(
        `cloudflared bin install            : Installs the latest version of cloudflared`
      );
      console.log(`cloudflared bin install 2023.4.1   : Installs cloudflared 2023.4.1`);
      console.log(
        `You can find releases at https://github.com/cloudflare/cloudflared/releases`
      );
      return;
    }
  }
  if (!import_node_fs.default.existsSync(import_lib.bin)) {
    console.log("Installed cloudflared to " + await (0, import_lib.install)(import_lib.bin));
  }
  const sub = (0, import_node_child_process.spawn)(import_lib.bin, args, { stdio: "inherit" });
  sub.on("exit", (code) => {
    if (typeof code === "number") {
      process.exit(code);
    } else {
      process.exit(1);
    }
  });
  const signals = ["SIGINT", "SIGTERM", "SIGQUIT"];
  for (const signal of signals) {
    process.on(signal, () => {
      sub.kill(signal);
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
