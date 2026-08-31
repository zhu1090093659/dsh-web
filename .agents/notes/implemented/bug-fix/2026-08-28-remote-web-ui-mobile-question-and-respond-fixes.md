# Agent Note: Fix mobile question options rendering and respond envelope in dsh-remote-web-ui

Status: implemented

## Problem

In @linxin666/dsh-remote-web-ui mobile web surface (/m/), two issues disrupted user interactions (Issue #1251):

1. **Question options missing under weak-network polling**:
   - QuestionPanel expects a flat list of PendingQuestionItem[] containing the options array.
   - The 1.5s fallback polling endpoint mobile.pending returns PendingQuestionGroup[] nested under each pcId ({ rpcId, questions: [...] }).
   - ChatView.tsx set the nested groups directly into setPendingQuestions, causing q.options to be undefined and hiding radio/checkbox options entirely.
2. **Protocol mismatch in mobile respond submission (agent hangs indefinitely)**:
   - Mobile buttons submit business payloads ({ sessionId, type: 'approval', approvalId, outcome } or { sessionId, type: 'question', answers }).
   - The host handler MOBILE_RESPOND_METHOD directly read payload.rpcId and payload.response (undefined), causing piProxy.respond to reject with 
ot-pending and leaving the agent waiting forever.

## Decision

- **Flatten polled questions**: In ChatView.tsx, flatten state.questions.flatMap(group => group.questions) to match the flat structure expected by QuestionPanel, and clarify PendingState typing in src/mobile/api.ts.
- **Host protocol translation**:
  - In src/mobile-api.ts, look up the matching pcId from pendingTracker for the given pprovalId or question ids.
  - Translate the mobile payloads into valid ApprovalResponsePayload ({ sessionId, approvalId, outcome }) and QuestionResponsePayload ({ sessionId, answer: { answers } }).
  - Return { accepted: false, reason: 'not-pending' } when not found, and preserve passthrough compatibility for legacy direct envelopes.
- **Test coverage**: Added unit tests in 	ests/mobile-api.spec.ts covering approval response translation, question response translation, and missing-pending fallback.

## Alternatives considered

- **Flattening questions directly inside PendingTracker**: Rejected — pcId is the single source of truth for host-side RPC lifecycles; stripping it at the tracker level would hinder RPC-level lookups.

## Consequences

Mobile users can reliably view radio/checkbox choices under both live SSE and polling fallbacks. Submitting approvals or question answers correctly resolves host promises, allowing agents to proceed immediately.
