# Agent Note: Remote reopen dead-ended on the harness browser-auth 401

Status: implemented

## Problem

After pairing a phone through the QR (tunnel or LAN), a later reopen of the remote surface from the phone — history, bookmark, tab restore — landed on the harness's plain-text 401 page ("dsh web authentication required; reopen the URL printed by dsh web."), sometimes accompanied by Safari downloading the response as `pair-app.txt`. The pairing itself was fine; the reopen path was structurally broken.

Four facts compose the defect:

1. The app-shell capture script `history.replaceState`s the address bar to `/`, so every durable entry point records a path the plugin does not own.
2. `/` is served by the harness `frontend-static` fallback seat, which forces `authorizeIndex()` (the harness browser-auth check) on every index/SPA-fallback document request.
3. The cookieless mobile flow ([remote control reuses the official UI](../architecture/2026-08-29-remote-control-reuses-official-ui.md)) never gives the phone a harness browser-auth cookie — by design: minting one would let the official SPA call `/api` directly past the connection fence, bypassing the pairing gate on a cohort where nothing emits `api/gate`, and 停止 would lose real teeth.
4. Secondary: paired sessions were idle-evicted after 7 days, so even a saved `/pair-app?device=` link or a re-tapped QR link (which falls back to the device cookie) died after a week of disuse.

Verified live on the running auto tunnel: `GET /` answered the harness 401 text verbatim while `/pair-app` with a bogus device answered the plugin's bilingual failure page — the plugin routes were alive; the reopen simply never reached them.

## Decision

The app shell now registers a **reopen service worker** served by the plugin:

- New exact route `/pair-app.sw.js` (`PAIR_PATHS.appServiceWorker`), registered alongside `/pair-app` (same `indexDocument` condition), behind the same phone-facing fence, no rate limit, `cache-control: no-store`, `service-worker-allowed: /`. The path is root-level so its default script-directory scope already covers `/`.
- The capture script (`appShellCaptureScript`) registers the worker in the same breath that it stores the device id and replaceStates to `/`.
- Worker behavior: intercepts **GET navigations to `/` only**. Network-first: re-fetch `/pair-app` with same-origin credentials — a live pairing gets the current shell and its `lastSeenAt` refreshed (every reopen extends the session); a refused response passes the original navigation through (once the plugin is gone, the harness answers honestly); a network failure falls back to the cached shell (`dsh-remote-shell-v1` in CacheStorage), so a brief offline open still boots the app. Install warms the cache; activate prunes foreign caches and claims clients.
- `pairingFailurePage` (served at `/` by the worker when the pairing no longer passes) now covers both entries — dead link at `/pair-accept`, expired session at `/` — and states that re-pairing restores access.
- `DEFAULT_IDLE_EXPIRE_MS` 7 → 30 days: the worker's presence refresh means the window runs out only through genuine disuse, and 30 days matches the browser-credential lifetimes the surrounding flow was built around. `idleExpireMs` config already exists for per-deployment override.
- Secure contexts only: plain-HTTP LAN origins never register the worker (no service workers off https/localhost); a LAN reopen means scanning a fresh QR. Documented in both READMEs as a known limitation.

## Alternatives considered

- **Keep the address bar on a plugin-owned path** (drop the replaceState to `/`). Rejected: the replaceState exists to leave the official SPA at its canonical root, and leaving `/pair-app?device=` in the address bar persists the live device credential into browser history and sync backups — a worse trade than the worker, with an untested SPA-path compatibility pass on top.
- **Mint a harness browser-auth cookie for the paired phone** (the plugin can redeem a launch token for any authority). Rejected on architecture: with that cookie the official SPA calls `/api` directly, passes the connection fence, and bypasses the pairing gate — on this cohort nothing emits `api/gate`, so 停止 would stop cutting devices off. This is precisely what the cookieless design avoids.
- **Intercept deep SPA paths too**, not just `/`. Rejected: the SPA always lives at `/` (replaceState), so deep-path entries do not occur in practice; surgical interception keeps the blast radius on the official UI minimal.
- **Document "re-scan when it breaks" only.** Rejected: reopening from the phone is the feature's main mobile path; a deterministic 401 on every tab restore is a defect, not a limitation.

## Consequences

- Tunnel (https) phones reopen straight into the app while the pairing lives; revocation still bites because the worker's network-first check hits `/pair-app` — a revoked device sees the bilingual re-scan page served at `/`.
- Each reopen adds two small same-origin requests (the worker update check and the `/pair-app` shell refresh), both fenced and rate-limit-free by design.
- Plain-HTTP LAN reopens still hit the harness 401 and need a re-scan (cheap in-network); documented.
- If the plugin is disabled or removed, the stale worker passes navigations through to the harness — the same dead end as before, no new failure mode.
- The 30-day idle default applies to new deployments and existing ones alike (the constant feeds the schema default); deployments pinning `idleExpireMs` in the profile patch are unaffected.

## Testing

- `tests/routes.spec.ts`: `/pair-app.sw.js` served with `text/javascript`, `no-store`, `service-worker-allowed: /`; foreign authority 403; absent without an index provider; the patched shell registers the worker; failure-page wording assertions updated.
- `tests/app-sw.spec.ts` (new): decision matrix over a mocked worker scope — handler registration, non-navigate/non-root requests ignored, network-first serve and cache refresh, refusal pass-through, offline cache fallback, empty-cache pass-through, foreign-cache pruning, root-level script path.
- Package suite 306 tests green; repository `pnpm typecheck`, `pnpm test`, `pnpm docs:check` pass; package `tsdown` build clean.
