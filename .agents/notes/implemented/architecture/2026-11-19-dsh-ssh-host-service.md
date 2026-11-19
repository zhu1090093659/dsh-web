# Agent Note: dsh-ssh publishes a host service for sibling plugins

Status: implemented

This note implements Seam 1 of [the Task Board SSH provider proposal](../../proposed/feature/2026-11-19-task-board-ssh-remote-execution.md). The consumer that motivated it — a provider that runs board cards on remote hosts — reaches them through this service; the board-side seam is [Task Board external provider extension contract](2026-09-30-task-board-extension-contract.md).

## Problem

`dsh-ssh` owned every SSH capability in the process and offered none of it to another plugin: `apply` injected `webServer`, `tools` and `systemPrompt` and provided nothing. A second plugin that needs to run a command, move a file or read the operator's host list had three bad options — import this package's internals (cross-package coupling the family rules keep closed), build a second pool and a second reading of `~/.dsh/dsh-ssh.json` (two truth sources for one inventory, two sets of credentials in memory, and a host edited in one place staying stale in the other), or shell out to `ssh(1)`, which shares neither the stored credentials nor the jump-host and ProxyCommand chain the operator configured.

The proposal needs exactly one such consumer: a provider that starts agents on remote hosts, moves a git bundle to them and reads their logs back. Scoping the seam to that consumer would have put provider vocabulary inside `dsh-ssh`; leaving it out would have made every future consumer repeat the second-pool mistake.

## Decision

The host half publishes one cordis service, `dshSsh`, under `DSH_SSH_API_VERSION = 1`. It is a thin forwarder over the single `SshEngine` instance that the routes, the web terminal, the `ssh_*` tools and the panel already share.

1. **Face**: `apiVersion`, `hosts.list()`, `hosts.find(alias)`, `exec(alias, command, { timeoutMs, signal })`, `upload(alias, localPath, remotePath)`, `download(alias, remotePath, localPath)`. `exec` takes its ceiling and cancellation as one options object while the engine's parameters are positional; every other member is argument-for-argument the engine method. No member carries logic — no gate, no cache, no state — so a consumer is refused by exactly what refuses the GUI and the tools, and one settings edit reaches all of them at once.
2. **Contract file**: `packages/dsh-ssh/src/service.ts` holds the service name, the version constant, every type and the `declare module` augmentation, and imports nothing. A consuming package restates it verbatim and resolves the name at runtime, so two packages share one shape without sharing a module — the arrangement the board's provider contract uses in the opposite direction.
3. **Secret-free projection**: `hosts.*` returns the fields `SshHostSummary` already publishes, minus `proxyCommand`. That value is a shell line the host process executes with its own privileges (the agent tools project it to a boolean for the same reason), and passwords, key passphrases, private-key paths and agent endpoints never enter the shape at all.
4. **No streaming member**: the motivating consumer must replay a log after the local host was offline, and that can only come from a remote file it reads by offset through `exec`. A streaming exec would have to buffer, persist and re-serve the same bytes to answer the same question, so the seam stays poll-and-offset.
5. **Lifecycle**: `ctx.provide` runs inside `sync()`, beside the routes, tools and prompt section, and its disposer runs before theirs on every re-derive. The service therefore exists exactly while the master switch is on: turning the switch off, or unloading the plugin, unprovides it, and cordis unloads every dependent's inject scope before this instance registers anything else. A hand-built context without a cordis registry (the settings-surface tests, a degraded mount) keeps serving its own surfaces and provides no service.
6. **One face for every consumer**: the plugin learns no provider vocabulary, and a consumer cannot register a special case in it.

## Context & Efficiency Impact

The seam adds one import-free type module, one factory of five one-line forwards, and one disposer variable. It costs nothing while no consumer injects it: no timer, no route, no tool, no prompt text. A consumer saves a second connection pool per host and a second reading of the credential file — the alternative it replaces.

## Alternatives considered

**Let the consumer import `SshEngine` and `HostStore` directly.** Rejected: it is a value import across a package boundary the family rules keep closed, it would pin the engine's constructor shape as a public contract, and it would let a consumer act while the user has the plugin switched off.

**Publish the raw `SshHostSummary`, ProxyCommand included.** Rejected: that text is a shell command the host process runs with its privileges, and a consumer that never executes it has no use for it. The projection is the boundary, so the published type names no `proxyCommand` member at all instead of documenting one "for internal use".

**Register the service unconditionally, independent of the master switch.** Rejected: a disabled plugin that still hands out exec makes the switch a lie — the user turns SSH off and another plugin keeps running commands on their servers. The service is one more surface that switch governs.

**One narrower service per capability (a host-list service plus an exec service).** Rejected: two provision sites to keep on one lifecycle, two versions to carry, and a consumer needing both would inject both. One face with five members is smaller than two faces.

**Expose the terminal, tunnels, cluster runs, directory listing and transfer progress too.** Rejected: the motivating consumer needs commands, transfers and the inventory, and every extra member becomes a contract nobody can remove later.

## Consequences

- **A sibling plugin can now execute commands on the operator's hosts.** The trust boundary is the host process: any plugin loaded into it reaches every configured host with the same reach as the `ssh_*` tools, and there is no per-consumer permission. The package `AGENTS.md` and both package READMEs state it.
- **The master switch now unloads a dependent.** Turning SSH off releases the consumer's inject scope mid-session, so a consumer must be written to load and unload rather than resolve the face once at activation, and it must treat "no service" as "nothing of mine runs".
- **The contract is a compatibility surface.** Adding a member is additive at the same version; changing or removing one needs a new `DSH_SSH_API_VERSION` and a consumer-side check, because a consumer restates the types and sees no compiler error from an edit in this package.
- **`upload` moves one file.** The recursive directory walk, the progress stream and the staging-file lifecycle stay behind the plugin's own route and tools, and a directory is refused by the engine rather than walked silently.
- **Coverage**: `packages/dsh-ssh/tests/service.test.ts` drives a real cordis registry. A dependent mounted with `ctx.inject(['dshSsh'], ...)` reads the inventory, runs a command against the embedded ssh2 server, uploads, reads and downloads against a real sshd, and loses the service both ways (master switch, unload). A field-by-field case pins the projection: the exact public key set, no private field present, and no secret or ProxyCommand text in the serialized face, while the store's own projection still carries that text.
