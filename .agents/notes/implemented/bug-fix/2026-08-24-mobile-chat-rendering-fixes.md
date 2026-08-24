# Agent Note: Mobile chat rendering fixes for tool-call bubbles and streaming text truncation

Status: implemented

## Problem

On the mobile web surface (/m/, @linxin666/dsh-remote-web-ui), message rendering had two usability defects (Issue #1065):
1. Air bubbles: When tool-call disclosures were turned off in mobile display settings (showToolCalls: false), assistant messages containing only tool calls with no body text or reasoning still rendered as an empty bubble showing only the timestamp.
2. Premature collapse during streaming: Long assistant messages (>1600 characters) were collapsed to 45vh (overflow: hidden) while streaming was still in progress (pending: true), hiding incoming content and breaking auto-scroll tracking on mobile. In addition, the 1600-character threshold was low enough that ordinary markdown tables and analysis replies frequently got cut off.

## Decision

1. Add a visibility guard to MessageRow: assistant messages with no reasoning text, no visible tool calls (i.e. tools absent or showToolCalls: false), no message text, and not flagged as ailed are skipped entirely (eturn null), eliminating empty air bubbles.
2. Modify MarkdownText folding logic: evaluate long as !pending && text.length > LONG_TEXT_LIMIT, so active streams remain fully expanded and automatically scrollable during generation.
3. Increase LONG_TEXT_LIMIT from 1600 to 6000 characters, ensuring regular markdown tables and multi-paragraph responses render in full while preserving the explicit "展开全文" (expand) toggle for very long replies once streaming finishes.

## Alternatives considered

Filtering out tool-only messages in oldEvents / EventFolder: rejected because RenderMessage records represent authoritative session state needed when toggling display settings live without re-running history pulls; the filter belongs at the view rendering boundary (MessageRow).

Auto-expanding the collapsed container dynamically during stream without removing chat-md-collapsed: rejected because keeping max-height: 45vh with conditional expansion creates layout thrashing and complex DOM measuring compared to simply deferring the collapsed state until the turn closes (!pending).

## Consequences

Closing tool calls in display settings now cleanly hides tool-only steps without blank bubbles. Long replies remain fully visible while generating, and normal-sized tables/reports render without requiring manual expansion taps. The only trade-off is that completed turns with between 1600 and 6000 characters take more vertical screen space when scrolled past.
