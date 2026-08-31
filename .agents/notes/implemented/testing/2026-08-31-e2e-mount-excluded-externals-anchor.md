# Agent Note: e2e mount smoke asserted the excluded externals still mount

Status: implemented

## Problem

The v0.3.9 release pipeline ran the tag-triggered `build, test, gated npm publish` job through its full gate and published the whole family to npm successfully. The downstream `verify-release` job's mount-smoke lane (`scripts/e2e-mount.sh` + `tests/e2e/mount.e2e.ts`) failed, so the GitHub Release was not created: the smoke timed out waiting for `[data-dsh-better-sidebar]`.

The assertion was stale. The alpha.2 cohort removed the `@deepseek-ai/dsh-client-runtime` face that `dsh-better-sidebar` and `@mlgbnb/dsh-archive-manager` hard-import, so both were excluded from the `dsh-web-all` aggregate (see [sdk-cohort 0.1.2-alpha.2 upgrade](../architecture/2026-08-30-sdk-cohort-0.1.2-alpha.2-upgrade.md) and its "exclude alpha.2-incompatible external plugins" commit). `scripts/aggregate.test.mjs` was updated in that same change to assert the two must NOT be mounted (the row ids `web-ui-better-sidebar` / `web-ui-archive-manager` must be absent from `cordis.patch.yml`), but the e2e mount smoke was missed: it still required the better-sidebar host div to attach, so it contradicted the very exclusion it was meant to smoke-test. The npm content was correct; only the smoke's boot proof was wrong.

## Decision

Rewrite `tests/e2e/mount.e2e.ts` to assert the post-exclusion boot contract instead of the removed mount:

- anchor the boot proof on `[data-dsh-frame]` — the official host frame the shell always renders (used across dsh-web plugin CSS and referenced by the aggregate shim), which is cohort-stable and independent of any external plugin;
- assert `[data-dsh-better-sidebar]` is ABSENT (count 0), not present;
- keep the no-crash-strip / no-pageerror / no-plugin-console-error assertions (the `dsh-better-sidebar` / `archive-manager` crash-prefix patterns stay useful as negative guards).

The test also documents that `@morlay/better-session` stays but ships inactive, so no e2e assertion requires it to mount.

## Alternatives considered

- Anchor on `[data-dsh-plugin]`: rejected — that attribute is only emitted by specific plugin surfaces (e.g. remote-web-ui suppression keys), not the shell/family root, so it does not appear for the aggregate app and the wait times out.
- Keep the better-sidebar mount assertion and re-add the plugins: rejected — that undoes the deliberate alpha.2 exclusion that exists to prevent a boot-aborting loader failure.
- Anchor on the page title / `body`: rejected — weaker, not a DOM mount contract.

## Follow-up: the anchor rewrite did not turn CI green; the token URL was the blocker

The `[data-dsh-frame]` rewrite fixed the stale assertion but dev CI kept failing (eight consecutive runs, 15:34-01:36 UTC) — still a 30 s timeout, though now on the frame selector. The page snapshot from those runs showed the browser-auth 401 page (`dsh web authentication required; reopen the URL printed by dsh web.`), not the app: alpha.2 `dsh web` prints the tokenized root URL (`dsh web: http://127.0.0.1:PORT/?token=<launch-token> (LAN: ...)`), and `scripts/e2e-mount.sh` parsed it with `grep -oE 'dsh web: http://127\.0\.0\.1:[0-9]+'` — silently dropping the `?token=` operand, so Playwright hit the auth fence and the frame never mounted. Two independent causes had been collapsed into one: the assertion was stale AND the alpha.2 harness began gating the root URL behind browser auth.

The Testing section below originally claimed the auth fence was a local-only confound (the alpha.1 source checkout) and that the CI global `alpha.2` CLI did not serve it. That was wrong: every CI run pinning `@deepseek-ai/dsh@0.1.2-alpha.2` (commit `8b0191fea`, from 15:47 UTC onward — including all runs after the rewrite) shows the auth page. The local reproduction was not confounded; it reproduced the same fence CI hit. The 15:34 UTC run that motivated the rewrite passed against rc.2, which prints a bare URL.

Fixed in `scripts/e2e-mount.sh` by parsing up to the next token boundary (`[^ )]*`) so the full tokenized URL survives: local `bash scripts/e2e-mount.sh` now passes (the family-bundle boot test, 510 ms vs the former 30 s timeout). `tests/e2e/mount.e2e.ts` also gained a 5 s fast-fail on the auth-page text so a future token-less URL fails with a targeted message instead of a frame timeout. Lesson: when a harness upgrade changes the printed URL shape or gates the root, the boot marker and the URL parse are both part of the smoke contract, and a red dev CI after a "fix" is a signal the diagnosis was incomplete.

Second follow-up (2026-08-31): upstream shipped `dsh-better-sidebar@0.18.0-alpha.0` (peers `^0.1.2-alpha.2`, `dsh.client.inject` now naming `@deepseek-ai/dsh-client-modules`), so the aggregate re-added it at that exact pin — see [re-add-better-sidebar-alpha2](../architecture/2026-08-31-readd-better-sidebar-alpha2.md) — and this lane's assertions flipped back: `[data-dsh-better-sidebar]` must attach (count 1) after the frame mount, and `[data-dsh-archive-manager]` must stay absent (1.0.7 is still the latest upstream build). The crash-strip patterns and the auth fast-fail stay.

## Consequences

- The mount smoke now proves "the aggregate boots cleanly and the excluded externals are absent" rather than "better-sidebar is present," matching the shipped behavior.
- The boot anchor `[data-dsh-frame]` must stay cohort-stable; if the official host frame attribute ever changes, the smoke fails loudly on the next release (a drift trip, not a silent pass).
- `v0.3.9` itself was released with the corrected npm content; the GitHub Release was created manually after the smoke fix because the tag-pipeline `verify-release` job cannot be re-run against a changed tree under an already-pushed, already-published tag.

## Testing

- Local reproduction of the pre-fix failure was confounded by an environmental auth gate: the local `dsh` shim runs the `dsh-v0.1.2-alpha.1` source checkout, whose `dsh web` serves the harness browser-auth fence on a fresh scratch home (the CI global `@deepseek-ai/dsh@0.1.2-alpha.2` does not, per the running original smoke), so the local page showed "authentication required" instead of the app.
- `scripts/aggregate.test.mjs` still passes (asserts the exclusion); `docs:check` passes with the new anchor.
- The fix is on `dev`/`main` at `e1b13cbe7`; the next release's mount smoke will validate it in CI (the authoritative environment).
