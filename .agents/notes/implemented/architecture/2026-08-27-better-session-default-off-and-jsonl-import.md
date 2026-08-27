# Agent Note: better-session ships inactive with a jsonl-to-sqlite migration tool

Status: implemented

Supersession check: [better-session-replaces-chat-recovery](2026-08-27-better-session-replaces-chat-recovery.md) owns the ingestion mechanics (bundle expansion, dependency pinning, chat-recovery retirement); those facts remain accurate. This Note supersedes its rollout default — the integration is no longer active on upgrade — and owns the migration tooling from here on. A pointer to this file was added to that Note's Consequences in the same change.

## Problem

The original rollout made better-session mount immediately, and the first restart exposed two facts together:

1. Its bundle patch swaps `ctx.sessionPersistence` to an empty SQLite store, so every pre-existing jsonl session silently vanished from the conversation list (verified on the maintainer machine: 481 logs across 10 projects stayed on disk, invisible in the UI).
2. Upstream ships **no importer** — grepping all three published packages finds only a comment refusing schema migration — so there is no supported way back without data loss or hand-editing.

An aggregate whose headline feature hides the user's own history by default is not shippable.

## Decision

Two pieces ship today:

- **Inactive-by-default emission** (`aggregate.yml` gains `"inactive": true` on the external row; `scripts/aggregate.mjs` renders a trailing `disabled: true` override after EVERY artifact of that external — harness patch row plus all namespaced insert rows). The stock jsonl backend keeps serving sessions; the npm bits stay installed; `--check`, tests, and docs updated accordingly.
- **One management tool**, `scripts/dsh-better-session.mjs` (`status` / `migrate` / `enable` / `disable`). The migrator decodes the legacy per-project layout (`<root>/<project>/<segment>/session.jsonl.zstd`, concatenated zstd frames decoded via Node's native zlib zstd APIs) and inserts directly into the RDB store using mirrored DDL, byte-faithful to `@morlay/session-rdb@0.0.11`: drop `assistant/chunk`, `ignorable` events and packed chunk rows; keep upstream seqs as `f_original_seq`; renumber bridges densely; chain event ids; prune surface provenance against dropped seqs; `INSERT OR IGNORE` anchors make reruns converge. It refuses foreign stores (application_id/user_version fingerprint), auto-backs up before writing, defaults to dry-run, and is order-independent ("migrate then enable" recommended but reruns are safe).

Enablement writes a marker-delimited override block (`disabled: false` for the three insert rows; the jsonl row stays disabled) into `$DSH_HOME/profiles/<profile>/cordis.patch.yml`, layered after the bundle patches like any profile patch row.

## Alternatives considered

- **Removing better-session from the aggregate** until upstream provides tooling: rejected - the user-facing capability was approved for ingestion, and bits-included/inactive keeps installs self-contained while the opt-in path matures.
- **Commenting out generated rows**: rejected - first-of-kind pattern in this repo and unreusable programmatically; `disabled: true` overrides ride syntax already proven elsewhere in the same file.
- **Importer routed through the rdb backend code** (`PersistenceCoordinator`): rejected - it would require a running cordis container and importing homebrew-local SDK packages from repo scripts, violating the no-DSH-checkout boundary; direct SQL against mirrored DDL is contract-tested by the synthetic fixtures instead.
- **Migration inside dsh at boot**: rejected - automatic background rewriting of 526 MB of primary session history needs far more safeguards than a maintenance script can offer quietly, and wrong-direction imports (sqlite-created rows meeting a later jsonl tail) get murkier when unattended.

## Consequences

- Fresh upgrades of the family bundle keep their session list exactly as before; enabling becomes a deliberate, documented act with visible trade-offs.
- The store path collision observed during investigation (`dshHomePath('sessions', 'sessions.sqlite')` matching the official query-cache naming) proved benign here: the live database carries the morlay application id, so the fingerprint check pins behavior. If DSH ever activates its own root-level store at the same path, the migrator fails loud instead of corrupting either side.
- Two package-name eras coexist on disk (bare-uuid segments from older writers vs current `session-*` segments); discovery lists both because the official reader does.
- Pinned release-age excludes in `pnpm-workspace.yaml` stay mandatory while 0.0.11 counts as fresh.

## Testing

- `scripts/aggregate.test.mjs`: inactive-expansion test asserts disabled overrides follow every artifact; full suite green alongside regenerated artifacts (`pnpm aggregate:check`, 19 rows / 17 deps).
- `scripts/dsh-better-session.test.mjs` (9 tests): multi-frame splitting, torn-tail flagging, header validation, drop/prune semantics, dims mapping, dense-bridge + head-cursor writes, rerun convergence, managed-block replace/remove, posture detection.
- Real-world dry run: all 481 legacy logs decode with zero failures (bare-uuid era included), reporting per-session persisted/dropped counts without writing anything.
- Opt-in runtime confirmation requires restarting `dsh web` by the user.
