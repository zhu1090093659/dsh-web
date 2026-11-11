# dsh-task-board-remote · the task board on the remote surface for DeepSeek Harness (DSH)

English | [中文](README.zh.md)

`@linxin666/dsh-task-board-remote` puts the dsh Web GUI task board on the remote surface. It is the host half that binds the task board's capability face to the generic extension seam of `@linxin666/dsh-remote-bridge`, so a paired phone reads and drives the same Host ledger the browser does — no second authority, no synchronization protocol between two databases, and no HTTP surface of its own.

## What it does

- **Three methods.** `board.snapshot` forwards the Host snapshot verbatim, `board.options` serves the Host model catalog plus the board's live meta, and `board.apply` hands one action to the Host's own `apply`.
- **One topic.** `board.changed` tells the paired phones that declared the capability that something moved; it carries the revision alone.
- **The Host decides.** Every gate — the running-task lock, the permission confirmation, the subtask depth, the schedule budget — stays where it is. A refusal is the Host's own sentence, carried as `board-refused`.
- **Degrades instead of failing.** The row declares no injected service: a Host with no bridge, or with no task board, keeps starting and loses exactly this surface.
- **No vocabulary in the bridge.** The method names, payloads, topic and refusal codes live in this package; the bridge dispatches and fans out what it is handed.

## Requirements

- `@linxin666/dsh-remote-bridge` supplies the seam and the paired-device protocol.
- `@linxin666/dsh-task-board` supplies the capability face.

Neither is a hard dependency. With either one absent the row registers nothing, and the Host is unaffected.

## Wire surface

| method | request `p` | response `r` |
| --- | --- | --- |
| `board.snapshot` | `{}` or `{since}` | `{mode:"reset", token, snapshot, revision, tasks}` — the Host snapshot verbatim plus the incremental keys — or `{mode:"delta", token, revision, changed, removed}` |
| `board.options` | `{}` | `{catalog, meta:{sessionDefaultPermission?, cardDefaults?, maxSubtaskDepth?}}` |
| `board.apply` | `{requestId, action}` | `{snapshot, revision}` |

A client declares `board.v1` in `hello`'s `cap` array. Without it the three methods answer `unknown-method` — the method is not part of that client's protocol — and the topic never reaches it.

A client that also declares the bridge's `delta.v1` may send a previous answer's `token` back as `since` and is answered only what moved — `mode:"delta"` with `changed` and the ids in `removed` — or the whole board again when a delta would not be clearly smaller. Everything about that decision is the bridge's (protocol v1 §15): this row only hands it the board's rows and wraps the answer. A client that declared nothing, or sent no token, always gets `mode:"reset"` with an empty `token`, and `snapshot` unchanged for it — the incremental keys are additive. Pairing is checked first, exactly as it is for every protocol method.

`action` is the Host action's own JSON form (`create`, `update`, `move`, `archive`, `restore`, `delete`, `settle`, `record-external-outcome`, `extension-action` and the rest) and crosses verbatim. No initiator is passed: the board documents that field as the id of the DSH session issuing the action, and a phone is not one — a stand-in would put a non-session identity into the execution audit trail and into the workspace inheritance lookup, which reads the field as a session id.

## Events

| topic | payload |
| --- | --- |
| `board.changed` | `{revision}` |

A wave of Host notifications is coalesced into one frame, and the payload never carries the task list: the client fetches `board.snapshot` itself, the same policy the browser half applies to its own stream. The revision is read at delivery time through one snapshot, because the board publishes no revision-only read.

## Idempotency and revision

`requestId` is the idempotency key, and its scope is one connection. A repeated key answers the previous response without applying the action again. A key whose answer was `board-unavailable` is deliberately forgotten, because nothing was applied and the retry has to be allowed to work. A client must mint a new key for every action it applies.

The revision is a lag detector, not an optimistic lock: a client whose local revision is behind the event's re-fetches the snapshot first, and the Host never refuses a write for being stale. Conflicts are last-write-wins, and no client may invent an "someone else is editing" lock.

## Refusal codes

| code | meaning |
| --- | --- |
| `board-unavailable` | the board is not mounted, its read failed, or the full snapshot cannot cross one frame |
| `board-refused` | the Host refused the action; `msg` is the Host's own text |
| `invalid-args` | the request envelope is unusable; nothing reached the Host |
| `unknown-method` | this client never declared `board.v1`, or the name is not part of the surface |
| `unpaired` | the connection carries no device token |

## Install

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-task-board-remote
```

The bundle patch inserts one host-half row. It carries no `disabled` switch: with neither service present it registers nothing, and a disabled row is what an operator would otherwise have to remember to flip.

## Limitations

- The full snapshot has no paging. A board large enough to exceed the 10 MiB frame cap answers `board-unavailable`, and the client cannot ask for a slice.
- The event says that something changed, not what changed: every refresh is a full re-fetch, and the Host serves no delta.
- Reading the revision for an event costs one full snapshot, so a very large board pays a deep clone per coalesced wave.
- `board.options` serves the model catalog the Host resolves right now; a client must not cache it.
