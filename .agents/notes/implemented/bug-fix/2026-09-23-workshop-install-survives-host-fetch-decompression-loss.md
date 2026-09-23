# Agent Note: Workshop install survives the host fetch decompression loss

Status: implemented

## Problem

Installing any skin from the Workshop card failed on the `0.1.7-alpha.2` host. The card's loopback call `POST /api/market/install-skin {"id":"orca-link"}` answered:

```json
{"ok":false,"error":"write","message":"Unexpected token '\u000b', \"\u000bz\u000f\u0000\ufffd...\" is not valid JSON"}
```

The market host half fetches `https://dsh-market.com/manifest/skins.json` itself and `JSON.parse`s the body. The body the host received was 20 484 bytes of raw brotli starting `0b 7a 0f 00 e4 af 74 f6`; the decoded manifest is 92 901 bytes.

The cause is host-wide and predates this plugin. The alpha.2 launcher imports `@deepseek-ai/dsh-http-proxy` inside `runProfile()`, and that package (like `@deepseek-ai/dsh-web-fetch-http`) imports the npm `undici` copy. Merely importing npm undici 8.x runs its `lib/global.js` initializer, which installs a dispatcher into both `Symbol.for('undici.globalDispatcher.2')` and the legacy `Symbol.for('undici.globalDispatcher.1')`. Node's built-in `fetch()` resolves the legacy slot, and the npm undici v8 `Dispatcher1Wrapper` placed there loses the `content-encoding` header and automatic decompression. Minimal repro on node 25.8.1:

- `await import('<dsh>/node_modules/undici/index.js')` then `fetch(url)`: `content-encoding: null`, body starts `0b 7a 0f 00`, `JSON.parse` throws.
- The same fetch without the import: `content-encoding: br`, 92 901 decoded bytes, parses.

Every plain `fetch()` in the host process is affected once npm undici has been imported, which the alpha.2 boot guarantees.

## Decision

The rule lives once in `shared/host/http.ts` as `withIdentityEncoding(init)`: it merges `accept-encoding: identity` into a request init while preserving caller headers, method and signal, so no call site re-derives it. The market installer adopts it at its single fetch choke point (`fetchWithTimeout` in `packages/dsh-market/src/core/installer.ts`), covering both the manifest and every asset download:

```ts
return await fetchImpl(url, withIdentityEncoding({ signal: AbortSignal.timeout(timeoutMs) }))
```

Every other host fetch that parses a remote body adopts the same helper: the plugin-manager npm-registry probe (`packages/dsh-plugin-manager/src/host/routes.ts`), the remote-web-ui registry and GitHub probes plus the `/pair-app` inner app-shell fetch (`packages/dsh-remote-web-ui/src/update.ts`, `packages/dsh-remote-web-ui/src/index.ts`), and the usage provider probes (`packages/dsh-usage/src/host/usage-service.ts`). Each package already carried the generated `http.ts` copy from `scripts/sync-shared.mjs`, so no new shared module or consumer wiring was added.

The origin honors it: the manifest arrives as 92 901 uncompressed bytes with no `content-encoding`, so `JSON.parse` and the asset writes never depend on the host fetch decoding a body. A regression test in `packages/dsh-market/src/core/installer.test.ts` mirrors the broken host — its mock returns raw brotli unless the request asked for identity — and asserts the full skin install succeeds with correct file bytes.

The durable fix belongs upstream: the host should not let npm undici overwrite the legacy global-dispatcher slot Node's built-in fetch reads. This repository cannot modify a DSH checkout, so the identity request is the compatibility contract here.

## Alternatives considered

- **Repeat the header at each call site instead of a shared helper.** Rejected: six host fetch sites would each re-state the same non-obvious rule with no drift gate, and the family already centralizes host HTTP utilities in `shared/host/http.ts`.
- **Patch `@deepseek-ai/dsh-http-proxy` to stop installing the npm-undici dispatcher.** Rejected for this repository: it is DSH source, and the repository rule forbids modifying a DSH checkout. It stays the upstream owner of the durable fix.
- **Decompress in the installer.** Rejected: in the broken state the wrapper also hides `content-encoding`, so a compressed body is indistinguishable from a corrupt one.
- **Fetch through the host `ctx.web` service instead of global fetch.** Rejected: the npm undici fetch it wraps does decode, but adopting it changes this module's service injection and SSRF policy for a problem the request header solves; the installer already pins `MARKET_ORIGIN`.
- **Detect the broken dispatcher and skip the request.** Rejected: there is no public, version-stable way to ask whether the global dispatcher decodes, and the installer would still need a fallback transport.

## Consequences

Manifests and assets always transfer uncompressed (the skin manifest is ~93 KB instead of ~20 KB brotli) — a small bandwidth cost for correct bytes.

Host-side consumers of compressed remote bodies now share one contract through `withIdentityEncoding`: the plugin-manager npm-registry probe, the remote-web-ui registry/GitHub probes and inner app-shell fetch, and the usage provider probes. A new host fetch that parses a remote body without the helper is a deviation from a stated guarantee rather than an open question.

The running `dsh web` process keeps the pre-fix module in memory, so the Workshop install stays broken until the host restarts; the host half reloads only with the service.

## Testing

- `pnpm --filter @linxin666/dsh-client-ui-market test` (92 tests; the new case fails without the header).
- `pnpm --filter dsh-web-shared test` (the helper forces identity while keeping caller headers, method and signal).
- `pnpm --filter @linxin666/dsh-remote-web-ui test`, `pnpm --filter @linxin666/dsh-client-ui-plugin-manager test`, `pnpm --filter @linxin666/dsh-usage test`: their existing probe tests now assert the identity header on the registry, GitHub, app-shell and provider fetches.
- `pnpm --filter @linxin666/dsh-client-ui-market typecheck`.
- End-to-end in a replica of the broken host: import npm undici, then run the built `installAsset('skin', 'orca-link', { dshHome })` against the real origin. Result `{ok:true,...,files:15}`; `skin.json` parses to `id: orca-link`, `version: 0.1.0`; `assets/orca-link-light-hero.webp` has a valid `RIFF....WEBP` header. The replica's plain fetch still returns unparseable bytes.
- `pnpm build`, `pnpm libs:write`, `pnpm libs:check` (committed `lib/` refreshed with the source fingerprints).
