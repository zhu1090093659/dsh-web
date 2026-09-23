# Agent Note: Request-surface tool catalog and LiangShen V4.1 Flash evaluation tooling

Status: implemented

Partially supersedes [minimal persona with an injected tool catalog](../../implemented/feature/2026-09-11-liangshen-minimal-prompt-tool-catalog.md): the catalog indexes the surface the current request opens rather than the full registry, so its text is no longer stable across the presentation boundary. Extends [four-tool anchoring and PTC contract refinement](../../implemented/feature/2026-09-12-liangshen-anchor-tools-and-ptc-refinement.md). Delivers stages 1-4 of [the LiangShen V4.1 Flash improvement plan](../../proposed/feature/2026-09-13-liangshen-v41-flash-improvement-plan.md) and leaves that plan's default-selection stage open. Partially superseded by [the V4.1 Flash native rebuild](2026-09-16-liangshen-v41-flash-native-rebuild.md): the presentation boundary the catalog tracked is gone — the wire keeps one presentation for the whole session, and paged namespaces surface as summaries until activated — while the declare-exactly-what-the-request-opens principle and the evaluation tooling still hold.

## Problem

During the anchor turn the injected tool catalog named every registered tool while the request's own wire exposed only `anchorTools`. The model was told it could call tools the request did not offer, which is a capability declaration it cannot act on. The same contract text also claimed the session's first turn "carries the shell alone", which stopped being true when the shipped default anchor set became four tools. Separately, nothing in the repository could isolate whether the persona, the anchor turn, or the PTC presentation caused a change in task success, and there was no bounded budget mechanism for such a comparison.

## Decision

`presets/liangshen/tool-catalog.mjs` declares what the request actually opens, and the package carries the bounded evaluation tooling the plan requires.

- Native presentation builds its entries from the request's own wire: the anchor narrowing during the anchor turn, the assembled native roster after a declined or disabled PTC. `mergeProjectedSchemas` overlays the registry projection's fuller schema on those entries by name, so a thinner wire definition does not drop complete argument semantics.
- PTC presentation builds its entries from the registry projection, the SDK-reachable roster, and the program contract states that `run_code` is the only directly callable tool while every listed tool is reached from inside the program. The stale first-turn-shell sentence is removed.
- `catalogStateFor` resolves the catalog from the current presentation state at the pre-step, so the promoted turn's first step already describes the promoted surface instead of the anchor assembly's stored state.
- Fallback, revert, compaction recovery, resume, and deduplication keep their previous behavior.
- `tools/benchmark-live-run.mjs` runs the candidate matrix in isolated preset copies: `B` (shipped persona and two-stage strategy), `P` (candidate persona), `T` (candidate persona, PTC from the first turn), `N` (candidate persona, full native roster throughout), `M` (the bundle's official Minimal preset, an external reference). It records a baseline (repository commit, shipped preset hash, variant preset hash, DSH version, fixed route, task revision, limits), seeds a task workspace, grades a task through a Node acceptance check, keeps style metrics out of the outcome record, and stops at the session or cost limit rather than expanding. It interleaves the groups inside each task so a truncated run still leaves every group represented, and it refuses a budget it cannot price rather than letting an unpriceable gate never trigger.
- `tools/benchmark-report.mjs` aggregates the records into per-group success rates with Wilson intervals, paired per-task deltas with confidence intervals, token and cost totals, and separately reported infrastructure failures. A task timeout counts as a task failure and is reported in its own column; only a request-free or ungraded run is treated as infrastructure. The report reads only the suite index own records and rejects a directory whose runs disagree on the baseline. `tools/tasks/liangshen-v41-flash.json` is the seed corpus covering code repair, first-turn specialized tools, multi-turn edits, failure recovery, and workspace-instruction compliance.
- The shipped default stays four anchor tools plus PTC. No live comparison has been run, and the plan's rule is to land the contract fix and keep the current strategy while the evidence cannot rule out regression.

## Testing

- `tests/tool-catalog.test.ts` pins the request-surface contract: the anchor turn lists exactly the anchor wire for every step of the first turn, the promoted turn's first step already describes the promoted surface before its own assembly, the PTC contract names `run_code` as the only directly callable tool and no longer claims a shell-only first turn, and a resumed session and a hostile projection fall back without advertising PTC.
- `tests/benchmark-live-run.test.ts` pins the variant rewrites (shipped default, candidate persona, empty anchors, PTC off, official Minimal), validates every derived composition against the repository's preset schema, checks the persona block-scalar edit stops at the next composition row, reads the durable session shapes, sums usage without double counting, fails every seed task on its initial workspace so no task passes without model work, refuses a budget whose price table has missing or unusable rates, and keeps a task timeout out of the infrastructure bucket.
- `tests/benchmark-report.test.ts` pins the aggregation: Wilson bounds, the paired-by-task mean delta with its interval, a task timeout counting as a failure while infrastructure failures stay out of the denominator, the suite index excluding a reused directory's stale records, a baseline mismatch being rejected, a single paired task leaving its interval unestimable, and the treatment notes the report must carry.

## Alternatives considered

Listing registry tools during the anchor turn and keeping the catalog text stable across the boundary is rejected: it announces a surface the request does not open, and the earlier stability claim was only defensible while the list did not describe the wire.

Deriving native entries from the wire alone, without the projection overlay, is rejected: an assembly whose tool objects carry thinner definitions would silently lose the complete argument semantics the catalog exists to deliver.

Registering a separate public preset per experiment group is rejected: isolated preset copies expressed through the existing `anchorTools` and `ptcPresentation` fields cover the matrix without adding user-visible presets or registry changes.

Running the live A/B in this change is deferred rather than rejected: the plan requires a cost budget derived from smoke measurements before paid sessions, and no such budget has been authorized.

Changing the default to PTC-from-the-first-turn or to the full native roster now is rejected: the evidence cannot rule out regression, and the plan's stated rule keeps the current strategy in that case.

## Consequences

- The catalog and the request can no longer disagree about which tools exist; the promotion boundary now republishes the catalog once, which is a deliberate context change the previous design avoided at the cost of a false declaration.
- The candidate matrix, the baseline record, and the aggregation are ready, and no paid session has been spent: the default is unchanged and the plan remains proposed until a run supplies evidence.
- `packages/dsh-liangshen` changed its plugin source, so a running DSH host must be restarted for the new catalog behavior to take effect; the preset composition itself keeps its structure and config keys.
