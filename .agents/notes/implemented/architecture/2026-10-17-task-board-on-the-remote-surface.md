# Agent Note: Task board on the remote surface through two additive seams

Status: implemented

## Problem

The remote bridge (protocol v1) served sessions, prompting, approvals and host questions, and nothing else. The task board — the Host's authoritative ledger of work, its schedules and its executions — had no remote surface at all, so a phone could start a turn but could not see or drive the board that decides which turns run.

Three facts shaped the fix:

- **The bridge must not learn board vocabulary.** Its method and topic tables are frozen by a parent card (§1–§11); adding `board.*` to them would put one plugin's domain inside a protocol every other client speaks.
- **The board's HTTP surface is not reachable from inside the Host process.** Its routes are guarded for a browser-shaped request (`packages/dsh-task-board/src/host-routes.ts`, the same-origin and `sec-fetch-site` checks), so an in-process `fetch` to `/api/task-board/*` is refused. The board's own capability face exists only as methods on the `TaskBoardHostService` instance, which no cordis service published.
- **The only published `taskBoard` service was the provider-registration pair** (`registerExtension`, `isExtensionEnabled`), which hands a provider `tasks.*` / `integration.*` / `events.*` — enough for a GitHub-style provider, nowhere near a snapshot with `scheduler` and `power`, and with no way to apply an arbitrary action.

## Decision

The board reaches the remote surface through two additive seams and one new package, and neither seam knows the other's vocabulary.

1. **A generic bridge seam.** `packages/dsh-remote-bridge` publishes a cordis service `remoteBridge` with `registerMethods({ capability?, methods })` (returning its disposer) and `broadcast(topic, payload, capability?)`. The bridge dispatches a registered name after its own gates — an unregistered name answers `unknown-method` first, an unpaired connection answers `unpaired` exactly as for a protocol method, and a client that never declared the table's capability is told the method does not exist — and forwards the plugin's `{ok, r}` or `{ok:false, code, msg}` verbatim. `hello` answers `minor: 1`; major 1 and every frozen field, method name and topic name are unchanged. The same seam decides what the greeting advertises: the plugin had registered `board.v1` and its methods while `hello` answered the bridge's static `SERVED_CAPABILITIES` alone, so a phone reading its own `board.v1` off the handshake concluded this host serves no Tasks. The answer is now `SERVED_CAPABILITIES` plus `RemoteBridgeRegistry.capabilities()` — the distinct non-blank capabilities the registered tables gate on, ascending — computed on every greeting, so a plugin mounted after the bridge was built is visible to the next connection, and a withdrawn table's capability disappears with it unless another registered method still requires it.
2. **A narrow in-process face on the board.** The `taskBoard` service gained `snapshot()`, `apply(requestId, action, initiator?)`, `subscribe(listener)` and `modelCatalogOptions()` (renamed from `verificationOptions()`, alongside the remote seam's `BoardFace`, when [goal acceptance was removed](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.md)), each a **forward** of the Host service method of the same name. No gate, normalization or state lives in the published object, so a consumer reaching the board this way is refused by exactly what refuses a browser. The existing two members are untouched.
3. **One binding package.** `packages/dsh-task-board-remote` owns the board's wire vocabulary (`board.v1`, `board.snapshot`, `board.options` answering `{catalog, meta:{sessionDefaultPermission?, cardDefaults?, maxSubtaskDepth?}}`, `board.apply`, `board.changed`, `board-unavailable` / `board-refused`), resolves both seats structurally (`ctx.get` plus `ctx.inject`, no import of either owner), and adds nothing but shape forwarding, per-connection `requestId` replay and wave coalescing. Every business decision — the running lock, the permission confirmation, subtask depth, schedule budget — stays in the ledger.

The wire contract is frozen by `iphone_remote_use_dsh/docs/protocol-v1.md` §12; this note records why the two seams exist, not what the frames look like.

## Refusing an action kind this build does not implement

The capability face forwards a caller's action object verbatim, and that made one hole reachable that the HTTP route had been covering by accident. `parseActionEnvelope` (`packages/dsh-task-board/src/protocol.ts`) rejects a kind outside the action union before an action reaches the ledger, so the ledger's own `apply()` switch never saw one — and that switch has no `default`. Once an in-process caller could hand `TaskBoardHostService.apply()` an action nothing upstream had validated, an unknown kind fell through the switch to the commit at its end: the revision moved, the document did not change, and the caller was told `ok`. The cost is not only a wrong success: every connected client is woken by `board.changed` and reloads a full snapshot, because the wire has no paging.

The refusal lives where the actions live — not in the bridge, and not in the binding plugin, because a second copy of the rule is the defect this repository keeps paying for:

1. `TaskBoardHostService.apply()` validates the kind against `ACTION_KINDS`, a total `Record<TaskBoardAction['kind'], true>`. A new union member does not compile until it is listed, so the table cannot fall behind the protocol. An unknown kind throws `unknown task board action kind: <kind>`, which crosses the remote surface as `board-refused` with that text (§12.3) and changes nothing.
2. `HostTaskLedger.apply()`'s switch gained the `default` it never had, as defence in depth for a future call path that reaches the ledger with no service in front of it.

`tests/host-face.spec.ts` fixes the three facts: the refusal through the published face leaves the revision and the task list untouched and fires no subscription; a ledger held directly refuses the same kind; and a walk over every kind of the union proves none is refused as unknown — each is handled, or refused on its own merits.

## Context & Efficiency Impact

The bridge gains one registry keyed by method name and one optional field per connection; a connection with no extension mounted costs one `Set.has` on names outside `KNOWN_METHODS`. The board gains four forwards on a service object it already created, and the plugin gains a per-connection replay table bounded at 128 keys plus a microtask coalescer. Nothing is added to the ledger schema, the board's own HTTP surface or the browser bundle (the plugin is host-only). Reading a revision for `board.changed` costs one full `snapshot()`, because the board publishes no revision-only read; the coalescer therefore makes it one clone per wave, not one per change.

## Alternatives considered

**Let the remote plugin call the board's HTTP API over loopback.** Rejected before it was written: the board's route guard admits a browser-shaped request (same-origin or `sec-fetch-site`), which a process cannot present without pretending to be a browser, and a second access-control story for one consumer is exactly what the guard exists to prevent. The Host process has an in-process path — the service — and using it keeps one authorization model.

**Hand the whole `TaskBoardHostService` instance out as the service value.** Rejected: the instance exposes the ledger, the execution runner, the scheduler and the power inhibitor, so a consumer could reach around the gates this task exists to preserve, and its shape would become load-bearing for every consumer. Four named forwards state the contract; anything else stays private.

**Let the plugin build its own transport (its own WebSocket or its own HTTP route) instead of extending the bridge.** Rejected: a second connection surface duplicates the device-token, pairing and capability checks that make the remote surface trustworthy, and a phone would have to carry two clients.

**Write `board.v1` into `SERVED_CAPABILITIES`.** Rejected: that constant states what this bridge itself serves, and the bridge is not the board's author — a host with no board mounted would announce `board.v1` and answer `unknown-method` behind it, which is the one lie a capability list must not tell. It also leaves the next surface (schedules, logs, a second plugin) as another edit to the same constant, which is precisely the coupling this seam exists to remove.

**Compute the union once and hold it as a process-level constant.** Rejected: the bridge object exists before any plugin registers anything, so the list would be captured while the registry is still empty and keep the very symptom above — the board mounts after the bridge, so its capability would never be announced. The union is one set walk per greeting and dies with the connection's handshake.

**Put `board.*` into `KNOWN_METHODS` and let the bridge serve the board directly.** Rejected: the bridge would then hold board vocabulary, so every board change (a new action kind, a new meta field) would be a protocol change, and the bridge could not be mounted with a board it does not know.

## Consequences

- Adding a remote-facing capability no longer requires touching the bridge: a plugin registers a table and a topic, and the bridge's only obligation is to keep dispatch and fan-out generic. The same seam is what a future surface (schedules, logs) should use.
- The board's published face is now a compatibility surface. The four forwards must keep tracking the Host service methods they forward; a renamed host method becomes a visible, typed break rather than a silent one.
- `initiator` stays unset on a phone-initiated action. The board documents the field as the id of the DSH session issuing the action, and a phone is not one; a stand-in would enter the execution audit trail and the workspace inheritance lookup as a session id that never existed. The consequence is that a card created from a phone gets no session workspace pin and falls back to the board's recent-workspace rule at execution.
- The full snapshot has no paging. A board large enough to exceed protocol v1's 10 MiB frame cap answers `board-unavailable`; §12 records that limitation and this note does not lift it.
- The advertised capability list is a union the bridge does not wholly own. `MINOR` still counts additions to protocol v1 only, and a plugin's name appears because a registered table requires it, not because the bridge claimed it, so a client reading `hello` sees the registry's state at that moment — a plugin unmounted mid-session is absent from the next greeting.
- Nothing about the phone is verified end to end here: the bridge seam, the board face and the plugin each have their own suites, and the device round trip stays a manual step.
