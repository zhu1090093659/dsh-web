# Agent Note: Text message edit-and-resend uses an exact-prefix fork

Status: implemented
Archived: 2026-11-14

Supersession check: [better-session-replaces-chat-recovery](../architecture/2026-08-27-better-session-replaces-chat-recovery.md) retired the old last-message editor because it overlapped better-session, and [drop-deprecated-better-session-integration](../simplification/2026-09-02-drop-deprecated-better-session-integration.md) later removed that external integration. Neither decision is reversed: `dsh-chat-recovery` and its retry supervisor stay retired, and better-session stays removed. This Note owns the distinct arbitrary-Turn, text-only editing capability in `dsh-message-edit`.

## Problem

A mistaken or ambiguous user message remains in the append-only Session history with every later tool result, so continuing the same Session preserves the bad context. Rebuilding the prefix manually in a new Session loses the useful history. The stock UI exposes no action that edits an earlier user message and resumes from exactly before it.

## Decision

`@linxin666/dsh-client-ui-message-edit` adds one entry to the official `conversation.chat.turnTail` list for every Turn with an ordinary, non-empty, text-only user message. It does not replace the keyed user renderer. The editor preserves the original text, explains that resending opens a branch without undoing external side effects, supports Ctrl/Cmd+Enter and Escape, and disables submission while the Session is running or removed or the peer lacks `session/fork` access.

Submission uses the official client services only: `sessions.fork({ sessionId, atSeq: message.seq - 1, increaseTitle: true })`, a short `sessions.using` reference with the `messageEdit` ownership label, `reference.ready`, `uiWorkspace.openSession(childId)`, and one queued prompt with the verbatim edited text. The inclusive boundary is always a real preceding event, including event zero before the first user message; no blank-session fallback or Host change exists. `sessions.using` releases the temporary reference on every path.

Only content made exclusively of text blocks is eligible. Steering, injected context, blank messages, and attachment-bearing messages have no entry. A fork failure does not navigate or prompt. Once a child exists, a later navigation or prompt failure does not delete it. The source Session is never rewritten and external effects are never rolled back.

The package registers zh/en copy locally, ru through `dsh-i18n`, and semantic anchors `message-edit` / `entry` / `editor`. The aggregate mounts the real package as `web-ui-message-edit`; no compatibility-shell subpath or storage integration is added.

## Alternatives considered

- **Restore `dsh-chat-recovery` with its retry supervisor**: rejected. That package edited only the last completed user message and included retry behavior outside this request. The new package keeps the useful fork-only premise but selects any Turn's ordinary user message and has no retry or persistence surface.
- **Replace the keyed `conversation.chat.node` user renderer**: rejected. Reimplementing the official bubble would risk its Markdown, attachments, copy actions, and future behavior, and would reintroduce the renderer-shadow conflicts recorded for message-action plugins. The Turn-tail list is an additive official extension point.
- **Restore better-session or edit the log in place**: rejected. The RDB integration was deliberately removed, and this issue requires no storage or Host change. Forking is the correct edit model for an append-only event log.
- **Drop non-text blocks and resend only the text**: rejected. That silently changes the user's prompt. Attachment-bearing messages instead offer no edit action.

## Consequences

Every edit creates another Session branch; the original and its descendants remain available. Frequent edits can therefore leave branches the user may clean up through normal Session management. A prompt failure after branch creation can leave a child without the edited message, which is surfaced rather than silently deleted. Rich-message editing requires a separate attachment-preserving design and is not claimed here.

## Testing

`packages/dsh-message-edit/tests/` covers arbitrary historical Turns, first-message boundaries, text and attachment eligibility, fork/retain/open/prompt order, invalid-input and failure paths, registration, editing keyboard flows, disabled states, and visible errors. Focused typecheck, 19 unit tests, build, aggregate, shared-copy, and i18n checks pass. Repository-wide and real-GUI evidence is recorded in the delivery comment for issue #1934.
