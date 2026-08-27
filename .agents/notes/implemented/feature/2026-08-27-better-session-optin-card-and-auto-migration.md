# Agent Note: better-session opt-in ships inside the perf settings card with automatic migration

Status: implemented

Supersession check: [better-session-default-off-and-jsonl-import](2026-08-27-better-session-default-off-and-jsonl-import.md) owns the inactive-by-default rollout and the migration semantics; nothing there changes. This Note adds the user-facing surface for that decision — the opt-in section — and moves the import core into a package so that surface and the CLI share one implementation.

## Problem

The opt-in path shipped as documentation plus a repository-only CLI: a user who installed the family bundle from npm had to hand-edit the profile patch file (with hand-rolled YAML) and could not migrate legacy sessions at all without a repository checkout. The switch also carried its storage-switch warnings only in README prose, far from the moment of decision.

## Decision

The switch ships inside `@linxin666/dsh-perf` — better-session itself is session-performance governance, so its management surface rides the perf package instead of a new family member — putting it where the decision happens:

- **Section, not a sibling card**: the surface renders *inside* the 性能引擎 card (perf's own `web-ui.plugin.item` entry), below the form fields behind a divider. An earlier same-day draft had registered a second group item (slot id `better-session`, order 145); live GUI review showed it landing as an unstyled sibling next to dsh-perf instead of the requested second-level placement, so the separate registration was removed and `BetterSessionCard` mounts from `PerfSettingsCard`. It keeps declaring the third-party origin on-surface ([morlay/better-session](https://github.com/morlay/better-session), MIT), shows both stores' live counts and the current posture, and gates enable/disable behind explicit confirm dialogs whose copy names every consequence from the README's trade-off list. Copy registers into the shared `dsh-perf` locale namespace under `bsm.`-prefixed keys (no namespace of its own) and styling is self-contained inline CSS.
- **Enable flow**: confirm → child-process import of all legacy jsonl logs into `sessions.sqlite` (existing store auto-backed-up; store bootstraps when absent) → managed-block write to the profile patch. Import failure leaves the profile untouched. The profile layer hot-reloads on long-lived hosts, so enabling applies live; open tabs refresh once.
- **Shared core**: decode/projection/store code moved verbatim into the package (`src/bsm/*`, compiled also to standalone `lib/better-session-import.mjs`). The host half spawns it so decoding never blocks the server event loop; `scripts/dsh-better-session.mjs` became a thin shell importing the same artifact — semantics now exist in exactly one place.

No settings namespace exists: the card has no saved preferences, and the state that actually matters (patch rows) lives in the profile file, which both surfaces treat as the single source of truth.

## Alternatives considered

- **A settings namespace toggling `enabled`** like dsh-ssh: rejected - upstream rows honor loader-level disabled flags, not config payloads; flipping a settings value would desync from what the composition actually runs.
- **Riding dsh-plugin-manager's enable/disable routes directly**: rejected - plugin-manager edits arbitrary entries through per-plugin bundling facts; better-session needs the coordinated three-row block plus the permanent jsonl disable, which is this package's contract.
- **Migrating automatically at boot when enabled**: rejected - by then the RDB provider owns the store in-process; racing a bulk import against the first active session is undefined-order work with no clean rollback, versus doing it at confirm time when stock persistence still serves.
- **Keeping the importer in scripts/ only** and having the host shell out to the repo path: rejected - npm installs have no checkout; duplication would drift immediately.

## Consequences

- Opt-in no longer requires a repository checkout: the full path (declarations, warnings, migration, switch) ships inside the aggregate bundle.
- No new package joins the cohort, and no new Web 插件 group item either: the surface lives inside the perf card, so it appears/disappears with perf and inherits its collapsible chrome.
- The section's posture readout depends on seeing the aggregate artifact text; an npm-profile install reachable outside any checkout still resolves through DSH_WEB_AGGREGATE_PATCH or the cwd walk-up, otherwise it reports "posture unknown" instead of guessing.

## Testing

- Package vitest suite (54 tests): codec/torn tails/header validation, drop/prune/dims mirroring, dense bridges + head cursor + idempotent reruns on real fixture layouts (bare-uuid era included), managed-block replace/remove, posture classification across layering permutations — plus three renderToString specs pinning the nested DOM contract (dsh-perf-owned section, `bsm.`-prefixed copy keys, action set flipping with the mount posture, confirm dialog markup).
- CLI node:test suite (4): argv contract, reminder-gated enable writing through the real `$DSH_HOME` profile path, status JSON shape with the shipped inactive posture, and a migrate dry-run over a synthetic zstd log that asserts nothing is written — added after a live migration audit caught the CLI calling bare `runImport` (ReferenceError on every migrate invocation) and backing up only after the mutating pass; the binding and the backup-before-write order are now pinned by that case.
- Regenerated aggregate artifacts (19 rows / 17 deps) verified by `pnpm aggregate:check`; dump-config shows exactly three better-session insert rows plus their disabled overrides and no separate card entry.
