# Agent Note: Desktop background attention reminders

Status: implemented

## Problem

Issue #1498 reports the failure mode of running several conversations at once and then working in another window: an approval request, a finished turn, or an interrupted turn produces no signal the user can notice from outside the GUI, so a run sits blocked on a confirmation until they happen to switch back. The audio half of that request is already answered by the community `dsh-notifier` plugin; the half that is not is the taskbar, which a browser page cannot reach at all — only an Electron main process can (`BrowserWindow.flashFrame`). The repository's `desktop/` shell already existed, but its preload only served the local splash and error pages: there was no renderer-to-main path for the GUI to use, and no policy on the main side even if there had been.

## Decision

Background attention reminders are a desktop-shell feature, implemented entirely inside `desktop/` — no DSH plugin, no package, and no new runtime surface in the web profile.

### The observer

The GUI is ordinary web content that knows nothing about this shell, so `desktop/src/attention-observer.js` is injected into the page's main world after every document load (`did-finish-load`, gated to the loopback GUI URL so the splash and error pages get nothing). It watches the DOM with a `MutationObserver` and reads four cumulative counts from deliberately-attributed hooks — never a CSS-modules hash:

| Hook | Counts |
| --- | --- |
| `:is([data-approval-key], [data-question-key], [data-plan-review-key])` | composer takeovers rendered while a run waits for the user |
| `[data-chat-flow-kind="turn-tail"]` | ended turns (ui-chat publishes one on `turn/end` whatever the reason) |
| `[data-chat-flow-kind="turn-error"]` | turns that ended with `reason.kind === 'error'` |
| `[data-state="stopped"]` | interrupted tool calls |

Signals are produced by comparing consecutive snapshots, and only by **increases**: history is cumulative in the flow, and a decrease (switching conversations, a reload) means nothing. The first snapshot only primes the state, so a page that loads with history on screen cannot claim a turn just ended. A 1.5 s settle window absorbs the burst of DOM work one settlement causes.

### The bridge and the policy

`desktop/src/preload.cjs` exposes `notify(kind)` on the existing `desktop` bridge; the main process re-validates the sender (it must be the GUI window's web contents) and the payload (a closed enum `approval` / `completed` / `interrupted`), then applies the policy in `raiseAttention`: a focused window is never raised, a 4 s cooldown coalesces bursts, flash and sound are individually switchable through the optional `$DSH_HOME/desktop-attention.json`, and `flashFrame(true)` is cleared on the window's next `focus` event.

## Alternatives considered

**Subscribe to the host protocol (`/api/remote.mux`, `session/follow`) from the main process.** This is the only way to read `turn/end`'s authoritative reason union, and the research that preceded this change confirmed it needs its own token plumbing and would duplicate a connection the GUI already owns. Rejected for this change: it is a second client of the host, with its own auth, reconnect, and stream-lifecycle surface, for a feature whose value is a background flash. It stays the documented path to exact interruption detection, and the shell deliberately does not take it yet.

**Deriving "a turn ended" from the sidebar's running indicator (`[data-state="ongoing"]`).** Rejected: the indicator is global, so with several conversations running the reminder would only fire when the LAST one settled, and a per-row signal is not available either — the session rows are `role="treeitem"` with no session-id attribute to key on. `turn-tail` gives exactly one node per ended turn and needs no identity at all.

**Matching the "stopped" marker instead of ignoring it.** The stopped marker on an interrupted assistant message is a CSS-modules hashed class with localized text. Rejected: matching either would break on the next rebuild or on a language change, which is the same class of bug the skin contract already forbids.

**Using the renderer's `Notification` API instead of the taskbar.** Rejected: the request is specifically the taskbar, Electron's `Notification` needs a permission path of its own, and `dsh-notifier` already covers in-page and system notifications.

**A settings surface inside the desktop app.** Rejected: the app has no settings UI and adding one for two booleans is more surface than the feature is worth; `$DSH_HOME/desktop-attention.json` is validated so that only a literal `false` disables a channel and any typo falls back to the default.

## Consequences

- The desktop app can now tell the user that a run needs them, which no browser-side plugin could do.
- One more file is injected into the GUI page. It only reads attributes and calls `notify`; it never touches page state, and a missing bridge is swallowed.
- The kind set is a contract between three files (observer, preload, main) and is asserted by `desktop/tests/attention.test.mjs` together with the decision rules; `pnpm test:desktop` is the gate.
- Interruption is a heuristic: an errored turn or an interrupted tool call is reported as `interrupted`, but a turn the user stopped while only assistant text was streaming carries no semantic attribute and is reported as `completed`. This is stated in the desktop README's known limitations, not hidden.
- The reminder fires per settled turn, not per conversation identity: the shell has no reliable way to say WHICH conversation ended, so it does not try.
- Reminders exist only in the desktop shell; a browser tab still has none.
