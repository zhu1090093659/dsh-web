# Agent Note: Git Graph branch chip portals into hero workspace row

Status: implemented

## Problem

In blank sessions, the Git branch selector (`BranchChip`) detached and floated high above the conversation area / hero whale illustration rather than sitting in the row alongside `WorkspaceChip` and `AgentPresetSeat`.

The root cause was that `BranchChip` calculated `top = rowRect.top - stackRect.top + ...` (coordinates relative to `div.wSkVaW_composerStack`) and applied `position: absolute; left: ${left}px; top: ${top}px` (`css.anchorHero`). However, `composerStack` and `heroWorkspaceRow` are `position: static` flex containers without an established containing block; the nearest positioned ancestor establishing a containing block was `div.wSkVaW_body` at the top of the conversation view (`y = 0`). As a result, calculating coordinates relative to `composerStack` (centered vertically) but positioning relative to `body` caused the chip to jump hundreds of pixels above the composer card and hero row.

## Decision

Instead of computing coordinate math with `getBoundingClientRect`, animation frame schedulers, and `position: absolute`, `BranchChip` now portals directly into `heroWorkspaceRow` via React `createPortal` when `heroSeat` is active.

1. **DOM target resolution**: `findHeroRow(anchor)` resolves the connected element matching `.heroWorkspaceRow` (either `outlet.previousElementSibling` or inside `composerStack`).
2. **Portaling**: When `heroSeat` is active and `heroRow` is resolved, `createPortal(chipNode, heroRow)` renders the chip directly into the official `heroWorkspaceRow` flex container. A hidden zero-dimension placeholder remains in `conversation.input.dock`.
3. **Flex flow**: `.anchorHero` uses `display: inline-flex; align-items: center;` without `position: absolute;`. The chip participates naturally as a native flex child of `heroWorkspaceRow`, inheriting the official 2px gap, vertical alignment, and responsive flow with no coordinate calculations or resize observers.
4. **Lifecycle & cleanup**: When the session leaves the hero state (e.g. sending a message or navigating to an active session), `BranchChip` unmounts and removes the portaled node cleanly.

## Alternatives considered

- **Calculate coordinates against `anchor.offsetParent`**: Fragile across scrolling, viewport resizes, dynamic composer loading, and varying parent containing block styles across skins.
- **Translate transform on dock container**: Dock outlet sits below the hero row, so negative transforms break flex boundaries and create collision risks with composer card elements.

## Consequences

- The Git branch chip is aligned inline with the workspace chip and agent preset chip with exact native spacing and alignment in blank sessions.
- Eliminates animation frames, `ResizeObserver` loops, and coordinate math.
- The client bundle was rebuilt for `@linxin666/dsh-client-ui-git-graph`.

## Testing

- Unit tests in `packages/dsh-git-graph/tests/client.spec.tsx` updated and all 10 test files (145 tests) in `dsh-git-graph` pass.
- Repository-wide `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, and `pnpm i18n:check` pass.
