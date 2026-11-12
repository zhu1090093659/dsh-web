# Agent Note: Browser view real-browser CDP mode

Status: implemented

## Problem

Browser automation sometimes needs the login state of an actual browser profile. A temporary isolated profile cannot reach that state, and copying cookies is not equivalent to operating the browser: sites also keep identity in local storage, IndexedDB, service workers, and device-bound credentials. The capability must be explicit because CDP gives every DSH session access to real pages and unauthenticated local debugging ports expose the same access to other local processes.

## Decision

Browser view has two sources. The default isolated source still launches a temporary Chromium profile. The opt-in real-browser source connects to a user-started Chrome/Edge CDP endpoint, using volatile settings `realBrowserEnabled=false` and `cdpEndpoint=http://127.0.0.1:9222`. Settings changes dispose the old attachment and the next action uses the new source without remounting the plugin.

The CDP HTTP origin and the WebSocket returned by `/json/version` must both be loopback, have explicit ports, and carry no credentials. Discovery redirects are refused. A connection failure reports an error and never falls back to the isolated browser.

The real source discovers and adopts every existing and future page target. All DSH sessions may enumerate and operate those pages with the existing browser tools. Adoption never applies device-metric overrides; refreshed frames read the real CSS viewport. DSH-created targets and adopted targets have distinct origin metadata throughout the host, wire protocol, and client.

Disposal and configuration changes only stop streaming and close the CDP socket. They do not close the external browser or its tabs. `browser_close` without an explicit tab id retains session ownership limits; in real mode an explicit id may close any listed page. The panel close command refuses adopted tabs.

Attaching carries two separate deadlines: the DevTools handshake is bounded at five seconds, while each command keeps the shared 30-second CDP budget, so a slow navigation is never reported as a connection failure. A session whose socket has closed — the external browser restarted or crashed — is dropped on the next call with the same detach-only cleanup and replaced by a fresh connection; concurrent calls share that one replacement, and a reconnect that fails is reported as the connection error instead of being replaced by the isolated browser.

Chrome 136+ ignores remote-debugging switches on its default data directory. The feature therefore supports real profiles whose browser actually permits CDP, including profiles started with a non-default `--user-data-dir`; it does not claim that a default Chrome profile can be attached. Login state is used in place and no cookie jar is imported or copied.

## Runtime and client contract

`BrowserPanelState` carries optional `mode` and `cdpEndpoint`, while `BrowserTabView` carries optional `origin`. Older payloads remain valid because missing mode means isolated and missing origin preserves the historical panel behavior. The socket decoder retains those fields. The toolbar names the source and displays the endpoint in real mode; it remains a view and does not forward user input. A `plugins.row.config` contribution exposes the volatile fields for both the standalone `ui-browser-view` and aggregate `web-ui-browser-view` row ids. The same form also renders as a shared `PluginSettingsCard` under Web Extensions, with standalone and aggregate entry-id fallback. Reconfigure restarts streaming for an already attached panel, and the client clears the old frame and error whenever the browser source changes.

## Testing

The package suite covers endpoint validation, hostile discovery WebSockets, default configuration, existing and future target adoption, real frame dimensions, close authorization, connection failure without fallback, and detach-only cleanup. It also covers the two attach deadlines separately (a five-second handshake against the thirty-second command budget) and the replacement path (a closed transport, concurrent calls sharing one replacement, a reconnect failure that stays in real-browser mode, and the dropped bindings and pinned selection). The default isolated suite remains green. Client tests cover wire narrowing, real/isolated source display, and row-configuration writes, and the locale audit covers zh/en/ru parity. A live temporary Chromium probe adopted an existing page, used its HttpOnly login cookie on navigation and snapshot, and confirmed that reconfigure leaves the browser and page alive. An isolated DSH_HOME GUI run rendered both configuration fields, persisted the switch and edited endpoint, and reported the matching CDP mode and endpoint through the state route. A second GUI run rendered the shared card in Web Extensions and persisted both fields there. A live screencast probe received four frames after reconfigure without remounting the panel, and the JPEG bytes changed after navigation.

## Alternatives considered

**Import cookies or copy a browser profile.** Rejected as the primary mechanism because it is not operating the actual browser, does not cover all identity storage, weakens credential boundaries, and can produce a stale copy rather than the user's current session.

**Replace the isolated browser unconditionally.** Rejected because an opt-in real browser is not always available and an upgrade must not silently grant every session access to daily browsing. The temporary isolated browser remains the default.

**Attach only DSH-created tabs.** Rejected by the product decision: the requested capability includes existing real-browser pages. The UI and security documentation therefore state that every DSH session can operate every page.

**Allow every close path for adopted tabs.** Rejected because an implicit cleanup or panel action could destroy unsaved user work. Real tabs require an explicit agent tab id; panel close is refused, while disposal never closes them.

**Permit remote CDP endpoints.** Rejected because CDP has no application-level authentication. Both the configured origin and the discovered WebSocket are constrained to loopback rather than trusting one validation at one layer.

**Build a browser extension or native bridge.** Not selected for this implementation. It would target browsers that block default-profile CDP but requires a different permission model and per-tab transport. The CDP compatibility limit is documented instead of being hidden.

## Consequences

Enabling the mode deliberately grants broad access to real authenticated pages. The local CDP port must be treated as a sensitive capability and opened only for the intended browser lifetime. Chrome's default-profile restriction means some users must use a separately maintained real profile and sign in there once; the feature does not bypass that browser security control.

The host now owns target adoption and two lifecycle models. Future changes must preserve mode-specific disposal, idempotent target attachment, real viewport behavior, and the explicit close boundary. Protocol fields are additive, so no wire-version bump is required.

The idle auto-close decision ([browser view idle auto-close](2026-11-12-browser-view-idle-close.md)) closes only tabs DSH created, so the explicit-close boundary for adopted tabs stated here still holds.
