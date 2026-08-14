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
var install_exports = {};
__export(install_exports, {
  install: () => install,
  install_linux: () => install_linux,
  install_macos: () => install_macos,
  install_windows: () => install_windows
});
module.exports = __toCommonJS(install_exports);
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_node_https = __toESM(require("node:https"));
var import_node_child_process = require("node:child_process");
var import_constants = require("./constants");
var import_error = require("./error");
const LINUX_URL = {
  arm64: "cloudflared-linux-arm64",
  arm: "cloudflared-linux-arm",
  x64: "cloudflared-linux-amd64",
  ia32: "cloudflared-linux-386"
};
const MACOS_URL = {
  arm64: "cloudflared-darwin-arm64.tgz",
  x64: "cloudflared-darwin-amd64.tgz"
};
const WINDOWS_URL = {
  x64: "cloudflared-windows-amd64.exe",
  ia32: "cloudflared-windows-386.exe"
};
function resolve_base(version) {
  if (version === "latest") {
    return `${import_constants.RELEASE_BASE}latest/download/`;
  }
  return `${import_constants.RELEASE_BASE}download/${version}/`;
}
async function install(to, version = import_constants.CLOUDFLARED_VERSION) {
  if (process.platform === "linux") {
    return install_linux(to, version);
  } else if (process.platform === "darwin") {
    return install_macos(to, version);
  } else if (process.platform === "win32") {
    return install_windows(to, version);
  } else {
    throw new import_error.UnsupportedError("Unsupported platform: " + process.platform);
  }
}
async function install_linux(to, version = import_constants.CLOUDFLARED_VERSION) {
  const file = LINUX_URL[process.arch];
  if (file === void 0) {
    throw new import_error.UnsupportedError("Unsupported architecture: " + process.arch);
  }
  await download(resolve_base(version) + file, to);
  import_node_fs.default.chmodSync(to, "755");
  return to;
}
async function install_macos(to, version = import_constants.CLOUDFLARED_VERSION) {
  let arch = process.arch;
  if (version !== "latest" && version_number(version) < 20240802) {
    arch = "x64";
  }
  const file = MACOS_URL[arch];
  if (file === void 0) {
    throw new import_error.UnsupportedError("Unsupported architecture: " + arch);
  }
  await download(resolve_base(version) + file, `${to}.tgz`);
  if (process.env.VERBOSE) console.log(`Extracting to ${to}`);
  (0, import_node_child_process.execSync)(`tar -xzf ${import_node_path.default.basename(`${to}.tgz`)}`, { cwd: import_node_path.default.dirname(to) });
  import_node_fs.default.unlinkSync(`${to}.tgz`);
  import_node_fs.default.renameSync(`${import_node_path.default.dirname(to)}/cloudflared`, to);
  return to;
}
async function install_windows(to, version = import_constants.CLOUDFLARED_VERSION) {
  const file = WINDOWS_URL[process.arch];
  if (file === void 0) {
    throw new import_error.UnsupportedError("Unsupported architecture: " + process.arch);
  }
  await download(resolve_base(version) + file, to);
  return to;
}
function download(url, to, redirect = 0) {
  if (process.env.VERBOSE) {
    console.log(redirect === 0 ? `Downloading ${url} to ${to}` : `Redirecting to ${url}`);
  }
  if (!import_node_fs.default.existsSync(import_node_path.default.dirname(to))) {
    import_node_fs.default.mkdirSync(import_node_path.default.dirname(to), { recursive: true });
  }
  return new Promise((resolve, reject) => {
    const request = import_node_https.default.get(url, (res) => {
      const redirect_code = [301, 302, 303, 307, 308];
      if (redirect_code.includes(res.statusCode) && res.headers.location !== void 0) {
        request.destroy();
        const redirection = res.headers.location;
        resolve(download(redirection, to, redirect + 1));
        return;
      }
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        const file = import_node_fs.default.createWriteStream(to);
        file.on("finish", () => {
          file.close(() => resolve(to));
        });
        file.on("error", (err) => {
          import_node_fs.default.unlink(to, () => reject(err));
        });
        res.pipe(file);
      } else {
        request.destroy();
        reject(new Error(`HTTP response with status code: ${res.statusCode}`));
      }
    });
    request.on("error", (err) => {
      reject(err);
    });
    request.end();
  });
}
function version_number(semver) {
  const [major, minor, patch] = semver.split(".").map(Number);
  return major * 1e4 + minor * 100 + patch;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  install,
  install_linux,
  install_macos,
  install_windows
});
