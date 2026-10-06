# Agent Note: the plugin update gate reads the running DSH from its own manifest

Status: implemented

## Problem

On the packaged DSH Desktop client, the Plugins page's "Check for updates" block judged **every** plugin that declares a `dsh.engines.dsh` floor as incompatible, showing "Requires DSH >= X; upgrade DSH before updating" and disabling the update button, even when the running DSH satisfied that floor exactly (#1819). The reported host ran DSH `0.2.0-rc.2` and the offered release required `>=0.2.0-rc.2`.

The version gate itself was right; the host simply could not answer it. `probeDshVersion` returned undefined whenever `cliAvailable()` was false, and `cliAvailable()` is `findDshBinary() !== null`. On a packaged Desktop install all three then-existing candidates miss:

- `dsh.cmd` / `dsh` on PATH: the launcher prepends only `<resources>/runtime/bin` to the host it spawns, and that directory carries `node` alone; the CLI launcher lives in the sibling `<resources>/runtime/cli/bin`;
- `node_modules/.bin` above the host entry: the installer strips every `.bin` directory (symlinked shims cannot survive an installer), and the host entry is inside `app.asar` anyway;
- `<packageRoot>/lib/bin.js`: the private host package ships `lib/index.js` and `lib/cli.js` only.

`compatibleVerdict` then fail-closed an unverifiable requirement into "incompatible", and the client rendered that as an instruction to upgrade the host — sending the user after a fix the host had never shown was needed.

## Decision

**The running version is read in process, and "unverified" is a distinct verdict from "too low".**

1. `resolveDshVersion` reads the `version` of the installation's own `@deepseek-ai/dsh` manifest first. The official runtime publishes that manifest path as `profileContext.installAnchor` (the same fact the official plugin manager reads to decide removability), and the gateway now accepts it through `launchedInstallAnchor`, which validates it as an absolute, traversal-free path before anything reads a version out of it. It is a local file read: no subprocess, no PATH, nothing to go stale mid-run, so it is re-read per resolution and never cached.
2. `dsh --version` stays as the fallback for a runtime that publishes no anchor (or one whose manifest cannot be read). The probe keeps its TTL/cooldown caching, which now only ever governs the fallback path.
3. `findDshBinary` gains the packaged Desktop candidate: `<resources>/runtime/cli/bin/dsh.cmd` (Windows) or `.../dsh` elsewhere, where the resource root comes from `process.resourcesPath` or, failing that, from the first ancestor of the running host entry named `resources` (case-insensitively, for macOS's `Resources`). This fixes CLI-backed writes on that host too, not just the version probe — the same discovery serves both.
4. The check-updates row carries `hostVersion` whenever the host managed to read one. Its absence is what the browser renders as "cannot confirm the local DSH version"; its presence with `compatible: false` renders the upgrade instruction. A new `updateUnverifiedDsh` key (zh/en, plus the centralized ru dictionary) carries that copy, and both surfaces expose `data-update-compat-reason` / `data-update-row-compat-reason` so the distinction is assertable.

## Alternatives considered

- **Only add the Desktop CLI path candidate (#1819's first suggestion).** Rejected as the primary fix: it repairs discovery but leaves the version gate depending on spawning a process to answer a question the process already knows, and it would still report "upgrade DSH" for any host whose CLI is missing for a different reason. It is kept as a genuine second fix for the write path.
- **Read the anchor without validating it.** Rejected: it arrives from outside this package on a context service, like the profile directory and patch path, and every published fact this package consumes is validated before use.
- **Cache the in-process version like the CLI probe.** Rejected: a file read costs nothing to repeat, and caching it would make a long-lived host answer with a version it no longer runs if the installation is replaced underneath it.
- **Treat an unverifiable requirement as compatible (fail open).** Rejected: #754 deliberately fails closed so an update can never run against a runtime the host cannot prove compatible. The defect was the wording, not the verdict — so the verdict stands and the copy is split.
- **Say nothing about the requirement when it is unverifiable.** Rejected: the row is still blocked, and a disabled button with no explanation is worse than one that says the version could not be confirmed.

## Consequences

- A packaged Desktop host resolves the compatibility gate with no CLI at all; a host that does have one still resolves it in process rather than by spawning, so the check is faster on every runtime.
- `findDshBinary` now finds the Desktop CLI launcher, so installs, updates and removals also work through the CLI path where they previously reported "dsh CLI not found on PATH".
- The wire contract grew `hostVersion` on update rows; `parseUpdateList` validates it as a string and drops nothing when it is absent, so an older host's rows still parse.
- A runtime that publishes neither an anchor nor a reachable CLI still blocks declared requirements, but now says so accurately.
- PATH keeps priority over the Desktop candidate, so a user's own `dsh` is never shadowed.

## Testing

- `packages/dsh-plugin-manager/tests/gateway.spec.ts`: Desktop CLI discovery from `resourcesPath`, from the host entry alone (macOS capitalized `Resources`), PATH precedence over it, and no candidate invented from an unrelated `resources` directory.
- `packages/dsh-plugin-manager/tests/update-route.spec.ts`: an update allowed from the install anchor with `cliAvailable()` false and no version seam; the same host blocked when the anchor declares a genuinely older DSH (naming the version it read); the check-updates row carrying `hostVersion`; and the row omitting it when neither source can answer. The unverifiable-requirement 412 message no longer names `dsh --version`.
- `packages/dsh-plugin-manager/tests/PluginUpdatePatch.spec.tsx`: a blocked row with a host version renders the upgrade copy, and one without renders the unverified copy instead — asserting the negative, so the old misleading string cannot come back.
- Gates run for the change: the package `typecheck` and `vitest run` (320 tests), `pnpm docs:write-pair packages/dsh-plugin-manager`, and the repository baseline (`pnpm typecheck`, `pnpm test`, `pnpm test:scripts`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm emoji:check`, `pnpm test:standards`).
