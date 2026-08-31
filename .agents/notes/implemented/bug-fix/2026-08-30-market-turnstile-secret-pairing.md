# Agent Note: Market likes outage came from an empty Turnstile secret upload, repaired and made self-verifying

Status: implemented

## Problem

Every `/api/like` (and `/api/install`) write returned 403 from 2026-08-26 15:59 UTC onward — zero likes for four days while the site and CI deploys looked healthy. The client half was innocent: real-browser probes showed the invisible widget issuing tokens fine, and the 403 body said `captcha-invalid`, meaning siteverify rejected a freshly issued token. The binding existed (`wrangler secret list`), the GitHub secret was byte-correct (length/fingerprint probe), and the Turnstile widget had never been modified — no single obvious fact explained the rejection.

## Decision

Root cause: `scripts/deploy-market`'s `sh()` helper called `spawnSync` with `stdio: 'inherit'` **and** `input: <secret>`. Node silently ignores `input` when stdin is not a pipe (reproduced locally: the child receives `""` with no error), so `wrangler secret put TURNSTILE_SECRET` read an empty stdin and uploaded an **empty binding value** while reporting `Success!`. Every CI deploy since the step was introduced (the `c6076c857` fail-closed change, 2026-08-26) re-emptied the binding; with the fail-closed gate in place, every tokenized write then failed closed. Manual `wrangler secret put` runs from a shell (a real pipe) restored likes temporarily, and the next deploy silently broke them again — which is why the outage looked intermittent across the repair attempts.

Repairs, applied 2026-08-30:

- `sh()` now passes `stdin` as `['pipe', 'inherit', 'inherit']` whenever `input` is given, so the secret actually reaches wrangler.
- The deploy verifies the put end-to-end: it probes siteverify with the binding value and a dummy response token, expecting `invalid-input-response`; `invalid-input-secret` fails the deploy loudly instead of shipping a write-dead worker.
- The worker's 403 responses now carry `captcha_error_codes` (siteverify error-codes, plus a synthetic `missing-secret-binding`), so a dead binding is diagnosable from the client side in one request.
- The GitHub `TURNSTILE_SECRET` was synced to the widget's true secret, machine-read from `GET /accounts/{account}/challenges/widgets/{sitekey}` (wrangler's OAuth token is accepted there).
- Verified end-to-end in the real Chrome against production: like and unlike return `200` with the vote count advancing and being restored; the post-deploy like check runs after the deploy workflow completes, not before.

## Alternatives considered

Reverting the `c6076c857` fail-closed change was rejected: it would restore anonymous writes — the failure proved the gate is load-bearing. Pinning wrangler to a version whose stdin handling happens to work was rejected: the spawn contract, not the wrangler version, was broken, and the ambiguity would resurface. Updating the secret through the Cloudflare REST API instead of wrangler was rejected as more surface than needed once the pipe was fixed. Rotating the widget secret in the dashboard was rejected: the API hands over the current secret and rotation needlessly invalidates a still-valid credential.

## Consequences

CI deploys now preserve the Turnstile pairing, and a regression fails the deploy with the siteverify code in the log instead of silently disabling likes. The worker's 403s self-describe the failing stage. The durable lessons: `spawnSync` + `input` + inherited stdin fails silently — verify what the child actually received whenever a payload is passed that way; and a fail-closed gate turns a broken deploy step into a site-wide outage, so the deploy must assert the gate's health, not just the step's exit code.

## Testing

Local `spawnSync` repro (child receives `""` under the old shape, the payload under the new one); `node --test scripts/market-worker.test.mjs` (36 pass); real-browser E2E against production with like/unlike `200`s; deploy run logs showing the pairing check pass (`invalid-input-response`); D1 `likes` daily-trend query confirming the 08-26 14:44 UTC cutoff.
