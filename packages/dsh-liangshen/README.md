# dsh-liangshen — LiangShen Mode (two-phase anchored-standard agent preset)

English | [中文](README.zh.md)

Ships the "Anchored Standard" preset as a one-command plugin of the dsh-web-ui family: on host startup it syncs the bundled preset into `~/.dsh/.agent-presets`, so new sessions can pick "梁神模式" from the preset picker. The first model request sees only the builtin Minimal preset's exact two tools — persistent `bash` plus `str_replace_editor` — only the one-line persona prompt section, no runtime contexts, and no injected instructions; after the anchor is established the wire switches to Code Mode (PTC) and the ordinary injections open. Built entirely on the official NPM SDK — no dsh source changes.

## Why

DeepSeek V4 Pro conditions strongly on the API tool catalog visible in the FIRST request when choosing its execution trajectory. In the community eval ([xiaobright/modeltest](https://github.com/xiaobright/modeltest)), Standard / PTC scored 91/92 while Minimal reached 99/96 — but Minimal keeps only two tools. This two-phase approach separates the first-trajectory choice from full later capability:

1. The first model request exposes only the builtin Minimal preset's exact two tools (persistent `bash` plus `str_replace_editor`), keeps only the `deployment:persona` prompt section, empties runtime contexts, and passes only the user's own messages;
2. After the session's first durable `tool/call`, promotion waits until the first reasoning block is minimal-like (contains `we` and no `let me`), with a four-step fallback; the wire then switches to Code Mode (PTC) — a single `run_code` tool backed by the full tool registry SDK — and every assembled prompt section plus the ordinary workspace-instruction, skill-catalog, and runtime-context injections return;
3. The phase derives from persisted session events, so resume / reload never lose state.

Measured on native Windows (DeepSeek V4 Pro, max, V4.1b task): 98 / 99, mean 98.5, zero `let me` traces in the second run — reproducible, not a lucky draw, and no tool capability sacrificed. Original experiment: [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard).

## Stabilization controls

The preset ships with extra safeguards on top of the reference mechanism, all configured in `agent.cordis.yml` under `tool-bootstrap`:

- `anchorGate` — after the first `tool/call`, the catalog stays two-tool until the first reasoning block classifies minimal-like, so a `Let me` first block does not immediately earn the full catalog;
- `maxBootstrapSteps` — fallback promotion after N steps when no anchored block appeared;
- `promoteAfterFirstResponse` — a tool-less first response promotes once it has responded; an anchor-gated session also releases when its first turn ends (`turn/end`), so the next user turn already sees the promoted catalog;
- `promotedPresentation: code` — after promotion the wire is Code Mode (PTC): one `run_code` tool with the full registry available through the generated SDK, switched at the step boundary so the current step's native calls are never interrupted;
- `deferredSources` + `deferredGraceSteps` — workspace instructions and the skill catalog wait one extra step after promotion, so the tool-catalog switch and the injection shock do not land in the same step;
- `bootstrapMaxTokens` — caps the phase-1 request output budget (community measurements put `max_tokens=1024` in the high-hit "We need" window, versus 0/5 at the 256k DSH default), and the cap is stripped again after promotion so `requestProposal` never solders 1024 into every later request;
- `phase1FirstCallInstruction` — an opt-in extra line appended to the phase-1 persona, off by default: test builds use it to ask the model to ground its first answer with one Minimal-native tool call before responding, so first-turn capability questions are answered from the promoted registry instead of the cropped two-tool view. It deviates from the byte-exact Minimal surface, which is why it ships unset.

Plan mode is supported: phase 1 filters the assembled prompt sections down to the one-line `deployment:persona`, and promotion restores all sections and appends the session's working directory to the persona, so the agent knows its workspace and the plan-mode `plan:policy` section takes effect for every step after promotion.

## Install

```sh
# Option 1: family bundle (recommended)
dsh plugin --profile web add @linxin666/dsh-web-ui-all

# Option 2: standalone
dsh plugin --profile web add @linxin666/dsh-liangshen

# Pick ONE of the two: the bundle and the standalone @linxin666/dsh-liangshen
# both mount this preset. If you switch between them, remove the other first:
dsh plugin --profile web remove @linxin666/dsh-liangshen
```

Fully restart `dsh web`, open a NEW empty session, and pick "梁神模式" as the preset. The plugin syncs the presets into `~/.dsh/.agent-presets` at startup (upgrades refresh them automatically on next restart).

## Verify

Export the session JSONL and inspect `request/header`:

- The first header should carry only `bash/str_replace_editor` (the persistent shell plus the sandboxed editor);
- The first turn should contain only the user's own messages — no workspace-instruction baseline, no runtime snapshot, no skill-catalog message — and only the `deployment:persona` prompt section;
- After the first tool call, the next changed header should carry exactly `run_code` (PTC); the runtime snapshot and all prompt sections arrive with that step (including plan mode's `plan:policy`, and the persona now ends with the selected workspace path), and the workspace instructions and skill catalog arrive one step later;
- Phase-1 editor writes obey the host file sandbox policy — there is no bare local-filesystem bypass;
- Later requests keep `run_code`.

Trajectory drift can be measured without reading raw reasoning:

```sh
node tools/analyze-session.mjs ~/.dsh/sessions/<workspace>/<session>/session.jsonl
```

## Behavior and limits

- A first model response that calls no tool promotes once it has responded; an anchor-gated session also releases when its first turn ends (`turn/end`). The release is decided during prompt assembly, so the new user turn already gets the promoted PTC catalog and its messages are not stripped;
- After the first tool call, promotion waits for the first minimal-like reasoning block or the `maxBootstrapSteps` fallback, whichever comes first;
- A tool call that fails still counts toward promotion as long as `tool/call` was persisted;
- Phase 1 keeps only the `deployment:persona` prompt section; promotion restores every assembled section and appends the session's working directory (`Your working directory is <cwd>.`) to the persona, so the agent works in the selected workspace and plan mode's `plan:policy` is enforced after phase 1;
- Workspace instructions, the skill catalog, and the runtime snapshot stay out of phase 1; the snapshot returns with the catalog and the other two arrive one step later;
- Phase-1 file tools inherit the host file sandbox (no bare `dsh-fs-local` filesystem);
- The phase-1 persistent `bash` replaces the Standard ephemeral shell for the whole session (both tools register the name `bash`);
- Phase 1 shows the two Minimal tools by design, so a first-turn capability question (for example "can you browse the web") can be answered from the cropped view and then corrected after promotion; the opt-in `phase1FirstCallInstruction` (see Stabilization controls) asks for a grounding tool call first, and otherwise task-style first turns avoid the mismatch;
- The catalog changes exactly once, so a prefix-cache change happens between the first and second request;
- The preset carries the same trust level as shell access — review `presets/liangshen/` before installing;
- The plugin makes no network requests and adds no telemetry;
- Do not switch presets mid-conversation;
- Requires DSH 0.1.0-rc.5+ (preset mechanism and the `system-prompt/assemble` hook).

## License

Plugin body Apache-2.0 (zhu1090093659). `presets/liangshen/agent.cordis.yml` derives from the DeepSeek Harness builtin Minimal and Standard presets, and `tool-bootstrap.mjs` comes from xiaobright/dsh-anchored-standard — all MIT, with copyright and license notices kept in the preset's `NOTICE`.
