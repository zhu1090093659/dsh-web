# Agent Note: Restoring foundational anchor tools and refining PTC semantics in LiangShen mode

Status: implemented

Partially supersedes [a shell-only anchor and PTC promotion](2026-09-12-liangshen-shell-anchor-and-ptc-handoff.md): default `anchorTools` is restored to `[bash, str_replace_editor, exit_plan_mode, skill]` while preserving bash-only as a configuration experiment, the anchor turn covers the entire first user turn rather than a single request, PTC is claimed active only on actual presentation success, the injected SDK retains complete input and output key parameter semantics rather than an oversimplified 200-character-only contract, and overcommitments regarding "exact Minimal match", community benchmark superiority, and "cache equals behavior" are retracted. Partially supersedes [lifting the AGENTS.md instructions into the system prompt](2026-09-12-liangshen-agents-md-in-system-prompt.md) on dynamic instruction scope: notes upcoming support for registered file tools (including `str_replace_editor`) and PTC internal calls. Cross-links [staging the Standard catalog behind the anchor turn](2026-09-11-liangshen-anchor-turn-staging.md) and [minimal persona plus an injected standard tool catalog](2026-09-11-liangshen-minimal-prompt-tool-catalog.md). Extended by [the request-surface tool catalog](2026-09-13-liangshen-request-surface-catalog-and-eval-tooling.md): the native catalog lists the request's own wire while PTC keeps the SDK-reachable roster, and the package gains the bounded evaluation matrix. Partially superseded by [the V4.1 Flash native rebuild](2026-09-16-liangshen-v41-flash-native-rebuild.md): `anchorTools` first-turn narrowing is removed (setting it warns) and `ptcPresentation` is replaced by the three-value `presentation` key whose default `both` keeps the full native roster with a co-resident `run_code`; the honest activation semantics, the request-surface catalog contract, and the three-tier validation standard still hold.

## Problem

The previous shell-only anchor design (`anchorTools: [bash]`) over-narrowed the session's first turn. In multi-step initial interactions requiring file inspection or editing, plan exit, or skill lookup, the model lacked native schemas on the wire for `str_replace_editor`, `exit_plan_mode`, and `skill`. While execution against registered names still resolved, the absence of schemas on the wire increased first-turn friction.

Furthermore, several architectural and documentation overcommitments accumulated:
1. Conflating the entire first user turn with a single "first request", mischaracterizing multi-step initial turn interactions.
2. Claiming PTC mode active unconditionally from turn two, even when the code runtime was missing or declaration failed.
3. Describing the SDK catalog as a rigid 200-character-only contract, obscuring that the SDK projection preserves complete input and output parameter types and execution semantics.
4. Making unsubstantiated claims: claiming exact identity with the official Minimal preset despite shipping custom working discipline and workspace instructions, citing community benchmark scores to assert universal superiority, and equating prompt cache hits with behavioral identity.
5. Inadequately delineating the security model between host filesystem sandbox enforcement and Windows Git Bash limitations (subprocess without OS namespace sandbox, non-persistent shell state).
6. Conflating minimal inference probes with mode integration passes and statistical performance improvements.

## Decision

The LiangShen mode restores foundational native capabilities to the anchor turn, establishes accurate PTC activation and SDK semantic boundaries, and aligns security and verification criteria.

- `presets/liangshen/agent.cordis.yml` restores the default `anchorTools` to `[bash, str_replace_editor, exit_plan_mode, skill]`. The bash-only configuration experiment (`anchorTools: [bash]`) is preserved and supported via configuration without requiring extra preset registration or registry changes.
- The anchor turn boundary is explicitly defined over the entire first user turn (fewer than two `turn/start` events in the durable log), ensuring all steps within the initial user turn reliably access the foundational anchor schemas.
- PTC presentation is claimed active only upon actual runtime success (`agent.ctx.tools.presentAs('ptc')`, a mounted code runtime, and a readable tool projection). When any of those is missing the session keeps the native roster with a single warning: declaring without a readable projection would collapse the executor and then have to undo it, losing the native wire on the way out.
- The injected catalog describes the transport the request's OWN wire carries, not what the configuration intends: the PTC program contract appears only when `run_code` is actually on that wire. When a declaration cannot reach the assembly in flight (for example, a deployment with no re-entrant assembly entry point), the plugin reverts it so executor, wire, and catalog agree, instead of announcing a transport the request never names.
- The injected tool catalog preserves complete input and output key parameter semantics from the registry's SDK projection. The `descriptionMaxLength: 200` config applies solely to the single-line summary string, never truncating parameter schemas or execution contracts. One contract update across the presentation boundary is explicitly permitted without insisting on absolute context immutability.
- Subdirectory dynamic rules support directories reached by registered file tools (including `str_replace_editor`) and sub-calls within PTC; arbitrary bash/program code is not parsed, and automatic discovery of file accesses performed directly within shell commands is not guaranteed.
- Workspace instructions count as redundant only when their content really reached the system prompt: when the baseline read fails or yields nothing, the host's `agent-instructions` message passes through untouched rather than being dropped for lacking a `source.baseline` marker. Only a covered baseline that carries the marker is condensed into a reminder; only an unmarked duplicate of covered content is dropped.
- Documentation removes overpromises: claims of exact Minimal equivalence, community benchmark superiority assertions, and "cache equals behavior" equations are retracted.
- The security model explicitly states host filesystem sandbox boundaries and Windows Git Bash realities (unconfined subprocess, non-persistent state, no custom-bash modification).
- Verification defines a three-tier distinction: real inference probe != mode integration pass != statistical improvement.

## Testing

- `tests/preset-composition.test.ts` verifies that the shipped `agent.cordis.yml` defines `anchorTools: [bash, str_replace_editor, exit_plan_mode, skill]`, passes structural validation, and supports the bash-only configuration experiment (`anchorTools: [bash]`) without registry modifications.
- Tests in `tests/tool-catalog.test.ts` and `tests/minimal-prompt.test.ts` validate turn boundary tracking, signature rendering, graceful degradation, and workspace instruction budgeting.
- `tests/tool-catalog.test.ts` pins two invariants: the catalog never announces PTC for an assembly the declaration could not reach (the previous predicate was a tautology that reported one there), and a projection breaking mid-session reverts the declaration and restores the native wire. The harness models the real thing accordingly -- the wire follows the presentation the agent had when the assembly started, and a re-assembly reuses the caller's inputs -- so the promotion re-assembly path itself is covered.
- `tests/minimal-prompt.test.ts` pins the redundancy rule: a covered, marked baseline is condensed into a reminder that keeps `baselineIdentity`, an unmarked duplicate is dropped, and a message is never dropped when the baseline did not load.
- Verification criteria require distinguishing headless minimal inference probes from full integration passes and statistical multi-round benchmarks.

## Alternatives considered

- Retain bash-only as the shipped default. Rejected: complex first-turn tasks require native editing, plan exit, and skill retrieval schemas on the wire to minimize failure rates.
- Register a separate preset for the four-tool anchor. Rejected: unnecessary preset proliferation; the existing `anchorTools` config option allows seamless switching between default four-tool and experimental bash-only anchors without registry pollution.
- Insist on byte-identical context across the PTC promotion boundary. Rejected: allowing one contract update when transitioning from native to PTC mode provides accurate SDK semantics without harming session coherence.
- Parse arbitrary shell scripts for dynamic subdirectory AGENTS.md discovery. Rejected: static analysis of arbitrary bash commands is undecidable and fragile; discovery is scoped to registered file tools and PTC internal file invocations.

## Consequences

- First user turns natively carry the core tools (`bash`, `str_replace_editor`, `exit_plan_mode`, `skill`), reducing tool invocation friction during initial steps.
- PTC mode activates only when genuinely operational, ensuring robust degradation on deployments lacking a code runtime.
- SDK signatures and parameter semantics remain actionable and complete within TypeScript programs.
- Real-world evaluation and benchmarking are anchored on rigorous metrics (completion rate, tool errors, rule adherence, human interventions, token/time costs) rather than superficial probe successes or cache hits.
