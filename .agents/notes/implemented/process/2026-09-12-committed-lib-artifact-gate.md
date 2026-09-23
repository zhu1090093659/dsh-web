# Agent Note: Gate for Committed lib Artifacts

Status: implemented

## Problem

Four packages commit their build output to git (`dsh-market`, `dsh-preset-center`, `dsh-web-all`,
`skins/skin-center`), and their `package.json` `main`/`exports`/`files` resolve to those bytes: a
consumer that loads the package without rebuilding it gets exactly what the repository holds. Twice
that output has lagged its sources:

- skin-center's `lib/index.js` carried the previous maid-atelier `hooksSha256` while
  `src/reviewed-hooks.generated.ts` already held the new value, so the reviewed fallback for
  pre-provenance Workshop installs could never match (fixed by hand on 2026-09-11).
- The aggregate package inlines every child plugin's `src/client`; a child change without an aggregate
  rebuild leaves the host new and the page old — the 2026-09-09 "restart changed nothing" incident its
  own AGENTS.md records.

No gate covered the class: `skin-center:check` validates the generated source registry against the
skins directory, `aggregate:check` validates the manifest, `runtime-deps:check` only proves that
bare imports resolve.

## Decision

`scripts/lib-artifact-check.mjs` records, for every package with a git-tracked `lib/`, a fingerprint
of the **source inputs** that output was built from: the package's own `src/`, plus — for the
aggregate — the `src/` of every package listed in `aggregate.yml`. Test files are excluded because
they never reach a bundle, so editing one must not demand a rebuild. The fingerprints live in
`scripts/lib-artifact-fingerprints.json`; `--check` compares the recorded values against the working
tree and fails with the rebuild instruction when they moved.

Wiring: `pnpm libs:check` (the gate) and `pnpm libs:write` (record after a build) in the root
scripts, a CI step placed **before** the Build step — a build would otherwise leave the tree freshly
rebuilt and mask a stale commit — and the rebuild-and-record rule in the root AGENTS.md.

Why not compare bytes with a fresh build: a build embeds the checkout's absolute path into bundles
(CSS-module hashes), so rebuilt bytes differ per machine. The CI workflow already documents that
constraint, and it is why this gate fingerprints sources instead of artifacts.

## Verification

- `pnpm libs:check`: OK across the four committing packages.
- `pnpm test:scripts`: 280 tests pass, including six new cases for the bundled-source filter, the
  order-independent fingerprint, and the aggregate input parser.
- The two bundles affected by this session's fixes were rebuilt and now carry them — the aggregate
  bundle contains the new `usage.disabled` copy and the pet's `workTickWindowMs` gate — and the
  fingerprints were re-recorded in the same commit.
- `pnpm docs:check` and `pnpm i18n:check` pass with the AGENTS.md update.

## Alternatives considered

Diffing the working tree against a fresh build (`git diff --exit-code` after `pnpm build`) was
rejected: the absolute-path embedding makes rebuilt bytes machine-specific, so the check would fail
on every runner that is not the one that produced the commit.

Storing the fingerprint inside each package's `lib/` was rejected: it would publish build bookkeeping
into every npm package, and `files: ["lib"]` would ship it to users.

Letting `pnpm build` record the fingerprints automatically was rejected: CI runs the check before the
Build step, so a build-time write would make the gate pass unconditionally — the one thing it must not
do.

A targeted skin-center check (comparing the reviewed-hooks table embedded in the bundle against the
generated registry) was rejected as too narrow: it would leave the aggregate's inlined child sources
unguarded, which is the other half of the same failure class.

## Consequences

A commit that changes any package's `src/` — including a child plugin's client sources — without
rebuilding the affected bundles now fails CI, at the cost of one extra `pnpm build && pnpm libs:write`
for contributors. The fingerprint proves only that sources did not move after the recorded build; it
does not prove the artifacts compile correctly, which remains the Build step's job. Skin assets and
`market/dist` stay outside this gate: their own checks (`skin-hooks:check`, `market:check`) already
cover them.
