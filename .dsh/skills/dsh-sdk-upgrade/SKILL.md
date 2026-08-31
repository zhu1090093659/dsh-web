---
name: dsh-sdk-upgrade
description: Safely select and install a compatible official @deepseek-ai SDK release for dsh-web from npm using an isolated worktree, explicit cohort review, CI-equivalent validation, and controlled DSH Web rollout. Use for SDK dependency upgrades, official version checks, release-channel decisions, and runtime/repository cohort alignment. After the target is approved and installed, use dsh-web-sdk-compatibility for consumer adaptation, durable contracts, fixes, or new-feature adoption.
whenToUse: The user asks to choose, upgrade, update, or check the official DeepSeek Harness SDK packages used by dsh-web, including @deepseek-ai/dsh-*, @deepseek-ai/cordis, @deepseek-ai/cosmokit, or @deepseek-ai/schemastery. Use dsh-web-sdk-compatibility when versions are already approved and the task is to repair source/runtime compatibility or adopt target-SDK capabilities. Do not use for upgrading the DSH application/source checkout itself, releasing @linxin666 packages, or ordinary plugin feature work.
user-invocable: true
---

# dsh-web Official SDK Upgrade

Use this Skill only for the dsh-web monorepo. It selects and upgrades the repository's official npm SDK dependency cohort; it never modifies a DeepSeek Harness source checkout. After the target cohort is approved and installed, hand consumer analysis, source repair, compatibility contracts, and deliberate new-feature adoption to `dsh-web-sdk-compatibility`. For upgrading the DSH application itself, use dsh-upgrade instead. For publishing this monorepo, use dsh-web-release instead.

## Non-Negotiable Boundaries

- Use only official packages under the @deepseek-ai scope resolved from https://registry.npmjs.org/. The project .npmrc is the registry authority.
- Never modify a DSH source checkout, point TypeScript paths/references at one, copy SDK source into this repository, or replace official packages with local links.
- Never publish, tag, run pnpm publish/npm publish, create a GitHub Release, change @linxin666 package versions, or change the release pipeline as part of an SDK upgrade.
- Keep NPM_TOKEN only in the environment or the user-level npm configuration. Do not add it to a repository file, shell history, log, issue, or report.
- Load and obey dsh-parallel-dev before any Git, worktree, install, build, rebase, merge, cleanup, or staging operation. Its shared-worktree safety rules take precedence.
- Do not use git reset --hard, git clean, git checkout --, broad restore/stash, git add -A, force-push, or any operation that can overwrite another session's work.

## 1. Establish a Safe Base

1. Read the root AGENTS.md, packages/AGENTS.md, applicable package-level AGENTS.md files, and docs/development.md before deciding scope or validation.
2. Record git status --porcelain=v1 --branch, git rev-parse --show-toplevel, git worktree list, the current main tip, origin/main, and all ahead/behind state.
3. Fetch origin without changing a shared checkout. If local main is ahead, behind, dirty, or owned by another active task, do not discard or silently bypass it. Explain the base choices and obtain a decision on whether the upgrade is based on the current local main or the fetched origin/main.
4. Create one isolated task worktree and branch from the approved base. Use that worktree for every dependency mutation, install, generated artifact, test, and build. Do not run a repository-wide install or build in the shared checkout.
5. Keep this upgrade as one serial task. Do not delegate overlapping manifest, lockfile, or generated-artifact edits. Only one agent may integrate the finished branch into main.

## 2. Inventory Before Changing Anything

Build an explicit upgrade matrix from every workspace package.json and the root configuration. Include direct dependencies, devDependencies, peerDependencies, optionalDependencies, pnpm-lock.yaml, and pnpm-workspace.yaml. Also inventory the external npm plugins an aggregate pulls in (e.g. `packages/dsh-web-all`) and every `@deepseek-ai/*` peer they carry — they are easy to miss.

A cohort `overrides:` block in `pnpm-workspace.yaml` (used to pin a not-yet-published cohort to source-built tarballs) does double duty: it also force-resolves the `@deepseek-ai/*` peers of those external aggregate plugins. Deleting the block when the cohort reaches npm therefore unmasks external plugins hard-importing a now-removed SDK face, which fail the host loader's strict import resolution and abort `dsh web` boot. Inventory externals and their peers before dropping the block, so the compatibility phase can decide exclusion (drop the aggregate row + dep + generator/mount assertions together) instead of discovering the abort at release time.

For each relevant official package, record:

- package name, manifest locations, dependency kind, declared range, resolved lockfile version, and consumers;
- official npm dist-tags, latest stable version, prerelease tags, publish date, engines, peerDependencies, and dependency requirements;
- the intended target version and the evidence that it is compatible with every coupled package.

Treat @deepseek-ai/dsh-* as a release family. The approved SDK cohort must match the release line of the actual DSH runtime that will host this repository's plugins. Before choosing targets, resolve the active dsh executable and record its version and profile dependency tree. If npm offers a newer SDK cohort than the active runtime, do not let the plugin SDK lead the host: upgrade the runtime through dsh-upgrade first, or obtain an explicit decision to change the rollout target.

Also evaluate @deepseek-ai/cordis, @deepseek-ai/cosmokit, @deepseek-ai/schemastery, cordis plugin packages, and any peer packages the target SDK declares. Do not independently pick each package's newest version and create an unreviewed mixed release set.

Latest means the latest official stable release on the requested channel, not simply the numerically highest prerelease. A major-version change, an rc-to-stable transition, a stable-to-prerelease transition, incompatible peer range, changed Node engine, or missing release evidence is a decision gate: present the complete matrix, migration risks, and proposed target to the user before modifying dependency manifests.

## 3. Change Only the Approved Compatibility Set

1. Update only the official SDK packages in the approved matrix. Preserve the repository's dependency-kind conventions: runtime services remain peers where the host supplies them, and compile-time SDK packages stay devDependencies unless the existing package contract requires otherwise.
2. Use pnpm's structured package-management commands or a structured manifest edit. Do not use broad text replacement across package.json files and never hand-edit pnpm-lock.yaml.
3. Reconcile pnpm-workspace.yaml minimumReleaseAgeExclude entries with the approved exact SDK versions. Do not retain stale exclusions by habit, remove unrelated entries, or bypass release-age policy without recording the official version evidence.
4. Regenerate the lockfile through pnpm, inspect the full manifest and lockfile diff, and run pnpm install --frozen-lockfile --ignore-scripts in the isolated worktree to prove CI can resolve it.
5. Inspect every peer-dependency warning and duplicated SDK resolution. Resolve the cause with the approved version set; do not suppress warnings or accept a partial install as success.
6. If the approved cohort may change consumed types, APIs, imports, services, Cordis composition, client-platform boundaries, protocols, behavior, or generated bundles, record the compatibility handoff below and continue with `dsh-web-sdk-compatibility` in the same approved worktree. This skill remains the owner of manifests, release-age policy, and lockfile changes; the compatibility skill owns source, test, contract, and managed-GUI adaptation. Do not merge until both phases close.

### Compatibility Handoff

Before compatibility work starts, record:

~~~text
SDK compatibility handoff
- baseline and approved target DSH runtime/SDK cohorts
- official channel, registry, engines, and peer evidence
- changed or suspected package/export/service surfaces
- manifest, lockfile, install, branch, and worktree state
- intended DSH Web profile and existing GUI URL
- known baseline failures, warnings, and UI limitations
~~~

The compatibility phase must preserve this approved target. Any newly discovered version or lockfile inconsistency returns to this skill rather than being repaired ad hoc in source code.

## 4. Validate at CI Strength

If no compatibility handoff is required, run the CI-equivalent gate sequence directly. When a handoff is active, `dsh-web-sdk-compatibility` runs focused adaptation checks and returns one ledger; this skill verifies the final combined manifest, lockfile, repair, and generated-artifact commit with the sequence below. Reuse valid results from the same commit and environment rather than rerunning commands only because both skills mention the gate. Record the actual command and result for every gate:

~~~sh
pnpm typecheck
pnpm skin-center:check
pnpm community:check
pnpm build
pnpm test
pnpm test:scripts
pnpm runtime-deps:check
pnpm aggregate:check
pnpm docs:check
~~~

Run any package-specific tests required by affected packages. For a client-facing SDK candidate, enumerate every workspace package's dsh.client.inject services and compare the result with the candidate runtime/module table before profile smoke testing. Treat a renamed or missing service as a compatibility blocker. Use an existing contract check when available; if none exists, report the explicit matrix as preflight evidence rather than quietly assuming the host will supply every service. When client bundles, skin assets, market assets, aggregate files, or shared-runtime copies change, regenerate the required tracked artifacts in the same worktree and rerun their corresponding consistency checks. Do not normalize or discard generated diffs merely because their source files appear unchanged.

Treat a failed, skipped, or environment-blocked gate as unverified. Report the exact blocker and the affected risk; do not call the upgrade safe or merge-ready. In particular, an upgraded CLI/host can change the printed `dsh web` URL shape (e.g. alpha.2 adds `?token=` and gates `/` behind browser auth): when a lane like the e2e mount smoke still passes its script's URL parse, verify the captured URL is the full printed line, token included — a port-only parse silently hands Playwright the auth page and the smoke times out on a marker that never mounts. Fix the parse in the same change; do not let the smoke report a false red for days.

## 5. Verify the Actual DSH Web Integration

Local compilation is necessary but not sufficient. When a compatibility handoff is active, `dsh-web-sdk-compatibility` owns the affected-workflow GUI evidence and returns it to this rollout; this skill confirms that evidence belongs to the final combined commit and profile. After the isolated worktree passes the static gates:

1. Confirm the intended DSH web profile resolves this repository's built artifacts and does not contain duplicate child-plugin entries. After the accepted change is on target main, run node scripts/link-profile.mjs when the local profile link needs refreshing. Do not hand-edit profile patch files or add aggregate-owned child plugins individually.
2. Do not start a replacement Vite server or an independent dsh web instance. The apps/web entry is not a standalone application.
3. Integrate only after the worktree is accepted and rebased onto the latest approved main. Rebuild affected artifacts on the target main branch.
4. If a host restart is necessary to load updated host-side modules, coordinate a restart of the existing managed DSH web host rather than starting a second server. Then verify the existing GUI URL after a page refresh.
5. Exercise representative host and client paths for every SDK surface changed by the upgrade. Capture concrete evidence such as successful route mounting, visible UI behavior, and absence of browser/runtime console errors. For a user-visible regression, stop rollout and prepare a revert rather than patching around it in a live shared checkout.

## 6. Integrate, Roll Back, and Report

- Before the final merge, fetch again, rebase the task branch onto the latest approved main, and rerun every validation invalidated by the rebase. Verify the exact diff, target branch protections, and required review state.
- If conflicts cannot be resolved while preserving both intents with direct evidence, stop and submit the conflict for human review. Never silently choose one side or erase a conflicting SDK change to force a merge.
- Merge only when the approved matrix, lockfile, all required validation, and GUI verification are complete. Confirm main contains the accepted commit before removing the task worktree and branch.
- If a merged SDK update must be undone, create a precise revert commit or an approved rollback branch. Never reset or force-push shared main. Preserve the version matrix, failed evidence, and rollback rationale.

Final report must distinguish facts from assumptions and include:

1. old and target version matrix, official registry evidence, and peer/engine compatibility conclusion;
2. every changed manifest, pnpm-workspace.yaml entry, lockfile section, source adaptation, and generated artifact;
3. exact validation commands with pass/fail/blocked outcomes;
4. DSH Web GUI verification evidence, known gaps, and the rollback commit or procedure;
5. confirmation that no package was published and no DSH source checkout was changed.
