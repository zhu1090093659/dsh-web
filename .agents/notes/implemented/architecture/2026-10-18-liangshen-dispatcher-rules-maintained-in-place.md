# Agent Note: The LiangShen dispatcher rules are maintained here, in place

Status: implemented

Extends [the dispatcher identity](2026-10-10-liangshen-dispatcher-identity.md) and supersedes that note's appendix-only editing rule; it pairs with [the behaviour probes](../testing/2026-10-18-liangshen-behaviour-probes.md), which is how a rule change is now measured.

## Problem

The dispatcher block arrived as a verbatim copy of a third-party preset's persona prefix, and the rule that kept it honest was "append, never fold in": local additions went into `DISPATCHER_RULES_APPENDIX` so the reference text stayed byte-identical to what was extracted. That rule protects provenance, and it fails at the one job the block has.

A correction is not an addition. When the reference text carries a sentence that is now false, an appendix entry leaves the model holding two rules for one decision, and a session facing two readings of the same rule takes the stricter one and never checks which was meant to win. The block also froze at version 0.24.6 while the upstream lineage moved: by 2026-10-18 the reference text a live deployment assembles had gained a per-turn backlog sweep, caps written as caps instead of ranges, a brief-limit section with units and accumulation, an escape for an ambiguous limit, and a rule that a defect found in review is routed instead of merely recorded. The frozen copy carried none of them, and nothing in the repository could notice, because the only sync mechanism was a maintainer re-reading an npm package by hand.

Two of the frozen sentences were not merely stale but wrong in a way that changes behaviour:

- R2 asserted that a mounted `list_subagent_models` and the exposure of provider/model/reasoning_effort "always appear or disappear together, so this single signal is sufficient". The tool row and its parameters are mounted statically, so their presence says nothing about whether the session recorded an allowlist. The three real states are listed, unlisted (nothing enforced), and unmounted.
- R8 then used that reading as a fallback ground: "the allowlist is empty and the user has not enabled it" was a licence to stop delegating. In the unlisted state that is the opposite of the truth — delegation works and nothing is enforced — so the rule produced a self-imposed limitation and a silent downgrade to solo execution, out of a premise nobody had verified.

## Decision

The block is a fork maintained in this repository. Corrections are applied in place; additions stay in the appendix.

- `DISPATCHER_RULES` was re-extracted on 2026-10-18 from the lineage the origin package publishes (the coordinator rule set a live DSH deployment assembles), and re-synced on 2026-11-02 against that package at 0.55.0. It now carries R0.5, R0, R-G, R1 `through` R9, R-W, and twenty-five anti-patterns.
- The 2026-11-02 re-sync added the two upstream changes that reached this block: R9 (the plan pipeline, adapted: plan mode is the user's switch, so the block plans inside that mode when the user has turned it on and plans-then-executes otherwise, without ever asking the user for the mode—this deployment mounts no `enter_plan_mode` row, and the upstream entry prompt was deliberately not carried over) and the rule set that shipped with the dispatch execution guard — the standing subagent contract, the report protocol, the coordinator-only tool list, the impact-not-effort stop, the compact delta brief, the non-penalized hand_back, the UI Before/After evidence gate, the clause deletion test, and anti-patterns 21 through 25. The enforcement half of that pair is [the dispatch execution guard](2026-11-02-liangshen-dispatch-execution-guard.md).
- Upstream rewrote its own persona prefix into a shorter form in the same commit (`a1e31bf`), one decision sentence per rule with the justification prose gone. This block adopts that register without adopting upstream's text: the two halves keep their roles, because G7 through G16 hang off the section structure, and every correction and addition this note records survived the pass. The length is a real cost—the block rides on every request—so the sentence, not the argument, is what stays.
- The same pass took the block from 35,447 to about 24,600 characters, roughly 2,700 tokens of per-step resident cost. What remains above upstream's 17,600 is exactly the material upstream does not carry: the local appendix and the R2 fork correction.
- `DISPATCHER_RULES_PROVENANCE` records the origin package, the version inherited, the re-extraction date, the section inventory, every correction folded in place with the superseded sentence, the replacement, and why, and — since the re-sync — every addition with the upstream commit it came from. Corrections and additions are recorded apart because a correction replaces a wrong reading while an addition fills a gap. The record is the freshness contract: a later re-extraction that drops a correction fails `tests/minimal-prompt.test.ts`.
- `tools/check-dispatcher-rules.mjs` is the drift check. When the origin package is installed it compares the two texts sentence by sentence and reports a difference; when it is not installed it says so and exits without failing, because a missing package is not evidence of drift.
- The corrections are the five the provenance record names: R2's three states, R8's withdrawn ground, R6/R7's record-backed run count and per-turn sweep, R0/R5's caps-as-caps with the [Limits] unit rule, and a later R2 fork correction. The fork sentence used to ban the tool outside reviews and promise that a guard rejects an inherited route; neither holds as written. A fork on the parent's own route is the cheapest same-route child (no route line owed, prefix and KV cache kept), and the built-in assertion skips an inherited route because it returns early unless a call names one. Enforcement is layered, so the block now says which layer does what: a host-plane guard may police inherit-only tools and refuse such a fork outright — a refusal its child cannot repair by naming a route — and either way the allowlist check under [State: Listed] is the model's to make. The same correction names the neighbouring fact the design rests on: a delegation tool mounted without route fields is in inherit mode, so an explicit-pair demand on it is a denial no call can satisfy.
- Two appendix entries follow the same principle. G13 now quotes R0's current wording (`at most 2 key questions`) instead of the superseded range, and G16 is new: a pinned fact is an anchor taken when it was registered, so a fact whose subject changed must be re-read before it is planned on and revoked once settled — an out-of-date anchor is worse than no anchor, and the fact register this preset injects is exactly such an anchor. Violation C covers planning on one.

## Alternatives considered

- Keep appending and add a "this supersedes R2" marker to the appendix. Rejected: it is the same two-readings problem with a nicer label, and the model has no reliable way to rank a late appendix entry above the numbered rule it contradicts.
- Re-extract only, with no provenance record. Rejected: the corrections are exactly the parts a future maintainer is most likely to re-derive wrongly, and without a record a re-extraction silently reverts them.
- Keep the block verbatim and hold the origin package as a build input. Rejected for now: it is an npm package with no writable checkout, and pinning a build step to it would make the preset unbuildable offline. The drift script gives the same signal without that coupling.

## Consequences

- The prompt a dispatcher session runs is the current rule set rather than a year-stamped copy, and a wrong rule is fixed where it is read.
- The block is now local text: upstream changes reach it only through a deliberate re-extraction, which the provenance record and the heading-list test both make visible.
- The block grew by about 4 KB at the 2026-10-18 re-extraction and about 6 KB more at the 2026-11-02 re-sync, then was compacted back to about 24.6 KB: the content stayed, the justification prose did not. Length is a cost this mode pays on every request, so the block is now written at its decision content rather than its argument.
- A re-extraction is now a two-file edit (the constants and the provenance record), not a one-file paste.

## Testing

- `packages/dsh-liangshen/tests/minimal-prompt.test.ts` pins the block's last anti-pattern, its fourteen section headings in order, the appendix glossary line, the provenance record, and both directions of each correction: the new sentence is present and the superseded one is gone. The fork correction is pinned by its own test: the cheapest-same-route sentence and the owed allowlist check are present, and the superseded ban and its promised hard rejection are gone.
- `packages/dsh-liangshen/tests/preset-composition.test.ts` pins the persona's convergence bound as the repetition it forbids rather than a turn count.
- `node tools/check-dispatcher-rules.mjs` reports the drift state against an installed origin package.
