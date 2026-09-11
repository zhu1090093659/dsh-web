# Agent Note: mobile whale tap cannot open the sidebar on the current DSH core UI

Status: implemented

## Problem

On the current DSH core UI cohort, tapping the mobile whale (`#dshRemoteWhale`)
did nothing: the sidebar stayed collapsed. `officialSidebarToggle()` resolved
the toggle by walking legacy anchors only — a `[class$="_railFish"] button`
first, then a `[class$="_logoRow"]` with a `button[class*="_toggle"]`. Neither
exists on the current cohort (measured 0 nodes for both), while the real
sidebar toggle is rendered as `.dshp-iconButton.dshp-toggle` (aria-label
打开侧边栏 / Open sidebar) by dsh-better-sidebar/core UI. With the function
returning null, `toggleSidebarVerified()` fell through to the wired layout
face, which mounts inert on this cohort, so the whale tap no-oped. The same
stale selector lived in the bridge null branch in `src/client/index.ts`.

## Decision

Make `officialSidebarToggle()` try the current anchor first:

1. `.dshp-iconButton.dshp-toggle`
2. `[aria-label="打开侧边栏"]:not(#dshRemoteWhale)` /
   `[aria-label="Open sidebar"]:not(#dshRemoteWhale)`
3. then the legacy `_railFish` / `_logoRow` anchors unchanged

The `:not(#dshRemoteWhale)` exclusion is load-bearing: the whale itself
carries the same 打开侧边栏 aria-label, so a bare aria selector would
self-match and recursively click the whale. The bridge null branch in
`src/client/index.ts` got the same selector list. A new unit test covers the
current-cohort DOM (only `.dshp-iconButton.dshp-toggle`, no logo row).

This extends the toggle-first order introduced in
[mobile-remote-tap-and-adaptation-fixes](../../implemented/bug-fix/2026-09-09-mobile-remote-tap-and-adaptation-fixes.md):
that change anchored the official toggle to the logo row only, which no
longer matches the current DSH core UI (see that note's upstream report
[inert-layout-toggle-face](../../proposed/bug-fix/2026-09-09-inert-layout-toggle-face.md)
for the host-side LayoutController that stays inert).

Rejected alternative: dropping the legacy anchors entirely. Older
compositions still ship `_railFish`/`_logoRow`; keeping them preserves
backward compatibility at zero cost.

## Consequences

Whale tap drives the current `.dshp-toggle` button directly; the inert
layout-face fallback is no longer hit on this cohort. Any future DSH core UI
change to the sidebar toggle must re-audit this selector list. Verified by
unit tests (19 pass in mobile-adapt.spec.ts, including the new case) and by
a real-browser check (playwright, 390x844 touch viewport): sidebar width
1px -> 280px on tap and back, `data-sidebar-collapsed` flips true -> null
-> true.
