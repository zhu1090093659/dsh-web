# Agent Note: Remote Desktop Fence Manual Pair Token Input

Status: implemented

## Problem

When users access the desktop / tablet Web UI directly via root domain (e.g., `http://dsh.test/` or a standalone PWA bookmark on iPad), an unpaired device was blocked by `FenceNotice.tsx` (*"This device is not paired and cannot reach workspace data"*). Previously, this screen only showed static steps and a retry button without an input field to manually enter or paste a pairing token or link (#1213).

## Decision

1. In `packages/dsh-remote-web-ui/src/client/FenceNotice.tsx`, introduced `extractPairToken(input)` supporting both raw token strings and full URLs containing `?pair=...`.
2. Added a manual pairing form (`fenceForm`, `fenceInputRow`, `fenceInput`, `fencePairButton`, `fenceError`) directly within the fence blocking card.
3. Submitting the token calls `acceptPair(token)`. Upon success, `onRetry()` is invoked to refresh the page into the authenticated workspace; on failure, tailored error messages (invalid/expired, used, or network failure) are displayed.
4. Added localized strings to `packages/dsh-remote-web-ui/src/client/locales.ts` and responsive styles to `remote.module.css`.
5. Added automated unit tests in `packages/dsh-remote-web-ui/tests/fence-notice.spec.tsx` covering token extraction, successful authorization, and error handling.

## Consequences

Users on tablets (such as iPad PWA home-screen shortcuts) or remote desktop browsers can now directly paste pairing tokens or links on the blocking screen to complete authorization without needing secondary link routing.

## Testing

`pnpm --filter @linxin666/dsh-remote-web-ui test` (397 passed), `pnpm typecheck`, and `pnpm test`.
