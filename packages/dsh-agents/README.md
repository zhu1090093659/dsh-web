# @linxin666/dsh-agents

English | [中文](README.zh.md)

Agent squads for the DSH Web GUI: reusable member definitions (agent preset, permission, model pin, reasoning effort, member brief) whose brief joins that member session system prompt, launched as real DSH sessions by the Host.

## What it does

- A **team** is an ordered definition with a name, an optional description, an optional pinned workspace and an optional order, holding a list of members.
- A **member** is a reusable definition: display name, optional DSH agent preset id, permission, model pin, reasoning effort, and a short brief.
- A member binds a preset id rather than a prompt. The desktop profile on this machine already ships `@local/dsh-siji-research-squad`, whose presets `xundong` (寻冬), `michun` (觅春), `zhixia` (知夏) and `luoqiu` (落秋) are the user's existing research-squad presets, so the first squads need no new preset.
- The brief becomes part of **that member session's system prompt**, never the first user message; ordinary sessions are untouched, and every other assembly receives an empty section that the Host drops.
- Running a member resolves its preset through the host agent-preset registry, creates the session through the host gateway, renames it `<team name> / <member name>`, pins the permission and model route, and records a run.

## Squads on the native Agent Teams runtime

The deployment's own Agent Teams runtime owns collaboration: the `agent-team` and `tool-agent-team` rows of the base bundle serve the `agentTeams` service, the `team_task_*` shared task board, the `team:policy` prompt section and the `agentTeam` session projection, and this package mounts none of them. On top of that runtime it contributes four things: the squad definition ledger, the panel, member runs, and whole-squad orchestration — the roster context that tells the Lead who its members are, and the Team-mode switch that makes the native board reachable from the Lead's first turn.

### Launch order

- Running the whole squad is one action on the squad page: an optional goal and an optional Lead preset. The goal travels on the run request; the Lead preset is a field of the squad (`TeamDefinition.leadPreset`), so that choice survives the request, the page reload and the next device instead of dying with one run.
- The Lead preset picker offers only the ids `GET /state` reports under `presets`, and a preset the registry marks unusable is not offered. A deployment whose preset registry is absent or failing omits the field, and so does a registry with nothing usable left in it; the page then states the squad's own pin rather than an empty list.
- The launch order is the contract: the team's pinned workspace is validated, the Lead preset is resolved against the registry before any session exists, the session is renamed `<team name> / Lead`, and the squad run record is written before the first message is queued, so the Lead's own first assembly already knows which squad it leads.

### Team mode for the Lead

- The native service starts every new root session with Team mode off unless a deployment sets its own `defaultEnabled`, and a Lead without it opens with no task board and no team policy. This package makes no assumption about that default.
- The switch happens when the squad run record is durable, before the Lead's first message is queued: this package looks the Lead's live agent up and enables it with `agentTeams.setEnabled(agent, true)`. That timing is the contract, not a preference — the Host announces `agent/created` INSIDE session creation, before this package has a record to match, so an announce-time check can never see the run it just launched.
- The `agent/created` listener stays as the fallback for a Lead announced later (a resumed session, or a host that announces again). Both paths run the same switch, which touches only a ROOT session — one whose header carries no parent session — that the ledger records as a squad Lead. An ordinary session never matches, and a teammate is never a root, so no session the user opened has its own Team mode touched.
- A deployment that serves no `agentTeams` service keeps the ledger, the panel, member runs and the roster context, and loses only this automatic switch; the warning names the Lead that opened without the native board.

### What the Lead is told

- The roster and the goal reach the Lead as a `team:squad` system-prompt **context**, not a section, so a member preset that declares a `complete` section cannot drop them. This package registers it at order 125, between the subagent delegation context and the harness source, and holds that position itself instead of reading it from the Host's central table.
- One row per member carries the name, the preset, the permission stated as inherited from the Lead, the model and the member's full brief. The whole brief travels, never a summary: the Lead opens that member's spawn prompt with it verbatim.
- The same context states the spawn contract: `description` is the member name exactly as listed and becomes that teammate's label, `agent_preset` is the member preset id (like the model parameters, it appears only when this deployment offers a selectable preset list), `provider`, `model` and `reasoning_effort` carry the model pin, and `prompt` opens with the member brief, because a teammate's system prompt belongs to its preset and the brief can only travel in its first message. A pin this deployment cannot honour is stated in the Lead's reply instead of being dropped silently.
- It also states the board contract: one shared task per work item, `blockedBy` for dependencies, each teammate claims and finishes its own task, `send_message` steers a running teammate and `wait_agent` collects it.

### Permission is inherited

- A teammate's permission is captured from its parent session at the moment of delegation, and the native subagent tool has no permission parameter at all. A member's declared permission is therefore a statement the roster carries for a squad run, not a pin this package can apply to a teammate: the Lead must hold everything its members need.
- A member RUN is the other path — this package creates that session, so it applies the pinned permission through the host command dispatcher before the first message, and a refusal fails the run as `session-pin-failed`.

### Member briefs

- The `dsh-agents:member-brief` section resolves a member-run session's brief from the ledger at assemble time, so an edited brief reaches the next turn. It applies to member-run sessions only and is empty for every other session, which the Host drops.
- A teammate receives its brief through the Lead's spawn prompt instead, which is why `team:squad` carries every brief in full. This is a deliberate narrowing of the earlier fork, where a teammate's brief joined its system prompt: the native delegation surface carries no system-prompt seam for a child, so the brief travels as the opening of its first message. Re-deriving it as a section would mean matching every announced child back to a definition by label, which is possible but unproven — the current contract states the trade-off instead of hiding it.

### The live team view

- The page reads the Host's `subagentCatalog` projection out of the shared client session store: every direct child of the Lead session, as `{ id, createdAt, mode, label?, name? }`. The projection belongs to the deployment's subagent runtime, so reading it costs no request and no poll.
- A published catalog that carries no row yet reads as pending — the Lead has not started anyone — and a deployment that serves no session catalog reads as unavailable. Neither case polls.
- The Lead row is rendered from the squad's own `leadPreset`, because a catalog describes children only. A member row joins the catalog on the label, which is why the roster tells the Lead to set `description` to the member name, and a row that matches no definition keeps its label and states its pins as inherited.
- A row's status is the Host's own `running` flag when the session store reports one, and otherwise the mode the child was started under: `one-shot`, `continuable`, `external` or `unknown`. An `external` child runs outside this Host, so its row offers no session action at all; every other row keeps the action, disabled with a reason only when the deployment serves no opener. The `agentTeam` projection is not a member source — it carries the saved Team mode and the task board only, and its wire shape has no member row.

### Session entry points and run history

- The session entry points - a member card, a live roster row, a run-history row - read the GUI's session opener (`uiWorkspace`) and the shared session catalog (`sessions`) as OPTIONAL faces of other plugins, resolved live instead of once while the page mounts. While a deployment serves no opener the action stays visible, disabled, and states the reason; it enables itself the moment the workspace plugin or the session controller mounts, and disables again if that plugin unloads. A member that never ran never gets the action.
- Run history covers both kinds: squad runs with their Lead session and goal, and member runs with their member name and their open-session action, newest first and capped at the 200 records the Host keeps.
- The page turns every failure into one sentence: a transport failure reads as not-mounted, unauthorized, forbidden, timeout, unreachable or unexpected; a Host refusal keeps its own class for unknown-preset, no-workspace, squad-missing, lead-create-failed, lead-prepare-failed and ledger-unavailable; every other code reads as a plain rejection quoting the Host's bounded sentence.
- Run settlement is not observed here: a launched run stays `running` until a later milestone owns its outcome.

## Model-facing tools

Every session gets ten definition-management tools from the host half. They call `AgentsHostService` in process: no route is added, no HTTP request is made, and no business check is copied, so a tool call and the browser page drive one ledger through one set of rules.

| Tool | Input | Success value |
| --- | --- | --- |
| `squads_list` | `{}` | `{ ok: true, squads }` — every squad with its member count and a compact member roster |
| `squads_read` | `{ squadId }` | `{ ok: true, squad }` — the complete definition, member briefs and timestamps included |
| `squads_create` | `{ name, description?, workspaceId?, leadPreset?, members? }` | `{ ok: true, squad }` |
| `squads_update` | `{ squadId, name?, description?, workspaceId?, leadPreset? }` | `{ ok: true, squad }` |
| `squads_delete` | `{ squadId, confirm: true }` | `{ ok: true, deleted: { id, name } }` |
| `squad_member_add` | `{ squadId, name, preset?, permission?, model?, reasoningEffort?, brief? }` | `{ ok: true, squad, member }` |
| `squad_member_update` | `{ squadId, memberId, name?, preset?, permission?, model?, reasoningEffort?, brief? }` | `{ ok: true, squad, member }` |
| `squad_member_remove` | `{ squadId, memberId, confirm: true }` | `{ ok: true, deleted: { id, name, squadId } }` |
| `squads_run_member` | `{ squadId, memberId, firstMessage? }` | `{ ok: true, run }` |
| `squads_run_squad` | `{ squadId, goal? }` | `{ ok: true, run }` |

The two run tools launch through the methods the page uses — `AgentsHostService.run` and `AgentsHostService.runSquad` — so the launch order, the fail-closed pins and the run record are the page's as well. `squads_run_squad` takes a goal and nothing else: the goal reaches the Lead through the `team:squad` system-prompt context and is never folded into the first user message.

### Gating and announcement

- The tools register globally with `enabled`, the same shape the task board uses: one registration for the whole host, withdrawn when the setting is turned off. They are not installed only into the sessions a squad run opens.
- A separate `plugin:agents` system-prompt section announces them, at order 220 from the family's section table, behind the `announceToAgent` switch on this plugin's settings card (default `false`, volatile, no restart needed). The announced text is rendered through the family's `visibleToolText` helper, so it names only the tools that are actually visible to the session assembling the prompt: withdraw the setting, or restrict a tool in that scope, and the announcement goes with it.

### Destructive calls and partial updates

- `squads_delete` and `squad_member_remove` require `confirm: true`. Any other value answers `{ ok: false, code: 'invalid-request' }` before the ledger is touched, and a success carries the deleted object's name so the caller can report what it removed.
- `squads_update` and `squad_member_update` merge partially: an omitted field keeps its current value, an empty string clears that optional field, and `name` refuses an empty string. Changing one field never restates the rest.

### Tool surface versus the board tools

These ten are cross-session definition management, so every session sees them and none of them needs Team mode. The board tools — `team_task_create`, `team_task_list`, `team_task_get` and `team_task_update` — belong to the deployment's own Agent Teams row and are scoped by the native Team mode this package switches on for a squad Lead, which is also where the one shared task board comes from. `send_message`, `wait_agent` and `interrupt_agent` are the Host's own subagent coordination tools. This package mounts none of them itself, replaces no tool and disables no native one: an ordinary session keeps the native subagent surface untouched, and a squad Lead keeps the board its Team mode unlocks.

### Failure surface

A domain refusal is a value, not an exception: `{ ok: false, code, message }`, with `code` drawn from the package's own error codes — `invalid-request` for a malformed call, `team-not-found`, `member-not-found`, `preset-registry-unavailable`, `preset-unknown`, `preset-unavailable`, `workspace-unavailable`, `workspace-unknown`, `ledger-corrupt` and the rest. The tool surface adds no code of its own; only a failure this plugin did not raise is thrown.

## Install

```sh
pnpm add @linxin666/dsh-agents
```

Mount the row through a profile patch; the bundle ships one host-half row named exactly after the package.

## Config

- `enabled` (default `true`): mount the ledger, the routes, the model-facing tools, the member-brief section, the `team:squad` roster context and the Team-mode switch a squad Lead needs. When off, the row registers nothing, keeps no lock and registers no tool.
- `announceToAgent` (default `false`): add the `plugin:agents` announcement of the tool surface to agent system prompts. Volatile, so an edit binds the next prompt; left off, a prompt is untouched and an agent learns the tools from its own tool list alone.
- The ledger directory is `$DSH_HOME/dsh-agents`, resolved the way every plugin in this family resolves its own storage.
- The `announceToAgent` switch is on this plugin's settings card on the settings page, which writes the running config: toggling it applies without a restart. `enabled` is not on that card but on the bundle's profile row, so turning the plugin off means editing that row and reloading it; the card carries one read-only line saying so, together with what the master switch stops.

## Wire API

```text
GET  /dsh-agents/api/state
POST /dsh-agents/api/team
POST /dsh-agents/api/team/delete
POST /dsh-agents/api/member
POST /dsh-agents/api/member/delete
POST /dsh-agents/api/run
POST /dsh-agents/api/squad/run
POST /dsh-agents/api/describe
```

- The browser half drops the leading slash, exactly like the task board's prefix, and refreshes by polling `state` while the page is mounted.
- `state` also carries the workspaces and agent presets this Host offers (each omitted when it offers none), which is what turns the squad form's workspace and Lead-preset fields into pickers instead of typed ids.
- `describe` drafts one squad description with this deployment's own model route (the catalog default, else its first route) and answers only the text: a Host with no model service or no route refuses with a stable code, and the form falls back to a typed template rather than storing an empty description.
- Failures are JSON with a stable code and one bounded sentence; no stack trace, no ledger content and no session text crosses the wire.

## Storage

- One JSON ledger at `$DSH_HOME/dsh-agents/ledger.json`, written by an fsynced temporary file plus rename, owned by one pid through `ledger.json.lock`.
- An unreadable, corrupt or foreign-generation ledger is reported and left byte-identical: this plugin never resets, quarantines or overwrites a user's definitions.

## Security model

- The route fence refuses a cross-site marker, a non-loopback socket, and a request that carries no browser same-origin signal at all.
- Ids and timestamps are minted by the Host; a draft that carries an unknown field is refused rather than merged, so a caller cannot stamp its own row.
- A member brief is user-authored text: it reaches that member's own run session through the system prompt, and the Lead session of a whole-squad run through the `team:squad` roster context, which is where the Lead's spawn prompt takes it from. No other session sees it.

## Known limitations

- A workspace pin is optional: an unpinned team runs in the Host's default session directory, and a pin is never ignored — `workspace-unavailable` when this deployment serves no workspace registry to validate it against, and `workspace-unknown` when that registry does not list the pinned id.
- A pinned preset must be served by the host registry; an unknown or broken preset fails closed before any session exists.
- A preset that registers a `complete` system-prompt section owns the prompt alone, and the member brief is dropped; see [docs/member-prompt.md](docs/member-prompt.md) for that exception and the fallback design.
- The reasoning effort is sent only together with the model pin it belongs to, so a member that pins an effort without a model runs at the session default.
- Run history keeps the newest 200 records; older records are dropped with the definitions they referred to.
- A run started by a tool consumes the same API quota as one started from the page, and a squad run can start with no browser window open.
- The squad-run tool carries a goal but no first message, so a Lead that must begin from a user instruction is launched from the page; `squads_run_member` does take `firstMessage`.
- An agent that creates and runs definitions is spending quota on its own initiative: the tools are model-driven, and each run is a real session.
- `squads_create` with `members` is not one atomic write: every argument is validated first, then the call creates the squad and adds the members one at a time, so a squad holding only some of its members — the intermediate state — can appear only when a ledger write itself fails, a disk error for example. Calling `squad_member_add` again completes the squad.
- A member's declared permission binds a member run only. A teammate inherits its parent session's permission at the moment it is started, so a squad whose members need more than the Lead holds cannot get it from the definition.
- The live team view needs the deployment to publish `subagentCatalog` for the Lead session; a deployment that publishes none states the roster as unavailable, and the run history still works.

## Tests

```sh
pnpm --filter ./packages/dsh-agents test
pnpm --filter ./packages/dsh-agents typecheck
```
