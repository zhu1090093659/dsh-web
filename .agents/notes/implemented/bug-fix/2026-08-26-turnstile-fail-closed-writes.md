# Agent Note: Turnstile fail-closed for market writes

Status: implemented

## Problem

`/api/like` and `/api/install` treat the Turnstile challenge as their only abuse gate (device_fp, install_id and asset_id are client-asserted and format-checked only), yet `verifyTurnstile` returned `true` whenever the `TURNSTILE_SECRET` binding was absent — any network client could post anonymous writes, mint attacker-keyed D1 rows, and move the publicly served stats. The binding was wired only by a conditional CI step (`deploy-market.yml` skipped `wrangler secret put` when the GitHub secret was empty), and `scripts/deploy-market` never asserted it, so a missing variable silently stripped the gating the repository rules mandate. A read-only audit traced the full path and confirmed no rate limit or manifest-membership check backs the gate up.

## Decision

The worker fails closed: `verifyTurnstile` returns `false` when the secret binding is absent, so both write endpoints answer 403 (`captcha-required` / `captcha-invalid`) exactly as they do for a rejected token in a configured deployment. `scripts/deploy-market` gains a post-deploy step that refreshes the binding from the deploy environment when `TURNSTILE_SECRET` is present and then verifies via `cf workers secrets list` that the worker actually holds it, failing the deploy loudly otherwise. The deploy workflow asserts the repository secret is configured before deploying, replacing the conditional put step (the deploy script now performs the put). OpenAPI summaries drop the "when configured" qualifier, and `market-worker.test.mjs` pins the fail-closed behavior: without the binding both endpoints return 403 and D1 is never touched.

## Alternatives considered

Keeping fail-open with a documentation warning was rejected: the gating is a repository rule, and a warning does not stop silent misconfiguration. Refusing the routes at dispatch with a dedicated 503 `captcha-unconfigured` was rejected: reusing the existing 403 `captcha-*` responses keeps client handling unchanged, and the deploy-time assertion surfaces misconfiguration earlier and louder than a runtime status code. Verifying the binding through the Cloudflare API instead of `cf workers secrets list` was rejected as more moving parts for the same signal.

## Consequences

Behavior is unchanged for any deployment that has the secret; unconfigured deployments now reject writes instead of accepting them anonymously, and a missing secret fails CI/deploy instead of shipping silently. Local smoke tests of the write endpoints need a stubbed binding (the test suite already injects one). Deploys now require the Cloudflare token to read the secret list, which the deploy token already can. The gating decision itself is unchanged — see [Workshop install counts and npm metrics](../feature/2026-08-26-workshop-install-and-npm-metrics.md) (cross-linked, not superseded).

## Testing

`node --test scripts/market-worker.test.mjs` (30 pass, including the new fail-closed case for both endpoints), `node --check scripts/deploy-market`, and `actionlint .github/workflows/deploy-market.yml`.
