# Agent Note: Drop the deprecated @morlay/better-session aggregate integration

Status: implemented

## Problem

The `@morlay/better-session` integration (branching session editing on an RDB persistence backend) was deprecated: the stock jsonl backend owns session storage again, and the integration shipped inactive by default. Its aggregate row, three expanded sub-plugin rows, npm dependency, four `minimumReleaseAgeExclude` pins, the `@morlay/ui-conversation-message-actions` patchedDependency with its patch file, and the dedicated maintenance CLI stayed in the tree. The dormant surface rode every cohort bump (lockfile resolution, release-order checks) and made the external-plugin story harder to audit.

## Decision

The integration is removed from the aggregate. The external row and its `"inactive": true` marker go from `packages/dsh-web-all/aggregate.yml`; `node scripts/aggregate.mjs` regenerates `cordis.patch.yml` without the `web-ui-session-branch` / `web-ui-session-rdb` / `web-ui-conversation-message-actions` rows and their `disabled: true` overrides; the `@morlay/better-session` devDependency, the four release-age exclusions, the patchedDependency entry plus patch file, and `scripts/dsh-better-session.mjs` with its test are deleted. The generator's inactive-external mechanism and its rationale comment stay (generic); the comment no longer names the removed script. The aggregate test's expansion assertions become a negative guard asserting no `@morlay/` reference re-enters `cordis.patch.yml`.

The dsh-perf Better Session card and its native `src/bsm` migration core were untouched by this removal — they are the repository's own reimplementation (provenance references only, no `@morlay/*` imports). The card's enable switch, which wrote managed overrides for the removed aggregate rows, became inert; the follow-up trim shipped the same day in [remove-dsh-perf-better-session-card](2026-09-02-remove-dsh-perf-better-session-card.md).

## Alternatives considered

- Keep the rows shipping disabled: rejected — the integration is deprecated, and dormant externals still cost lockfile, release-order, and audit surface on every cohort move.
- Remove the dsh-perf Better Session card together with the integration: rejected — the card is the repository's own management surface folded into dsh-perf by earlier decision, and its migration/status tooling still serves legacy sessions.

## Consequences

Session storage runs on the stock jsonl backend with no opt-in path back to RDB persistence through this repository; environments that want better-session install it directly against their own profile. Profile overrides naming `web-ui-session-branch` / `web-ui-session-rdb` / `web-ui-conversation-message-actions` become no-ops. Legacy jsonl.zstd data stays in place on the stock backend — the dsh-perf Better Session card followed the integration out the same day (see the removal note above). The dsh-web-all README loses its opting-in section; the root README feature bullet, npm plugin table row, and third-party license entry go with it.

## Testing

`node scripts/aggregate.mjs` regenerates the patch (20 source blocks, 21 rows); the lockfile resolves zero `@morlay/*` packages; `scripts/aggregate.test.mjs` asserts the negative guard; the docs pair checks pass after `verify-docs --write` re-records the bilingual hashes.
