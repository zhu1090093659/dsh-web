# Review notes: dsh-remote-web-ui on sdk/0.1.2-alpha.1 (vs origin/dev)

Findings-first review of packages/dsh-remote-web-ui. Verification targets: worktree node_modules/@deepseek-ai/* (0.1.2-alpha.1 builds) and packages' generated typert descriptor tables (typert.host.js / typert.remote-client.js), plus the gateway implementation in the pnpm store (@deepseek-ai/dsh-api-gateway/lib/index.js).

## Verified SDK facts the review relies on

- assertExactArguments (dsh-api-gateway/lib/index.js): after resolving the descriptor, the gateway rejects missing required wire args AND any extra key. acceptsMissing covers only parameters with acceptsUndefined === true or codec.mode === 'src-json'.
- session/list descriptor (both typert.host.js and typert.remote-client.js of dsh-api-session-controller): single parameter name/wire '_request', source json, strict codec, NO acceptsUndefined. Therefore invoke({namespace:'session', method:'list', args:{}}) throws TypertGatewayError('arguments-invalid', ..., 'args fields do not match the descriptor: missing "_request"').
- directoryPicker/list descriptor (dsh-api-workspace-controller): single parameter wire 'path', acceptsUndefined true. args {request: ...} -> unexpected "request" -> arguments-invalid.
- All other dispatched endpoints match the BFF shapes: workspace/create, session/{create,page,follow,search,prompt,selectModel,rename,cancel} take {request}; agentPresets/list, session/modelCatalog, llm/listConfigurableProviders, settings/describe take {}; llm/discoverModels takes flat (settingsNs, request); settings/mutate takes flat (ns, ops, expectedRevision acceptsUndefined).
- TypertGateway.invoke rethrows business failures unchanged: TypertRemoteFailure extends Error and stores {code,message,details} on error.failure; it has NO .code property (verified class in dsh-typert-protocol). Only TypertGatewayError has .code.
- SettingsConflictError (dsh-settings): code field 'SETTINGS_CONFLICT' (class field, not carried), message 'settings namespace "NS" changed since it was read (expected revision E, now A)'. The settings controller maps it to TypertRemoteFailure code 'settings-conflict' before throwing - but the plugin reads error.code, which is undefined, so only the message text survives.
- session/page: SessionPageRequest {address, throughSeq, beforeSeq?, maxMessages?}; SessionPage {records, hasMore} - no next cursor. paginate() is deterministic: the same (throughSeq, beforeSeq) always returns the same page; backward paging advances via beforeSeq. Records are SessionHistoryRecord = {type:'event'|'chunks', event}, ascending by seq.
- session/follow opening frame: {type:'snapshot', header, cursor, records, hasMore, projections} - the BFF's opening-frame reads are correct.
- SessionSummary (0.1.2): {sessionId, updatedAt, running, blank, parentSessionId?, origin?, cwd?, projections?: {asOfSeq, values}} - values.title carries the session title. No title/displayTitle fields.
- session/modelCatalog result: {default: ModelSelection, routableProviders: string[], groups, failures} - no 'current'.
- agentPresets/list result: {presets: [{id, trust, isDefault, name?, description?, broken?}], authorable} - no hasDocument.
- workspaceRegistry.list() rows carry sessionIds (phone owned-filter keeps working); slots register({inject}) is a supported feature consumed by the renderer (runInject).

## Findings (as reported)

1. Critical - mobile-api.ts:383 session.list called with args {} -> missing '_request' -> arguments-invalid on every call. Phone session list permanently broken; mobile-api.spec.ts's gateway stub answers 'session/list' without descriptor validation, masking the bug.
2. Critical - mobile-api.ts:442 host.listDirectory sends {request: body}; descriptor takes flat optional 'path' -> arguments-invalid (unexpected "request") on every call. Phone directory browsing / create-workspace flow dead.
3. High - host-gateway.ts:27-29 error mapping reads error.code; business failures (TypertRemoteFailure) carry .failure.code instead, so every business error degrades to code 'internal'. isConflictOutcome/isRejectedOutcome survive only via message regexes; SettingsConflictError's message contains no 'conflict' token, so an expectedRevision conflict answers 502 instead of 409.
4. High - mobile-api.ts:508-523 sessionHistory paging loop never advances (static throughSeq, no beforeSeq carry), repeating page 1 up to 10 times; the follow(maxMessages:1) opening record is prepended and can surface out of order with beforeSeq + short pages.
5. Medium - mobile-api.ts:385-394 drops SessionSummary.projections -> phone session rows lose titles (toSessionView falls back to cwd basename / 新会话).
6. Medium - mobile-api.ts:529-534 drops projections from the history value -> phone permission select (parsePermissionSelect(page.projections.values.permissions)) never seeds.
7. Medium - mobile-api.ts:457-461 session.models maps modelCatalog which has no 'current'; ModelSheet falls back to {provider:'', model:''} so the picker can render with no current selection.
8. Low/Medium - client/index.ts:141 caches ctx.get('workspaces') once at apply; deep-link.ts polls for the same services, acknowledging late registration; if registration lands after apply, the QR deep-link permanently loses its workspace target.
9. Low - mobile-api.ts:449-451 agentPresets/list hardcodes hasDocument: true (field removed upstream).
10. Low - test/coverage notes: mux structural guard untested; remote-contract.spec.ts pins .skip()'d; mobile.respond has no test pinning the unavailable envelope; 10 files lost final newline.

## Explicitly checked, no finding

- Pairing gate + allowlist: gate.ts/pairing.ts/remote-api.ts untouched; /m/api POST routes gate before parse; events.mux gates before streaming; allowlist set unchanged; extra local methods unchanged.
- workspace.list via workspaceRegistry: rows carry sessionIds -> owned filter works.
- SSE cleanup: interval + loop both cleared/aborted on close; no leak; duplicate pings are redundant but harmless (interval pre-existing).
- settings-form.ts save(): scope.mutate swallows failures and recovers (verified in dsh-client-ui-settings/lib/client.js), so the try/catch almost never fires -> failed saves report success. Counted inside finding 3/UX, no separate security impact (writes are fenced host-side; failed writes do not land).
- Phone handles mobile.respond {ok:false, code:'unavailable'} gracefully: callUnary throws RpcCallError, ApprovalPanel/QuestionPanel render the error; panels effectively unreachable because mobile.pending is always empty.
- deep-link sessions.create({workspaceId}) returns the session id string and open(id) selects it - correct.
- Tests: 394 passed, 4 skipped (vitest run, worktree).
