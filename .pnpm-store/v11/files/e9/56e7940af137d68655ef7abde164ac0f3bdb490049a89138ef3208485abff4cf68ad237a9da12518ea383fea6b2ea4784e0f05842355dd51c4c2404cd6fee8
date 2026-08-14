# cloudflared

A Node.js package that allows you to easily create HTTPS tunnels using Cloudflare's `cloudflared` command-line tool. It provides a typed API for creating tunnels and managing the `cloudflared` binary installation.

> This tool will automatically install the [latest version of `cloudflared`](https://github.com/cloudflare/cloudflared/releases/latest) (or `CLOUDFLARED_VERSION` env var if exists) at the first time.
> Then, it just passes down the command to `cloudflared`.

## Installation

You can install this package using your favorite package manager:

### PNPM

```sh
pnpm i -g cloudflared
```

### NPM

```sh
npm i -g cloudflared
```

### Yarn

```sh
yarn global add cloudflared
```

> If `CLOUDFLARED_VERSION` env var is set, it will install the specified version of `cloudflared`, otherwise it will install the latest version.

## CLI Usage

You can use the `cloudflared` command-line tool to create HTTPS tunnels. You can find the usage of `cloudflared` [here](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-useful-commands/).

In addition to the standard `cloudflared` commands, this package also provides an extra subcommand: `cloudflared bin`. You can use it to manage the `cloudflared` binary version.

```sh
❯ cloudflared bin --help
cloudflared bin                    : Prints the path to the binary
cloudflared bin remove             : Removes the binary
cloudflared bin install [version]  : Installs the binary
cloudflared bin list               : Lists 30 latest releases
cloudflared bin help               : Prints this help message
Examples:
cloudflared bin install            : Installs the latest version of cloudflared
cloudflared bin install 2023.4.1   : Installs cloudflared 2023.4.1
You can find releases at https://github.com/cloudflare/cloudflared/releases
```

## Library Usage

You can also use it as a library in your TypeScript / JavaScript projects.

### Binary Path & Install

You can get the path of the `cloudflared` binary and install it using the `bin` and `install` functions, respectively.

```js
import { bin, install } from "cloudflared";
import fs from "node:fs";
import { spawn } from "node:child_process";

if (!fs.existsSync(bin)) {
  // install cloudflared binary
  await install(bin);
}

// run cloudflared
spawn(bin, ["--version"], { stdio: "inherit" });
```

- `bin`: The path of the binary.
- `install`: A function that installs the binary to the given path.

### Tunnel

Checkout [`examples/tunnel.mjs`](examples/tunnel.mjs) (or [`examples/tunnel.js`](examples/tunnel.js) for CommonJS).

`Tunnel` is inherited from `EventEmitter`, so you can listen to the events it emits, checkout [`examples/events.mjs`](examples/events.mjs).

```js
import { Tunnel } from "cloudflared";

console.log("Cloudflared Tunnel Example.");
main();

async function main() {
  // run: cloudflared tunnel --hello-world
  const tunnel = Tunnel.quick();

  // show the url
  const url = new Promise((resolve) => tunnel.once("url", resolve));
  console.log("LINK:", await url);

  // wait for connection to be established
  const conn = new Promise((resolve) => tunnel.once("connected", resolve));
  console.log("CONN:", await conn);

  // stop the tunnel after 15 seconds
  setTimeout(tunnel.stop, 15_000);

  tunnel.on("exit", (code) => {
    console.log("tunnel process exited with code", code);
  });
}
```

```sh
❯ node examples/tunnel.mjs
Cloudflared Tunnel Example.
LINK: https://mailto-davis-wilderness-facts.trycloudflare.com
CONN: {
  id: 'df1b8330-44ea-4ecb-bb93-8a32400f6d1c',
  ip: '198.41.200.193',
  location: 'tpe01'
}
tunnel process exited with code 0
```

### Service

Checkout [`examples/service.mjs`](examples/service.mjs) (or [`examples/service.js`](examples/service.js) for CommonJS).

```js
import { service } from "cloudflared";

console.log("Cloudflared Service Example.");
main();

async function main() {
  if (service.exists()) {
    console.log("Service is running.");
    const current = service.current();
    for (const { service, hostname } of current.config.ingress) {
      console.log(`  - ${service} -> ${hostname}`);
    }
    console.log("metrics server:", current.metrics);
  } else {
    console.log("Service is not running.");
  }
}
```

```sh
❯ node examples/service.mjs
Cloudflared Service Example.
Service is running.
  - http://localhost:12345 -> sub.example.com
  - http_status:404 -> undefined
metrics server: 127.0.0.1:49177/metrics
```

NOTICE: On linux, service can only be installed and uninstalled by root.

Run service test on linux: `sudo -E env "PATH=$PATH" pnpm test`
