# Agent Note: chatgpt-subscription remote.session inject hotfix in the local web profile

Status: implemented

## Problem

The [rc.1 cohort rollout](../architecture/2026-09-10-sdk-cohort-0.1.5-rc.1.md) recorded a pre-existing baseline finding — a repeated `remote.session` inject pageerror in the web GUI. After the [task-board fix](2026-09-11-taskboard-model-inject-pet-carry-and-preset-semver.md) removed this repository's own offender, the pageerror persisted: two uncaught `Error: cannot get property "remote.session" without inject` pageerrors on every GUI page load.

Stack attribution, verified line-exactly against the served combined plugin bundle: the official `@deepseek-ai/dsh-client-ui-model-selection` service's `directoryFor` reads `this.ctx.remote.session`, and `@eddyskywalker/dsh-chatgpt-subscription` (mounted in the local `web` profile at 0.2.12) triggers it from its `conversation.input.right` slot `inject` callbacks — `ctx.modelDirectories.directoryFor(sessionId)` for the codex-subscription-quota and antigravity-quota widgets. The plugin's top-level inject declares only `['slots', 'locale', 'modelDirectories', 'conversation']`; without the dotted `'remote.session'` key the Cordis client proxy refuses the access — the same defect class the task-board fix closed here. Upstream is not fixed either way: dsh 0.1.5-rc.2's model-selection keeps the access, and chatgpt-subscription 0.2.18 (latest npm) ships the same inject declaration.

## Decision

The installed profile copy is hotfixed in place: `~/.dsh/profiles/web/node_modules/@eddyskywalker/dsh-chatgpt-subscription/lib/client.js` gains `"remote.session"` in its top-level inject array, with a pre-patch backup alongside (`client.js.bak-remote-session-20260912`). Nothing in this repository changes — defect and fix both live in third-party packages, so there is no source-level owner here to patch. The hotfix mirrors the task-board fix pattern and `dsh-llm-verifier`'s declaration, which also reads `remote.session` and declares it.

The fix is volatile by design: any chatgpt-subscription update in the profile overwrites the patched file and the pageerror returns. Re-apply the one-line addition, or move to an upstream release that declares the key — check for an upstream fix before re-patching.

## Testing

- Before the fix, a CDP error hook against the running 0.1.5-rc.1 host (port 3080) captured two pageerrors per page load; the stack resolved line-exactly to the model-selection `directoryFor` access and the chatgpt-subscription slot inject call site.
- After the fix, the same hook reports zero pageerrors on reload; the GUI frame, task-board, and composer render normally.

## Alternatives considered

- Upgrade chatgpt-subscription to the latest npm release: rejected — the 0.2.18 tarball's inject declaration is unchanged, so the upgrade would not fix the error.
- Report upstream only and leave the local error in place: rejected — the error fires on every page load of the user's daily GUI; the one-line local patch removes it immediately, while an upstream report remains the durable fix.
- Patch the official model-selection service instead, guarding the `remote.session` read: rejected — the accessor sits in the host's bundled official plugin, which the next host update reverts, and the missing declaration is the third-party caller's contract breach, not the service's.

## Consequences

The local web profile carries one out-of-tree patch; profile installs and plugin updates silently revert it. A future session seeing this pageerror should check this note and the backup file before re-deriving the attribution.

Same-day addendum (corrects this note's original crash-loop attribution): the user-reported repeated Chrome closures were traced, under live surveillance, to the unrelated `demo2/wandering-earth-jupiter` capture automation — its `tools/batch.sh` ends with an unscoped `pkill -9 -f "Google Chrome"`, and its `tools/shots.sh` headless instances hang after screenshots until the 100-second wait cap expires, so every batch tail SIGKILLs every Chrome on the machine, the user's GUI browser included. Two predicted deaths (12:50:11, 12:55:48) matched the png-mtime-plus-100-seconds formula to the second; Chrome's per-profile `exit_type=Crashed`, the absence of any crash dump, and the total absence of Chrome processes in the death-second snapshot are the forensic signature. The browser-automation daemon and Chrome's debugging consent relaunch contribute noise but not closures.
