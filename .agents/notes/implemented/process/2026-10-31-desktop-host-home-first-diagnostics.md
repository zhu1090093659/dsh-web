# Agent Note: Desktop-host repair starts from the live process's DSH_HOME

Status: implemented

## Problem

A 2026-10-31 repair session on a user's DeepSeek Harness desktop install fixed six symptoms in the wrong place before finding that none of the work could have taken effect. The application was reading `DSH_HOME=/Users/zcl/.dsh-trading` with the profile at `~/.dsh-trading/profiles/desktop`, while every edit — a reconstructed `settings.yaml`, a purged cookie jar's follow-up, patch rewrites, dependency installs — landed in `~/.dsh/profiles/desktop`. That second home looked authoritative: it carried the full 11 KB patch, five bundles and every model provider, while the live profile was a 1 KB stub with two bundles and no providers. The richer file was the wrong file, so each "fix" was inert, and the user reported "修复都没有生效" three times before the host's own argv identified the real home.

The same session then hit five further traps, each of which produced a plausible but wrong conclusion:

- **Per-home state.** Task-board and squad data live beside the home, not inside the profile: `task-board/ledger-v2.json` (2.0 MB, 390 tasks) and `dsh-agents/ledger.json` (3 teams) existed only under the unused home. Copying the profile into the live home made both plugins load, and they rendered empty boards from 190-byte and 70-byte ledgers at the new location. The user read that as data loss.
- **`settings.yaml` is legacy.** The store's `importLegacyDocument()` renames `profile.home/settings.yaml` to `.imported` and imports each section once into the owning entry's config; afterwards the entry config is the source of truth. Writing a `settings.yaml` into the profile directory repairs nothing because nothing reads it.
- **Patch layers merge by id.** A top-level `- id:` entry only overrides a row that already exists in the composed tree; a new id is dropped with `patch: entry "<id>" not found`. New rows belong in an `- insert:` block. The profile already documented this trap in its own comment, and the session still had to run `--dump-config` to see six entries dropped.
- **Duplicate ids in two layers.** Moving a dropped entry into `insert:` while the same id already lived in an existing `insert:` block produced duplicate rows, which had to be rolled back to a clean backup and redone.
- **Cookie accumulation blocks boot.** The shell mints one `dsh-auth-*` cookie per launch against `127.0.0.1` and prunes none; 71 had accumulated, the welcome handshake answered non-2xx, and startup aborted with `desktop welcome: Web authentication failed`. Purging them restores boot and simultaneously ends the account session, so the user must sign in again — a cost the repair must state, not discover.

## Decision

A desktop-host repair reads identity from the live process before touching any file, and treats configuration and state as separate artifacts of one home.

- **Locate the host first.** `ps eww -p <host pid>` yields `DSH_HOME`; the argv of the `--expose-internals` host child names the profile directory. Both are read before the first edit, and no path is inferred from a default `~/.dsh`.
- **Edits land in the live home only.** The profile patch, `package.json`, dependencies and any settings write target the profile the running host named. A richer profile elsewhere on disk is evidence about a different install, never a reason to prefer it.
- **Configuration and state migrate together, with the app stopped.** Copying a profile restores plugins; the ledgers beside the home restore the data those plugins render. Migration backs up the destination, removes the stale `.lock`, compares `schemaVersion`, and runs only while the host is stopped, because the ledgers admit a single writer.
- **`settings.yaml` is never the repair target.** In this generation it is imported once and renamed; provider profiles belong in the owning entry's config.
- **Patch repairs are verified by composition, not by reading the patch.** An isolated copy of the profile under a scratch `DSH_HOME` with a renamed profile plus `--dump-config` lists dropped entries and name mismatches; the app refuses `--dump-config` for its own managed profile, so the copy is the only way to see the composed tree.
- **A cookie purge is a boot unblock with a stated price.** It is the step that gets a wedged welcome handshake moving, and it logs the account out; the user is told before, not after.

## Diagnosing the composed profile

`--dump-config` writes YAML to stdout and warnings to stderr, which is what makes the difference between a patch that parses and a patch that applies:

```
dsh: [...] patch: entry "llm-verifier" not found
dsh: [...] patch: name mismatch for "web-ui-session-archive"
        (expected "@linxin666/dsh-session-archive",
         got "@linxin666/dsh-web-all/session-archive"), skipping
dsh: [...] patch: entry "magpie-mcp-codegraph" not found
```

The same run proves a merged entry kept its payload: the `llm-pi-ai` row appeared in the dump with all three providers and nine models, which ruled out the missing-config hypothesis and moved the search to the home.

## Alternatives considered

**Edit the profile that looks current.** Rejected: the fuller patch under `~/.dsh` belonged to an install the app was not reading. Preference by richness cost the session its first three repair attempts and produced two false conclusions (models "deleted", plugins "removed") from intact files.

**Reconstruct `settings.yaml` from the patch's provider block.** Rejected: it is a legacy import path. The file is renamed on next boot and its sections folded into entry config, so the reconstruction cannot take effect; the schema was even verified correct against the plugin README, which made the inert result look like a schema problem.

**Copy the profile and let the plugins re-create state.** Rejected: the task board and squad ledgers are not derived, and the app answered with empty boards that read as data loss. State travels with the home.

**Migrate ledgers without stopping the host.** Rejected: both ledgers hold a single-writer lock, so a write from the running host overwrites the restored file while the copy is still in flight.

**Insert every dropped entry into a new block.** Rejected: two of them already had live `insert:` rows with the same id, so the first attempt produced duplicates. The correct repair deleted the redundant top-level copies instead.

**Restore the backed-up cookie jar to undo the sign-out.** Rejected: it reintroduces the 71 stale cookies whose handshake failure blocked startup, trading a working boot for a saved login.

## Consequences

- The repair verified by composition and by data: `--dump-config` warnings went from six to none, the composed tree grew to 2725 lines, and the live home answered with task-board `revision 3966` / 390 tasks and squads `revision 20` / 3 teams after relaunch.
- Six patch entries were resolved differently by kind: two deprecated ids (`llm-verifier`, `im-qqbot`) were deleted rather than installed; one name was corrected to the package's real name; one top-level duplicate was removed in favour of its existing `insert:` row; two were moved into `insert:`.
- Two homes now hold parallel data (`~/.dsh` and `~/.dsh-trading`, sessions and attachments in both). The repair did not merge them; choosing one home for the desktop app remains open, and this note records the split rather than a resolution.
- The cookie accumulation is an upstream defect with no local fix inside the signed bundle: `ElectronAsarIntegrity` and the hardened runtime reject both `app.asar` edits and `NODE_OPTIONS` injection (`node_main.cc:154` disables Node environment variables for processes invoked by other apps). A user-level script re-purges the jar before launch; the defect itself needs a shell fix.
- The home-first rule is the same family as [probing a shared DSH home isolates its own home](../process/2026-10-02-shared-dsh-home-probe-isolation.md): that note keeps probes out of the user's home, this one keeps repairs inside the right one. Both fail the same way when a path is assumed rather than read.
