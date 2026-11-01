# Agent Note: The Deploy Market lane retries a throttled Cloudflare API instead of failing on the first 429

Status: implemented

## Problem

The Deploy Market lane went red three times on dev, and each run failed about one second into `node scripts/deploy-market`: run 40350674320 (2026-10-26 15:34), run 40367640238 (2026-10-26 17:20), run 40430514377 (2026-10-27 01:05). The log reads `Received a malformed response from the API` for `GET /accounts/***/workers/services/dsh-market` with `-> 429 Too Many Requests`, then `deploy-market: wrangler deploy failed (exit 1)`. The lane ran the wrangler CLI at the time; it runs `cf` today.

Nothing was wrong with the request the lane sent. The 429 carried no `Retry-After` header, and wrangler only backs off when that header is present (`wrangler-dist/cli.js` 62987 and 65214), so the first throttled response ended the lane.

The client version was not the variable either. The last green run (40285936221, 2026-10-26 07:27) installed wrangler 4.152.0 and the failing runs installed 4.153.0, but both bundles carry the same 14 `workers/services` call sites; what differed was which request the API throttled, not the client.

One more red run belongs to the history and not to this decision: run 40212351108 (2026-10-25) failed earlier, in the Market consistency step, and was fixed separately.

## Decision

`scripts/deploy-market` runs every `cf` invocation under a bounded retry policy: `MAX_ATTEMPTS = 4` (line 48), the first attempt plus at most three retries, with `RETRY_BACKOFF_MS = [5000, 20000, 60000]` (line 51) between them.

`classifyTransientFailure` (line 102) tests the child's failure text against `TRANSIENT_SIGNATURES` (line 72) and recognizes HTTP 429, HTTP 5xx in the shapes the CLIs print them, the text `malformed response from the API`, and `ECONNRESET` / `ETIMEDOUT` / `EPIPE` / `socket hang up`. The 5xx shapes are wrangler's (`-> 503`, `HTTP 522`, `statusCode: 500`, `Status code: 503`) plus cf's typed-command rendering, which comes in two forms: `<status> <text> · HTTP <path>`, and `<status>  · HTTP <path>` with a double space when cf's fixed status-text table has no entry for the code (520-527 and friends render with an empty text). Neither form carries the status anywhere else on the line — no `HTTP 5xx`, no `Status code:` marker — so the wrangler-shaped branch misses both; a single branch anchored on cf's ` · HTTP ` separator covers them. A failure that matches none of those keeps the fail-fast path and the byte-identical message (line 258).

When the budget is spent, the failure message carries the reason, the attempt count, the Cloudflare Ray ID when the response had one, and a bounded 200-line tail of the captured output (`failureMessage`, line 240; `createTail`, line 122). Child stdout and stderr stay live in the job log through a relay while the same text is kept in the bounded ring (`spawnAttempt`, line 167), so a retry that eventually succeeds still leaves the earlier attempts readable.

Everything else in the lane is untouched: the `--cf` option, the `TURNSTILE_SECRET` and `ASSET_ATTEST_SECRET` fail-closed gates, the siteverify pairing probe, the `market-build --check` preflight, the D1 migration step and every exit code behave as they did before the retries.

## Testing

`scripts/deploy-market.test.mjs` drives the policy through injected attempts and waits, with no sleeping and no network: it proves retry-then-success, budget exhaustion with the Ray ID and the captured evidence, and exactly one attempt for a non-transient failure. Two further cases run a real child to cover the output relay and the 0600 file the secret bindings ride.

The verification this change requires: `pnpm test:scripts`, `pnpm test:standards`, `pnpm typecheck`, and the first Deploy Market run after the change is pushed.

## Alternatives considered

- **Pin wrangler to the last green version.** Rejected: the evidence shows no version correlation, since both bundles carry the same 14 `workers/services` call sites, and a pin would freeze upstream fixes without touching the throttling.
- **Move the retry into the workflow step.** Rejected: a step retry would re-run the D1 migration, the deploy and the secret refresh, and would re-run the `market-build` preflight, all for one throttled HTTP response.
- **Migrate the lane to the `cf` CLI now.** Rejected for that change rather than forever: it needed a `cloudflare.config.ts` for `market/worker` and wrangler as that directory's devDependency, so it was a larger change to revisit only if bounded retries did not rescue the lane. The migration has since shipped: the lane runs on the `cf` CLI ([The market deploy lane runs on the cf CLI](../process/2026-10-27-cf-cli-market-deploy-lane.md)).

## Consequences

- A bare `429` token anywhere in the child output can cost up to 85 seconds of retries (5 + 20 + 60) before the same failure surfaces, and it never turns a failure green. The added wait is bounded well inside the lane's 15-minute timeout.
- Piping the child's output costs the CLI's ANSI colours when the script is run by hand locally; CI is unaffected.
- Residual risk, stated plainly: if the 429 is a persistent account-level throttle rather than a transient one, retries will not rescue the lane. The lane has since moved to the `cf` CLI, and the retries stay in front of every invocation.
