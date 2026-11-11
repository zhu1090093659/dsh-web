# dsh-task-board-team · Team collaboration provider for the DSH task board

English | [中文](README.zh.md)

An external provider extension for the DeepSeek Harness (DSH) task board (`@linxin666/dsh-client-ui-task-board`). It connects this machine to a cloud `team-hub`: issues the hub assigns to a dsh-agents member bound here are claimed under a lease, executed as mirror cards on this Host, and settled back to the hub, while decision questions, comments and review rejections travel between the team and the session that is doing the work. The board's columns, ledger and execution rules are untouched, and the plugin mounts through `cordis.patch.yml` and profiles without any DSH source change.

## Features

- **Member bindings, not a shared queue**: the settings entry names dsh-agents member ids; the member definition supplies the name the hub resolves mentions by, the agent preset and the team workspace. An issue assigned to any other agent is never claimed here, even when the hub lists it.
- **Registration and heartbeat**: the Host registers at startup with its hostname, client version and agent definitions, then heartbeats every 15 s, which is the cadence the protocol fixes. A member name another Host already owns is skipped by the hub and reported as a visible problem instead of going missing silently.
- **Lease-based claiming**: a claim returns a lease token and an execution attempt id; the mirror card stores both in this extension's own `integrations` payload, and the lease is renewed every 20 s while the card executes.
- **Idempotent reconnect**: a reconnect re-registers, replays the channel from its last sequence number and re-claims with the attempt credentials the card still carries, which is only while the run executes here and the lease is held; a settled card releases both, so claiming that issue again is fresh and the hub mints the new attempt itself.
- **Settlement write-back**: a settled execution writes back its own Host execution verdict — `succeeded` (moving the issue to `in_review`) when the execution itself succeeded, or `failed` with the recorded reason on failure or cancellation — and the summary is clipped to the protocol's 4000-character cap. Every write-back names the attempt that ran. A refusal that can never change — 412 `LEASE_EXPIRED`, or any other deterministic 4xx (with four exceptions) — is final: the Host drops the pending settlement instead of retrying it, clears the attempt and lease only when the refusal names the ones the card holds, and records a visible error; reporting a new outcome requires starting the card again. Anything that may still pass — a transport failure, a 5xx, and four 4xx exceptions (401: the Host Token is unrecognized or revoked, and can still land once the operator provides the right token; 408 and 429; and a 4xx without the hub's error envelope: such errors come from a CDN or firewall in front of the hub rather than the hub's own gates) — stays on the card, and the next sweep retries it before claiming that card, because a claim would mint an attempt nothing runs and the retry would then die against it.
- **Question routing**: a decision question asked through `ask_user_question` in a mirror card's session is reported to the hub and answered by the issue's reviewer; the answer, an expiry or a local cancellation ends the ask, and every other session on the machine keeps its own answerer.
- **Comments both ways**: the `team_comment` tool posts an agent comment on the issue behind a card, and a comment that mentions a bound agent is delivered into that card's session as a follow-up message.
- **Rework and retries**: a review rejection and a sweep share one claim per issue, and only a successful claim decides what runs — a pending rework re-runs the card in its existing session with the reviewer's instructions, and a card a human sent back with nothing running here is started again through the same entry a first claim uses. A refused claim starts nothing and records the refusal locally, and a fresh claim drops the settlement an earlier attempt left behind, because that attempt is gone and its retry can never land.
- **The run starts through the board's host face**: the provider contract has no "run" member, so a claimed card is started through the `taskBoard` host service's `apply` — the same in-process action seat the remote bridge drives the board with, and every run gate still applies.
- **Visible degradation**: follow-up delivery, rework and the execution trigger are probed at mount; a board revision that serves none of them loses that delivery, says so on the card and in the settings block, and keeps everything else working.
- **Three browser seats**: a task-detail section (issue, hub status including `in_review`, assignee, reviewer, comment thread, activity stream and open questions), a hub-status badge on the card, and a configuration block inside the board's own settings card that stays reachable while the extension is switched off.
- **One switch gates both halves**: turning the extension off stops the claim loop, the lease timers, the channel and the tool registration, drops the published summary and releases the rendering seats, without deleting a single card.

## Install

Install this package into the profile and restart `dsh web`:

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-task-board-team@latest
```

### Local development

```sh
pnpm install
pnpm --filter @linxin666/dsh-client-ui-task-board-team build
dsh plugin --profile web add link:$(pwd)/packages/dsh-task-board-team
```

## Configure

Open the task board settings and find the **Team collaboration** block; it stores the hub URL and team id as this plugin's own volatile settings and sends a pasted Host Token to the host once.

- The Host Token is held in the harness credential store under `hostTokenRef` (default `DSH_TEAM_HUB_TOKEN`) or, failing that, in the environment variable of that name; no snapshot, summary or tool result carries its value.
- The member bindings are dsh-agents member ids (comma separated in the block). A binding that names a member the dsh-agents ledger no longer defines is reported in the block and skipped, and so is a member whose definition pins no agent preset: the hub requires a non-empty `preset_id`, and running such a member would silently fall back to the deployment default.

```yaml
# profile patch equivalent
hubUrl: https://hub.example.com
teamId: team_01j7b5w8m4f9q2e3r6t1y8u4i5
hostTokenRef: DSH_TEAM_HUB_TOKEN
agents:
  - memberId: mem_01j7b5w8m4f9q2e3r6t1y8u4i6
```

## Known limitations

- **A board that cannot pin the draft targets is refused, not guessed at**: the member's preset, model and reasoning effort travel with the `tasks.create` draft, and the created card is read back to confirm they survived. A board revision that drops them produces a mirror card that is left UNSTARTED with a visible note in the settings block, because running it under the deployment's default preset would not be the member's run.
- **Starting an execution needs the board's action seat**: the contract has no "run" capability, so the mount probes the board's in-process action applier and, when a deployment serves none, the claimed card is created for the operator to start instead.
- **The activity stream is what this Host observed**: `GET /issues/:id/activity` exists but only a member session may read it, and this Host authenticates with a Host Token, so the detail section renders the events this Host received over the channel since it started; the complete stream is in the Whale App.
- **Questions are reported one at a time**: a batch with several questions reports the first one and keeps the rest on this machine, because the hub's question schema stores a single question.
- **A claimed question holds the ask for two minutes**: after that window the ask returns to the local answerer and the hub question is withdrawn, so a team that never answers cannot stall a session for the hub's 24-hour TTL.

## Security model

- **The Host Token never reaches the browser twice**: it is written once from the settings block into the credential store, read only by the host half, and reported afterwards as "configured" plus its source.
- **Tool permission approvals never enter the hub**: this provider subscribes to `user-questions/request` only; `approval/request` has no listener here, so a tool sandbox decision stays on this machine and never becomes a remote request.
- **Remote text is content, not authority**: an issue title, body or comment becomes card text, a summary field or a session message, and never a permission, a workspace identity, an agent preset or a `promptPrefix`.
- **Claims are bounded by the lease**: a claim that this machine cannot mirror or start is logged and left to expire, and the lease renews only while this Host still holds it.