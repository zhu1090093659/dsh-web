# Local changes on top of upstream webdsh

Upstream baseline: futrime/webdsh (Apache-2.0), vendored 2026-08-22.
Every local change is marked with a `market/tryon:` comment in the file it touches.

## 1. Dependency cohort: official @deepseek-ai/* -> 0.1.1-rc.2

`package.json` pins every `@deepseek-ai/dsh*` dependency to the version the
dsh-web monorepo (and this machine's dsh) runs: `0.1.1-rc.2`. Two packages
have no such release and stay at `0.1.0-rc.7` (`dsh-client-schema-form`,
`dsh-client-web-react`); the landlock native addons moved to
`optionalDependencies` so macOS installs succeed (CI on Linux still gets them).

Installing uses `--legacy-peer-deps` because those two rc.7 packages declare
`^0.1.0-rc.7` peers against the rc.2 tree.

## 2. Client boot facade (`src/main.ts`)

The published frontend (0.1.1-rc.2) boots through the client-modules wire: a
queue facade on `window.__ModuleLoader__`, two parser rows preloaded as
blocking classic scripts, then the boot graph. The browser client-modules half
publishes the graph but cannot inject document rows (no index.html to serve),
so `main.ts` replicates the host's `bootInjections`: inline queue script,
preload rows looked up in `CLIENT_ROWS` (the graph omits browser-replaced
rows), and a wait until both factories registered before importing the shell.

## 3. Disabled client rows (`src/host/browser.patch.yml`)

`client-hmr`, `cordis-client-runner`, `ui-cordis` wait for a client
`modules` service the browser composition never provides. Try-on needs
neither hot reload nor the in-client runner console; the rows are disabled so
the boot audit stays clean.

## 4. Skin-center client half (`packages/dsh-web-tryon` + boot/patch wiring)

- `scripts/assemble.ts`: `scanClientPackages` also scans
  `node_modules/@linxin666`, so the skin-center client bundle joins the
  roster (client row only; its node half is stubbed).
- `packages/dsh-web-tryon/cordis.patch.yml`: hosts both rows — the try-on
  tools and the skin-center row (the roster follows composed rows).
- `src/host/boot.ts`: `@linxin666/dsh-client-ui-skin-center` node half is a
  no-op runtime module; the v2 API is served by web-tryon instead.
- `packages/dsh-web-tryon/src/index.ts`: host half implementing
  `/api/skin-center/v2/{catalog,active,skins/*}` from the market's static
  assets (`../assets/skins/<id>`, `../manifest/skins.json`). CSS is served
  as authored (no scoping/whitelist transform): the shipped skins are the
  repository's own reviewed set and the try-on page shows one skin at a time.
  `/active` persists in localStorage.
- `packages/dsh-web-tryon/src/client.tsx`: browser half. Reads
  `?skin=&theme=`, requires the skin-center module by id (retry loop), points
  `data-dsh-skin` at the target before the runtime's restore pass, and
  renders the try-on toolbar (skin picker, light/dark toggle, download).
- `src/host/seed.ts`: the try-on patch joined the shipped bundle layers.

## 5. Worker proxy (`market/worker/src/index.js`)

`GET /api/skin-center/v2/skins/<id>/{stylesheet,patches,hooks.mjs,assets/*,
preview/*}` proxies the static skin assets. The skin runtime loads its
stylesheet/hooks/media through `<link>`/`import()`/`<img>`, which bypass
the page's fetch patch and reach the network; fetch() calls are answered by the
in-page host and never reach the worker.

## Re-sync with upstream

Replace the tree with a fresh checkout of the same upstream commit, then
re-apply sections 1-5 (each file carries its marker comment), and re-run
`npm run build` — `src/generated`, `public/plugins`, `public/shell` and
`dist` are derived.
