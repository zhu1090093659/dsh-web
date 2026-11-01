# Agent Note: The market deploy lane runs on the cf CLI

Status: implemented

## Problem

The market deploy lane drove the wrangler CLI: `deploy-market.yml` installed wrangler globally, `scripts/deploy-market` shelled out to `wrangler d1 migrations apply dsh-market --remote`, `wrangler deploy`, `wrangler secret put` and `wrangler secret list`, and each Worker directory described itself with a `wrangler.jsonc`. Cloudflare's `cf` CLI replaces that tooling, and its project model reaches the lane in four places: cf resolves the Worker manifest `cloudflare.config.ts` only in the directory that holds it, and an ancestor `package.json` is discovered upward but never modified, so each Worker directory has to carry its own `package.json` and its own `node_modules`; a Wrangler-only key has no equivalent in that manifest and moves into a generated `wrangler.config.ts`; `cf d1 migrations apply` takes the D1 database ID rather than the database name; and there is no global wrangler to install — the manifest has to declare its dev-server (here the legacy `wrangler` bundler) and provide it in that directory's own `node_modules`. The Worker configuration could therefore not be read by the CLI this repository uses for every Cloudflare operation, and the lane depended on a tool that is no longer installed.

## Decision

- `market/worker/cloudflare.config.ts` is the Worker's manifest: name, compatibility date, entrypoint, observability, the `assets.runWorkerFirst` list, `triggers.fetch` for the wildcard zone route `*.dsh-market.com/*`, `triggers.scheduled` for the `*/30 * * * *` cron, the `DB` (D1), `TELEMETRY_VIEW` (service), `RELAY_BRIDGE` (Durable Object) and `ASSETS` bindings, and the Durable Object class ledger `exports.RelayBridge = exports.durableObject({ storage: "sqlite" })`. Custom domains stay dashboard-managed and are declared nowhere, as before.
- `market/worker/wrangler.config.ts` carries the one key Wrangler owns and `cloudflare.config.ts` has no equivalent for, `assetsDirectory: "../dist"`: cf delegates the bundle to Wrangler (`bundler=wrangler`), so `cf build` and `cf deploy` print "Delegating to Wrangler" and the static asset directory has to live in that file.
- The Worker directory is its own npm package — `package.json` plus a committed `package-lock.json`, `devDependencies` `cf` and `wrangler`, the shape `market/shell` already has — and it is not a pnpm workspace member, so the lane installs it explicitly with `npm ci --prefix market/worker`.
- `market/telemetry-view/cloudflare.config.ts` declares the `tv.dsh-market.com` custom domain and the `MARKET` service binding; `probe/relay-bridge/cloudflare.config.ts` declares the `PROBE_INSTANCE` text binding, the `BRIDGE` Durable Object binding and its class ledger. All three `wrangler.jsonc` files are deleted.
- `scripts/deploy-market` drives `cf`: `cf d1 migrations apply <database id> --dir migrations`, then `cf deploy`, then `cf workers secrets list --worker dsh-market` to prove `TURNSTILE_SECRET` and `ASSET_ATTEST_SECRET` are bound (likes and installs, and the attestation route, fail closed without them). A secret refresh stages the value in a 0600 file and uploads it with `cf workers secrets update <NAME> --worker <WORKER> --type secret_text --text @<path>`; `--type` is mandatory off a TTY, where cf otherwise answers `--type is required (one of: secret_text, secret_key)` without sending a request. The file reference keeps the plaintext out of the command line and out of the failure log, which prints the command and its arguments.
- The bounded retry policy and the Ray ID diagnostics wrap every `cf` invocation; they are owned by [The Deploy Market lane retries a throttled Cloudflare API instead of failing on the first 429](../bug-fix/2026-10-27-market-deploy-retries-throttled-api.md).
- CI installs `cf@latest` globally and runs `npm ci --prefix market/worker`; the global wrangler step is gone.

## Alternatives considered

- **Keep the wrangler CLI and pin it inside each Worker directory.** Rejected: the repository's Cloudflare tooling is `cf`, wrangler is no longer installed globally, and a lane carrying its own wrangler would keep a second CLI contract alive for one deploy path — its own auth, its own config format and its own secret commands.
- **Pass the secret value on the command line.** Rejected: every failure line prints the command and its arguments, so a failed upload would publish the secret into the job log; the 0600 file reference keeps the value out of the argv and the log at once.

## Consequences

- The lane's Cloudflare commands are `cf`; Wrangler remains as the bundler cf delegates the build to, installed in the Worker's own tree, and a failure that is really Wrangler's is still classified as transient by the retry policy, whose signatures cover both CLIs' output shapes.
- `.cloudflare/` is cf's build and type output directory and is git-ignored.
- The D1 step now names the database ID, so a mistyped database cannot be silently migrated by name: `cf d1 migrations apply` requires the ID.
- cf is a beta CLI (1.0.0-beta.26 in this lane) and Cloudflare keeps Wrangler maintained for 18 months after cf leaves beta, so the bundler half of the lane is not on a cliff.
- The lane's step order is unchanged — migrations, deploy, secret verification — so the retry budget, the siteverify pairing probe and the `market-build --check` preflight all still apply.
