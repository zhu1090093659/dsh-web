# Agent Note: Bound Inspection and Enforce Active Convergence in LiangShen Mode

Status: implemented

## Problem

In non-Plan mode ordinary sessions, the LiangShen preset's (`dsh-liangshen`) standing working discipline (Thinking Disruption and Action-Oriented) instructs the model to refrain from ungrounded speculation in thought and immediately close thinking to invoke native inspection tools (`read`/`grep`/`bash`) whenever facts are missing.

However, lacking explicit termination and active convergence boundaries, when the model inspects a target file and encounters references to other external modules or symbols, it frequently triggers an uncontained loop: the model constantly treats surrounding details as missing facts and descends further down dependency chains, leading to repeated and seemingly endless file reads unless the user intervenes.

## Decision

Introduce an explicit discipline rule for bounded inspection and active convergence into the Persona `prefix` discipline in `presets/liangshen/agent.cordis.yml`:

```text
- Bounded Inspection & Convergence: Do not traverse dependency chains unbounded. Limit pre-action inspection to immediate target files (at most 2-3 inspection turns). Once core context is understood, immediately converge and begin answering or making edits. Verify edge cases during post-edit testing rather than over-reading upfront.
```

- **Bound inspection depth and scope**: Prohibit unbounded dependency traversal, restricting pre-action inspection to immediate target files (at most 2-3 inspection turns);
- **Enforce active convergence**: Once essential core context is understood, immediately converge to answering or performing code edits;
- **Shift verification to testing**: Adhere to the PDCA loop by deferring edge-case and peripheral fact verification to post-edit testing and execution runs rather than reading extensively upfront.

Synchronously update `LIANGSHEN_GUIDANCE` in `src/index.ts` and pin the discipline assertion in `tests/preset-composition.test.ts`.

## Alternatives considered

- Rely solely on user-prompt defensive guidance. Rejected: the preset should provide sound defaults rather than requiring manual reminders in every conversation.
- Impose programmatic hard limits on tool invocation counts. Rejected: programmatic caps break legitimate large-scale batch tasks and represent invasive runtime restrictions; guiding through Persona discipline aligns with the minimalist philosophy of the LiangShen mode.

## Consequences

- LiangShen mode gains a clear braking mechanism in non-Plan mode, preventing runaway dependency drilling.
- The model converges more decisively into editing or answering once sufficient local context is grasped.
- System prompt length increases slightly by one line, remaining well within the Minimal Persona envelope.

## Testing

- `packages/dsh-liangshen/tests/preset-composition.test.ts` pins the new `Bounded Inspection & Convergence` discipline line.
- `pnpm --filter @linxin666/dsh-liangshen test` passes all 18 test suites and 295 tests.
- Repository build and typecheck (`pnpm build && pnpm typecheck && pnpm libs:check`) verified clean.
