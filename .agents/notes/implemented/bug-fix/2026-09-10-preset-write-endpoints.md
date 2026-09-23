# Agent Note: Preset likes and installs were rejected by the worker

Status: implemented

## Problem

Clicking like on a preset on dsh-market.com returned HTTP 400, and the Worker log showed nothing but "invalid-params". The store had been publishing a preset manifest since [Community agent presets distributed through the Workshop](2026-09-09-community-agent-presets.md), and the manifest-derived allowlist in `market/worker/src/asset-allowlist.js` already listed `preset` — but the write endpoints validate the client-asserted kind against `KINDS`, a hand-maintained set that still held only `skin`, `pet` and `plugin`. Every preset like and every preset install report therefore failed the parameter check before Turnstile or the allowlist was ever consulted. The same three-kind assumption was hardcoded in the `readStats` and `readInstalls` bucket initializers, which skip rows whose kind has no bucket, so a preset row that did exist would have been invisible in `/api/stats` as well.

The preset-center note's claim that preset likes and install counts "keep working" was wrong: it verified the allowlist, not the kind gate.

## Decision

`preset` is a first-class asset kind in the Worker: `KINDS` includes it, both stats bucket initializers carry a `preset` bucket, and the OpenAPI schema and the API doc page list the kind. No D1 migration is needed — `counts` and `install_counts` key on a plain TEXT `kind` column with no check constraint.

The durable rule this exposes: **a market asset kind is registered in three places** — the publishing pipeline (`scripts/market-build` manifest plus its category vocabulary), the client surfaces (workshop card and site), and the Worker (`KINDS` plus both stats buckets). Registering only the first two publishes assets that the store graphs can never count.

## Alternatives considered

**Deriving the accepted kind set from the manifests the allowlist already reads.** Rejected: `isKnownAsset` deliberately fails open when the manifests are unreadable (an asset-serving outage must not break likes service-wide), so deriving the write surface from that same read would let an outage widen the set of accepted kinds. The static set is a cheap independent guard, and it now matches the allowlist's kind list.

**Adding `preset` to `KINDS` only.** Rejected as incomplete: `readStats` and `readInstalls` filter rows through objects initialized with three buckets, so preset votes and installs would still be dropped from the response the cards read.

**Fixing only the like endpoint and leaving install reporting alone.** Rejected: `/api/install` shares the same gate, the workshop reports a preset install on every install, and the client ignores the failure — the metrics would silently stay at zero.

## Consequences

- Preset likes record, the site shows the returned count, and preset installs contribute to the store's install metric; `/api/stats` now carries a `preset` bucket (both clients already fall back to an empty object, so no client change was required).
- Nothing needs backfilling: the requests were rejected before writing, so no preset rows exist from the broken period.
- The worker test fixture that feeds the allowlist previously mapped its singular call-site keys onto the plural manifest file names incorrectly and always served empty manifests, so the "unknown asset" test passed for the wrong reason. It now serves real items, which makes the positive preset cases meaningful.
- The three-place registration rule is recorded here, but only the Worker side has mechanical coverage; a future kind could still be registered in the pipeline and forgotten in a client vocabulary.

## Testing

- `scripts/market-worker.test.mjs`: a preset like and a preset install reach D1 with `kind: 'preset'` (both returned 400 `invalid-params` before the fix), and `/api/stats` returns the preset bucket; the manifest fixture now maps singular kinds onto the plural manifest files so the allowlist is genuinely exercised.
- Live probe: `POST /api/like` with a published preset id returned `400 invalid-params` before the fix and reaches the Turnstile gate afterwards, matching what `skin` and `plugin` requests do. A headless click-through cannot get past the Turnstile challenge (the vote is not recorded, and the site reverts to its unliked state), so the end-to-end confirmation is the reporter's: after the deploy a preset like records normally in a browser.
- `pnpm test:scripts` passes with the new cases.
