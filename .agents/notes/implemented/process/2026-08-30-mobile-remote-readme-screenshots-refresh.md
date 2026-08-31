# Agent Note: root README mobile remote screenshots refreshed to the adapted official UI

Status: implemented

## Problem

The root README mobile remote section still carried the four screenshots of the retired standalone /m surface (20-mobile-workspaces / 21-mobile-sessions / 22-mobile-chat / 23-mobile-model-sheet) and described the phone as landing on a standalone mobile surface. After the rebuild ([`remote-control-reuses-official-ui`](../../architecture/2026-08-29-remote-control-reuses-official-ui.md)) the phone runs the official Web GUI with the injected portrait-touch adaptation, so the README misrepresented the shipped behavior.

## Decision

- The section now leads with the composite illustration `docs/assets/phone-and-web.png` (desktop GUI with the phone surface overlaid) supplied by the product owner, before the four retaken mobile screenshots.
- The four mobile screenshots were retaken against the live GUI (127.0.0.1:3080, no service restart) in a touch-emulated 390x844 @2x viewport; the adaptation layer was verified active before shooting (body`.dsh-remote-portrait`, whale button `#dshRemoteWhale`, compact picker, desktop plugin surfaces suppressed).
- New set: `20-mobile-home.png` (whale entry + official hero + composer), `21-mobile-sessions.png` (whale-opened sidebar: workspaces + sessions), `22-mobile-chat.png` (official markdown with thinking and tool-call blocks), `23-mobile-model-sheet.png` (model picker as bottom sheet). `20-mobile-workspaces.png` is removed.
- Root README pair wording updated to the current state: the phone runs the official Web GUI itself with the portrait-touch adaptation (whale sidebar entry, swipe gestures, long-press menus, Enter-newline, 16px inputs; desktop tool surfaces hidden) - one UI, one state with the desktop. The English mirror and the screenshot table captions were updated in the same change.
- Capture method: headless Chromium (Playwright, repo devDependency) with the browser-session cookie for the 127.0.0.1:3080 authority read from the running Chrome, so the user's visible Chrome was never resized or navigated; the ephemeral scripts live under git-ignored `test-results/shots/` and are not part of the change.

## Alternatives considered

- Emulate the phone viewport directly in the user's visible Chrome via browser-use CDP: rejected - device-metrics override would visually distort the user's browser, and the single-dump cookie approach works without touching it.
- Show the desktop pairing panel / QR instead of the mobile shots: kept out - the section keeps its four mobile shots, and the pairing flow is already described in the plugin README, which owns that detail.

## Consequences

- The shots reflect the shipped adapted official UI; the next official-client visual churn can stale them again, and the capture was one-off (no committed recapture script yet).
- `docs/screenshots/21/22/23` keep their filenames while `20` was renamed from workspaces to home; no other repository reference to the removed file remains (marketing DESIGN.md under the git-ignored promo folder is not updated).
