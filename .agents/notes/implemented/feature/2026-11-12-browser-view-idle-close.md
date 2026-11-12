# Agent Note: Browser view idle auto-close

Status: implemented

## Problem

A page the browser view opened stays open until something closes it. In isolated mode it lives in a browser only this plugin talks to, so a forgotten page holds a renderer and its memory until the plugin disposes. In real-browser mode the page sits in the person's own window, where an agent-opened tab nobody claimed is exactly the clutter a working session leaves behind. The close contract is explicit on purpose — an implicit close could destroy unsaved work — but "explicit" left the pages DSH itself created with nobody to close them: the session that opened one is usually finished by the time it matters.

## Decision

Tabs carry an idle clock and the host sweeps it. `TabRecord.lastActiveAt` is seeded when a target is attached and refreshed by `TabManager.touch`, which only `BrowserViewService.tabFor` calls after it resolves a tab: any `browser_*` call acting on a page restarts that page's clock, while watching the page in the panel, selecting its chip, and the screencast frames do not count. `TabManager.idleCandidates(maxAgeMs)` returns the tabs whose clock is older than the window and whose `origin` is `created`.

`BrowserViewService.sweepIdle` runs every ten minutes on an unref'd timer that dispose clears, reads the window per sweep, and closes each candidate through the ordinary `closeTab` path, so bindings to the page are dropped, a panel pinned to it falls back to the remaining tabs, and the panel state is broadcast. A host with no browser running sweeps nothing and starts none.

The window is the volatile setting `idleCloseDays`, default 3 days, minimum 0, and 0 disables the sweep. It is read per sweep, so a settings change applies to the next one without remounting the plugin or reconnecting the browser. The clock is memory only: a host restart starts every page's window again at attach time.

Adopted real-browser pages are never candidates. The [real-browser CDP mode](2026-10-29-browser-view-real-cdp-mode.md) decision rejected implicit cleanup of adopted tabs because it can destroy unsaved work; scoping the sweep to `origin === 'created'` keeps that boundary, and an adopted page still closes only when a caller names its tab id.

## Runtime and client contract

`idleCloseDays` joins `realBrowserEnabled` and `cdpEndpoint` in the volatile schema, so the host generates the settings form from it. The Web Extensions card renders it as the shared `ValueField` driven by `numberField('idleCloseDays', { integer: true, min: 0 })`, and the plugin row configuration writes it as a number. Nothing changes on the wire: the sweep is host-side, and the panel only receives the state events `closeTab` already broadcasts.

## Testing

Package tests cover the idle boundary (a page exactly at the window is a candidate, one millisecond short is not), the clock restarting at a touch, an unknown id after a racing close, the created-only scope against an adopted page, and a zero window selecting nothing. Service tests cover the sweep closing only the untouched page, dropping the closed page's binding so the next call opens a fresh tab, a disabled window closing nothing and launching no browser, and a service with no policy leaving a month-old page open. Client tests cover the card writing `0` and flagging a negative draft as invalid, and the row form committing a whole number. Repository gates `typecheck`, the package suite and `i18n:check` pass. No live GUI observation of the new field yet: the running DSH service was not restarted, so the card renders it only after the user restarts the host and reloads the GUI.

## Alternatives considered

**Close adopted real-browser pages too.** Rejected: it reverses the explicit-close boundary of the real-browser decision and would let a timer nobody watched destroy unsaved work in the person's own browser.

**Close only in isolated mode.** Rejected: real-browser mode is where forgotten agent-opened tabs pile up in the window the person actually uses.

**Count panel watching as activity.** Rejected: a viewer left open on one page would keep that page alive forever, which is the opposite of what an idle rule is for.

**Persist the clock to disk.** Rejected for now: it writes page identity into the plugin's own directory, which the package rules forbid, and it needs a migration and a stale-entry policy for a window measured in days. The cost is that a host restart restarts the window.

**A fixed three-day constant.** Rejected: the useful window depends on how the browser is used, and a released constant cannot be widened without a new version.

**Sweep once at startup instead of on a timer.** Rejected: the host runs for days, which is exactly the case where a page opened on day one is still open on day five.

## Consequences

The host now closes pages it created without any tool call. A page somebody only reads in the panel, with no agent work, closes at the window and the panel falls back to the remaining tabs. A session that returns after the window gets a fresh tab instead of the old page, so unsaved state inside a DSH-opened page does not survive the window.

The sweep is the service's only background timer. It must stay unref'd and cleared on dispose so a host process can still exit, and any future source of tabs must report `origin` honestly: `created` is what makes a tab eligible for cleanup.
