# Agent Note: LiangShen shell and paging make PTC the executed surface

Status: implemented

Partially supersedes [LiangShen mode native rebuild for DeepSeek V4.1 Flash](2026-09-16-liangshen-v41-flash-native-rebuild.md) on the win32 shell and on what gentle paging does: the preset-local Git Bash `bash` tool is retired in favor of the upstream pwsh twin of the persistent shell stack, and paging stops editing the assembled wire in favor of a scoped tool restriction, which is the only edit that reaches the executed surface under `ptc`. The one-presentation-per-session decision, the `ptc` default, the injected catalog, the message-source decision, and the persona discipline all still hold.

## Problem

Two shipped mechanisms did not do what their documentation said.

The preset declared one presentation for the session's whole lifetime and shipped `presentation: 'ptc'` as the default, so the wire carries `run_code` alone. Gentle paging was applied by editing the `tools` array a `system-prompt/assemble` pass returns. That edit is invisible under `ptc`: a `run_code` program reaches tools through the scope's visible registry, and the `tools:sdk` prompt section renders from that same visible set, so a namespace held off the wire stayed callable inside a program while its schema stayed in every request. The capability was not saved and the static context was not saved — only the catalog entry changed. `maxResidentTokens` measured the assembled wire, so it could not fire on the surface that actually carries the schemas, and the catalog's inactive-namespace summary was suppressed under `ptc`, so the model could not even see that namespaces existed.

Separately, the preset's win32 shell was a local transplant: because the persistent PTY group is disabled on win32, the preset shipped `custom-bash.mjs`, which ran each command in a fresh Git Bash subprocess over the ordinary subprocess seam. Shell state did not survive a call, the path had no OS sandbox confinement, and the persona carried a win32-only discipline line telling the model to chain its work into single commands. The premise behind the transplant — that the PTY backend is Linux/Darwin-only — is false: the upstream `pwsh` persistent tool is the intended win32 counterpart, and the builtin Minimal preset already mounts it behind a `shellDialect: pwsh` terminal-bash row.

## Decision

The preset mounts the upstream shell stack on both platforms and applies paging through the scoped restriction API.

- The shell section mirrors the builtin Minimal preset: the `persistent-shell` group is mounted on every platform, the bash half (`terminal-bash`, `persistent-bash`) is disabled on win32, and its pwsh twin (`terminal-bash` with `shellDialect: pwsh`, plus `tool-pwsh-persistent`) is disabled everywhere else, so each host mounts exactly one shell tool — `bash` on POSIX, `pwsh` on win32 — and shell state survives across calls on both. `custom-bash.mjs`, its test, its preset row, and the win32 persona discipline line are removed; the preset ships no shell implementation of its own.
- Gentle paging is applied as a scoped tool restriction (`agent.ctx.tools.restrict({ deny })`) instead of an assembly edit, so a paged-out namespace leaves the scope's visible set: its tools are no longer reachable from inside a `run_code` program and its declarations leave the `tools:sdk` section, which is what makes the catalog's promise true under every presentation. The restriction is released exactly when the namespace is activated and re-applied when LRU eviction pages it back out; a restriction failure is reported and leaves the session with the native surface rather than a broken one. The page is installed OUTSIDE the assembly waterfall — at scope creation, session start, and after each tool call — because `SystemPrompt.assemble()` both renders every prompt section and collects the tool providers before the waterfall runs, so a restriction installed inside it would land one request late and leave a request whose catalog claims a namespace is paged while its own `tools:sdk` section still lists it.
- Because paging now removes schemas from the request, `maxResidentTokens` measures a surface that actually shrinks, and the catalog carries the paged-out namespace summary under `ptc` as it already did under `native` and `both`.
- Activation state still replays from the durable session event stream, so compaction and resume rebuild the same active set and the same restriction set without process memory.

## Alternatives considered

Leaving paging as an assembly filter and documenting that it is a catalog-only affordance under `ptc`. Rejected: it would have kept a capability claim (`mcp__*` tools held off the wire) that the executed surface contradicts, and the guard built on top of it could never fire.

Making every paged namespace resident in the SDK declarations while removing only the direct-call surface. Rejected: it preserves programmatic reach for held namespaces but keeps their schemas in every request, which is the cost paging exists to remove; the two objectives are in direct tension and the mode chose the reachable-subset contract instead.

Restoring paging through a preset-owned filter of the assembled wire plus a second filter of the SDK section. Rejected: it duplicates a host mechanism, and the host's own scoped restriction is per-agent, disposable, and already excludes the `run_code` transport from restriction.

Keeping `custom-bash.mjs` and merely documenting its limits. Rejected: the premise had been refuted, the tool shared the name `bash` with a different semantic (no state, no OS sandbox confinement), and the persona needed a platform-specific discipline line to compensate — three symptoms of one wrong shape.

Mounting the builtin PTC preset's one-shot `pwsh` row on win32 instead of the persistent twin. Rejected: the builtin Minimal preset's persistent stack is available on win32 and is strictly more capable; the one-shot row would have preserved the state-loss problem this decision removes.

## Consequences

The mode's win32 sessions now run PowerShell as their shell, which is a model-facing change: commands written for bash must become PowerShell, and the previous Git Bash fallback (`bashPath`, Git Bash discovery) no longer exists. Shell state now survives across calls on every platform, so the win32 chain-everything discipline line is gone with the constraint that motivated it.

Paging now costs one restriction toggle per activation and eviction, and a namespace that is paged out is genuinely unavailable inside a program until it is activated — a tool the model could previously reach without activating may now fail until it does, which is the intended contract rather than a regression.

The preset no longer carries any platform-specific persona text, so the system prompt is byte-identical across platforms for a given cwd.

## Testing

`tests/platform-guard.test.ts` evaluates the `!!js` gates against injected platforms rather than matching text, and asserts that the group itself carries no gate, that the two halves have exactly paired polarities, and that exactly one shell tool mounts per platform. `tests/minimal-prompt.test.ts` asserts the persona is identical on win32 and POSIX and that no platform branch remains in the source. The paging behavior is covered by the preset's catalog, activation, and paging suites.
