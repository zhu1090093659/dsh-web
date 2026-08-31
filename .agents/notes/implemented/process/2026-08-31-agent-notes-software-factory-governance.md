# Agent Note: Agent Notes Structure and Software Factory Governance Baseline

Status: implemented

## Problem

As autonomous agent development scales across `dsh-web`, several governance gaps emerged:
1. Decision records had non-standard category folders (`bugfix/`, `docs/`, `enhancement/`) diverging from the closed class set defined in the Agent Notes specification.
2. Unstable prompt prefixes caused frequent KV cache invalidation and increased context costs across agent sessions.
3. Errors in CI or local checks were occasionally addressed with speculative refactoring or unguided retries, risking regression churn.
4. Subagent task dispatch lacked explicit Pareto model tiering, causing high-spec reasoning models to be consumed on mechanical lookups and doc translation.

## Decision

Adopted and upgraded the comprehensive Agent Notes and Software Factory governance baseline:
1. **Directory Structure Normalization**: Migrated legacy notes from `bugfix/`, `docs/`, and `enhancement/` into the standardized closed class set (`bug-fix/`, `process/`, `feature/`).
2. **Prompt Layering and Caching Standard**: Codified a 3-layer architecture separating static global rules (Layer 1) and repository metadata (Layer 2) from dynamic tail context (Layer 3) to maximize KV cache hit rates.
3. **CI Self-Healing Protocol**: Established a mandatory 4-step loop (Log Isolation -> Local Minimal Repro -> Targeted Minimal Diff -> Pre-Push Gate Check) for resolving test and build failures.
4. **Pareto Model Tiering and Anti-Thrashing**: Mandated lightweight models (`flash`/`flash_lite`) for routine read-only research, file discovery, and doc synchronization, reserving `pro` models for architecture planning and deep root-cause analysis. Added a circuit breaker halting execution after 3 failed attempts.
5. **The Evolution Loop**: Defined the progression path from Decision Notes to Reusable Skills to Automated Gates.

## Alternatives considered

- **Ad-hoc note conventions without formal software factory rules**: Rejected because informal rules fail to prevent context bloat, prompt cache churn, and thrashing during autonomous agent operations.
- **Dynamic prompt prefixes with embedded runtime timestamps**: Rejected because dynamic data at the prompt head destroys LLM prefix cache reuse across calls.
- **Open-ended class directories (e.g. allowing `docs`, `enhancement`)**: Rejected because an unbounded classification taxonomy creates directory sprawl and breaks predictable agent lookup heuristics.

## Consequences

- All decision records in `.agents/notes/` strictly conform to the 6 closed classes.
- Agent sessions benefit from standardized prompt layering, cost-effective subagent routing, and disciplined error recovery.
- The evolution loop is formally established to guide future skill and gate creation.
