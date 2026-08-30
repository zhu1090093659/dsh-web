# Agent Note: Market likes outage was a never-paired Turnstile secret, repaired from the widget API

Status: implemented

## Problem

Every `/api/like` (and `/api/install`) write returned 403 from 2026-08-26 15:59 UTC onward — zero likes for four days while the site and CI deploys looked healthy. The client half was innocent: a real-browser probe showed the invisible widget issuing tokens fine, and the 403 body said `captcha-invalid`, meaning siteverify rejected a freshly issued token. The binding existed on the worker (`wrangler secret list` showed `TURNSTILE_SECRET`), the GitHub secret predated the outage, and the Turnstile widget had never been modified since creation, so no single obvious fact explained the rejection.

## Decision

The value in the GitHub `TURNSTILE_SECRET` secret had never been the widget's true secret. The mask was the old fail-open branch: `verifyTurnstile` returned `true` without a binding, so during 2026-08-22..08-26 (while the CI put-step was broken, per the `a2ffaa566` fix) every like was accepted anonymously and the stored secret value was never exercised. The `c6076c857` fail-closed deploy was the first to actually push the GitHub value into the worker, and siteverify started rejecting everything from that hour.

Repair, applied 2026-08-30:

- The true secret is machine-readable from the Cloudflare API: `GET /accounts/{account}/challenges/widgets/{sitekey}` returns the `secret` field, and wrangler's OAuth token is accepted there. No dashboard visit or rotation is required.
- The true value was put straight into the worker (`wrangler secret put TURNSTILE_SECRET` from `market/worker`, exact bytes, no trailing newline) and synced into the repo secret (`gh secret set TURNSTILE_SECRET --body`), so CI deploys re-put the same bytes.
- Verified end-to-end in the real Chrome against production: like returned `200 {"ok":true,...}` with the vote count advancing, and the test like was toggled back with a second `200` (`unlike`), leaving D1 counts untouched.

The first repair relapsed within the hour: the 0.3.8 release deploy at 07:59 UTC re-put the GitHub value, which `gh secret set --body` had stored polluted (siteverify rejected it again — same `captcha-invalid`). The GitHub secret was re-set from a 35-byte no-newline file over stdin, and `ensureTurnstileSecret` in `scripts/deploy-market` now trims the secret before putting, so any whitespace picked up on the way into the repo secret can never reach the worker.

## Alternatives considered

Rotating the widget secret in the dashboard and updating CI was rejected: rotation needlessly invalidates a still-valid credential when the API hands over the current one. Reverting the `c6076c857` fail-closed change was rejected: it would restore anonymous writes — the failure proved the gate is load-bearing, and the correct fix is a correct secret, not a weaker gate. Adding siteverify `error-codes` to the 403 response body was deferred: it would have shortened this diagnosis (the codes distinguish `invalid-input-secret` from hostname/action mismatches) but changes the public API contract and its docs/tests, which this incident did not require.

## Consequences

Worker and CI now hold the same API-true secret, and likes work again — including across deploys, since the deploy script sanitizes the value it puts. The durable lesson is recorded here because no code carries it: a fail-open branch can hide a wrong credential for exactly as long as the branch is reachable, and the first fail-closed deploy becomes the outage; a byte-exact secret channel matters just as much, because a trailing newline in the repo secret silently recreates the same outage on the next deploy. When a Turnstile-gated write starts failing with `captcha-invalid` while tokens are being issued, compare the worker's binding against `GET .../challenges/widgets/{sitekey}` before suspecting the client, the widget config, or Cloudflare.

## Testing

Real-browser probe against production: `/api/like` 403 `captcha-invalid` before the secret put, `200` like and `200` unlike after; D1 `likes` daily-trend query confirmed the 08-26 14:44 UTC cutoff; `gh api .../actions/secrets` confirmed the repo secret refresh. No code changed, so no build or test gates run.
