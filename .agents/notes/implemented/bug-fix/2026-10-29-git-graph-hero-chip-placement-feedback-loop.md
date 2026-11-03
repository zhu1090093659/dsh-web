# Agent Note: Git Graph hero chip seat is asserted per commit, not watched

Status: implemented
Superseded by: [the dsh-git-graph package is retired in favour of the official Git changes plugin](../simplification/2026-11-03-git-graph-package-retired.md)

## Problem

With the git-graph plugin enabled, a blank (hero) session froze the DSH desktop renderer: the render process pinned one core at 100%, stopped answering input and clicks, and stopped answering CDP commands until the process was killed. Disabling the plugin made the same session behave normally.

The freeze came from the hero chip placement effect in `packages/dsh-git-graph/src/client/chips/BranchChip.tsx`. It created a `MutationObserver` on the hero row's `childList` and moved the portaled chip back before the row's trailing options group with `insertBefore`. That move is itself a `childList` mutation of the observed row, so the observer re-queued its own callback. The whole cycle ran in microtasks and never returned to the macrotask queue, so the renderer starved.

The observer existed for one reason: React appends portal children last, so a commit can leave the chip at the end of the row instead of in its seat, and the effect's dependency array did not cover every commit that moves it.

## Decision

The chip's seat is asserted once per commit, and the component never writes into a container it observes.

1. **No observer on the mutated row**: the placement effect no longer creates a `MutationObserver` on `heroRow`. A component that writes into an observed container re-queues its own callback, which is the defect this note records.
2. **Assert after every commit**: the placement runs in a `useLayoutEffect` without a dependency array, so it re-asserts the seat after every commit of the chip. React's DOM mutations happen before layout effects, so the seat is restored within the same commit that moved the chip, and a commit that does not move the chip writes nothing.
3. **Idempotent guard**: the write keeps its original guard (the chip is in the row, and the chip already precedes the trailing options group), so a repeated assertion is a no-op.

The hero-row detector effect stays as it was: it observes the composer stack to discover which row to portal into, it never writes into that stack, and it only resolves the row's identity. The plugin's portal placement itself is unchanged and is still owned by the [hero chip portal note](./2026-08-31-git-graph-branch-chip-hero-portal.md).

## Alternatives considered

- **Keep the observer and suppress its own records**: a `MutationObserver` cannot tell at callback time whether a record came from the component's own `insertBefore` or from a foreign change, so the suppression needs a flag that must stay raised across a microtask boundary. A missed flag turns the observer back into the feedback loop, and a wrongly raised one skips a legitimate re-place: the failure modes are both silent.
- **Keep the observer and schedule the re-place in `requestAnimationFrame`**: this moves the write out of the microtask queue, but it keeps an asynchronous write into a container the component does not own, and under continuous row churn the pending frames still accumulate without bound.
- **Keep the observer but observe a narrower target**: the observer has to see the row's own children to notice that the chip left its seat, and the row is exactly the container the component writes into. Narrowing the target removes the signal without removing the write.

## Consequences

- A blank session with the plugin enabled stays responsive: the renderer never enters a self-re-queued microtask loop, and the hero chip keeps its seat beside the agent-preset seat.
- The chip's seat survives the refetch commits that make React append portal children last, because the assertion runs after every commit.
- The component no longer reacts to a hero-row mutation that happens outside a commit of the chip. The seat is re-asserted on the next commit instead, which covers every case React itself produces.
- The [hero chip portal note](./2026-08-31-git-graph-branch-chip-hero-portal.md) recorded the re-ordering as happening on every row child mutation; that wording describes the removed observer, and the mechanism now lives in this note.

## Testing

- `packages/dsh-git-graph/tests/client.spec.tsx` covers both halves of the contract: a hero row mutation does not move the chip (the observer is gone), and the next commit re-asserts the chip's seat.
- The same test file fails against the pre-fix placement effect, so the regression is pinned by the suite rather than by inspection.
