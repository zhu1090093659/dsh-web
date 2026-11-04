# Agent Note: Git Graph branch chip mounts only on the composer input dock

Status: implemented
Superseded by: [the dsh-git-graph package is retired in favour of the official Git changes plugin](../simplification/2026-11-03-git-graph-package-retired.md)

## Problem

The branch chip carried two mount seats: a preferred `conversation.input.selector.context` wait with a 2000 ms `CONTEXT_FALLBACK_MS` window, and a `conversation.input.dock` fallback. The preferred hole was declared by older shells only; the shipped 0.2.1-rc.2 shell declares `conversation.input.dock / left / right / plan / permission / attachments / activity / model / overlay / for` and no selector-context hole at all, so every run spent the fallback window parked on a wait that could never resolve, and the chip's real seat was always the dock.

## Decision

The branch chip mounts on `conversation.input.dock` only. `apply()` waits for that declaration through `slots.inject` (a bare `register` throws on undeclared slots), registers the single `git-graph` entry (order 100), and the fallback timer, `CONTEXT_FALLBACK_MS`, the locally declared `conversation.input.selector.context` SlotMap entry, and the two-seat props union are gone. `BranchChipProps` is the dock seat's runtime share plus the inject face and the locale seat.

In the blank-session hero phase the chip still portals into the official hero row and takes its place before the row's trailing options group (see [the hero-portal note](../bug-fix/2026-08-31-git-graph-branch-chip-hero-portal.md)); the dock remains the mount seat and the chip is the only occupant it adds.

## Alternatives considered

- **Keep the declaration-aware preference**: it costs a 2 s wait on every load and depends on a hole no shipped shell declares, so a future shell re-adding it would still not change the visible seat without new placement work.
- **Register eagerly on the dock without `inject`**: the SDK rejects registration into an undeclared slot, so a shell that declares the dock late would lose the chip entirely.

## Consequences

- The chip mounts as soon as the shell declares the dock instead of after a fixed window.
- One seat means no double-mount hazard: there is no wait to dispose and no late declaration to ignore.
- A shell that removed `conversation.input.dock` would render no branch chip; that seam is the composer dock the shell declares for its own queue and todo docks.

## Testing

- `packages/dsh-git-graph/tests/client-apply.spec.tsx` covers the immediate dock registration, the deferred declaration, and the single-seat guarantee.
- `packages/dsh-git-graph/tests/client.spec.tsx` builds dock props only; the context-seat cases were removed.
- Repository gates: `pnpm typecheck`, `pnpm test`, `pnpm test:standards`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm libs:check`.
