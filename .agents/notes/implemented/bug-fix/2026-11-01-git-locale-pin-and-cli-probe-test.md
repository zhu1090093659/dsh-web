# Agent Note: Host-dependent gates: the git overwrite guard's locale and the CLI probe test

Status: implemented
Superseded by: [the dsh-git-graph package is retired in favour of the official Git changes plugin](../simplification/2026-11-03-git-graph-package-retired.md)

## Problem

Two gates in this repository depended on the machine they ran on rather than on the code under test.

The first is a product defect. The git-graph write verbs classify a failed git command by matching its stderr prose: `packages/dsh-git-graph/src/core/git-command.ts` holds the pattern table that turns "The following untracked working tree files would be overwritten by checkout" into the `untracked-changes-would-be-overwritten` guard and extracts the blocked paths the UI names in its message. git localizes that prose to the host locale, so on a host running `LANG=zh_CN.UTF-8` the refusal arrives as Chinese text, matches no pattern, and is classified `internal`: the user gets the generic failure instead of the guard that names the files blocking the switch, on exactly the hosts where that guard is the only useful message. The dependence showed up as a machine-dependent red in the suite — `tests/git-service.spec.ts > classifies an untracked-file overwrite with the blocked paths` failed on this host and passed under `LC_ALL=C` with the same git binary (2.53.0) — because the spec's plain `execFile` runner inherited the host environment, which is also what the production path did: the official subprocess service merges the ambient environment unless the caller overrides it.

The second is a test that read the host. `packages/dsh-plugin-manager/tests/gateway.spec.ts > dshSpawnCommand > keeps the binary as-is off Windows` asserted that `/usr/local/bin/dsh` spawns as-is, but the production probe is a shebang read of that path: on a machine with dsh installed there, the path is a symlink to the packaged `lib/bin.js` and the command resolves to `node` plus the script. The expectation was true only on a machine without dsh at that path.

## Decision

Every git child dsh-git-graph spawns runs under `GIT_CHILD_ENV = { LC_ALL: 'C', LANG: 'C' }`, declared in `host/git-runner.ts` and passed as the `env` field of the spawn spec. `LC_ALL` is the override that wins over every other locale variable and `LANG` covers a child whose environment drops it; nothing else needs pinning because only the message catalogue is at stake. The pin lives in the runner rather than in the classifier: the patterns stay written against git's English strings, and the process that has to produce them is the one that carries the locale. It is a deliberate exception to the service's ambient environment, not a general locale policy for the plugin — a child whose output is not matched as prose has no reason to lose the user's locale.

`tests/git-service.spec.ts`'s stand-in runner passes the same `GIT_CHILD_ENV`, so the classification is exercised against the prose the host really receives, and `tests/git-runner.spec.ts` asserts that the spawn spec carries the pin.

The CLI probe test injects the shebang probe the API already exposes (`readHead`) instead of letting the default one read the host's own file, and two cases are added for the branch that bit it: a Node-script CLI runs through the `node` beside it, and falls back to `process.execPath` when no sibling `node` exists. Production behavior is unchanged — a Node-script CLI is still run through an interpreter, which is what the package's own rule requires.

`host/git-runner.ts` also carries a corrected header: it stopped being a synced copy when the single-consumer shared modules were consolidated (927268192), and the old text told the next editor to edit a `shared/` source that no longer exists.

## Alternatives considered

**Match the localized messages as well.** Rejected: a translation catalogue is not a contract — every locale would need its own pattern, the blocked-path extraction reads the list formatting too, and a new git release may reword any of them.

**Pre-check the condition instead of reading the refusal** (for example by comparing `git status --porcelain` against the target tree). Rejected: it re-implements git's own check, and git's verdict is what the user's switch actually hits; a pre-check that disagrees either blocks a switch git would allow or lets one through that git then refuses with the same unparsed message.

**Set the locale in the plugin process itself** (`process.env.LC_ALL = 'C'`). Rejected: it changes the whole host process's locale — dates, sorting and every other child — which is not this plugin's to decide.

**Pin only production and leave the spec's runner ambient.** Rejected: that spec is the only place the patterns meet a real git, so it has to receive the environment the host does; leaving it ambient keeps a machine-dependent test that fails on non-English hosts for a reason unrelated to the change under test.

**Keep the CLI probe test reading the host and pick a path dsh never occupies.** Rejected: it hides the coupling instead of removing it, and the fixture would have to be re-chosen on the next machine layout.

## Consequences

- The guard messages are stable on every host, and the suite no longer depends on the host locale: the previously red case passes under `zh_CN.UTF-8` without `LC_ALL=C`.
- Git children see `LC_ALL=C`, so any git stderr the plugin ever surfaces is English even on a localized host. The plugin surfaces git's own text only through the classified guard messages, which are the English-anchored ones by construction.
- The pin is invisible to the subprocess service's environment scrubbing: `env` entries merge onto its scrubbed parent base, so nothing else about the child's environment changes.
- The CLI probe tests no longer depend on the host's own installation layout; the two added cases pin the POSIX Node-script branch that the old fixture never covered.

## Testing

- `tests/git-runner.spec.ts` asserts the spawn spec's `env` is `{ LC_ALL: 'C', LANG: 'C' }` on the default argv path.
- `tests/git-service.spec.ts` passes 30/30 with the machine's own `LANG=zh_CN.UTF-8`: the overwrite classification reads the English refusal the child is pinned to. Before the change the same file was 29/30 on this host and 30/30 under `LC_ALL=C`.
- The full workspace suite passes under the host's own `LANG=zh_CN.UTF-8` (33s): the two previously red cases are gone, and `pnpm test:standards` reports no file gained violations from the two new cases.
- `packages/dsh-plugin-manager` passes 459 tests over 32 files, including the two new POSIX cases, and its typecheck passes.
- `packages/dsh-git-graph` passes 192 tests over 14 files; its typecheck still reports the documented host-SDK-pin slot-name errors in `src/client/chips/BranchChip.tsx` and none in the files this change touches.
