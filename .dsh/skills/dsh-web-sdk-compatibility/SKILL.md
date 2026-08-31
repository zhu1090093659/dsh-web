---
name: dsh-web-sdk-compatibility
description: Adapt and repair dsh-web after an approved official @deepseek-ai SDK/runtime cohort is selected or installed. Compare public API, type, service-injection, module-table, protocol, and behavior changes; map every change to repository consumers; implement the smallest fixes and durable compatibility contracts; handle migration-scoped adoption of explicitly requested target-SDK capabilities; and verify the real managed DSH Web GUI. Use for post-upgrade compatibility work or SDK-caused build/runtime regressions in this repository.
whenToUse: The user asks to adapt, repair, migrate, or validate dsh-web against an already selected newer official SDK; fix plugin failures caused by an SDK upgrade; determine whether source changes are required after a dependency-only upgrade; add durable SDK compatibility checks; or adopt a target-SDK capability expressly as part of the migration. Use dsh-sdk-upgrade first when the target versions, release channel, host cohort, manifests, or lockfile are not yet approved and aligned. Route ordinary post-upgrade feature work to dsh-web-agent-coding. Do not use for DSH source customization or publishing @linxin666 packages.
user-invocable: true
---

# dsh-web SDK Compatibility and Repair

Use this Skill only for the dsh-web monorepo. It is the compatibility phase after `dsh-sdk-upgrade`: the upgrade skill owns version selection, official registry evidence, dependency manifests, release-age policy, and lockfile resolution; this skill owns consumer impact analysis, source and test adaptation, compatibility contracts, migration-scoped target-capability adoption, and managed DSH Web acceptance.

## Non-Negotiable Boundaries

- Freeze the approved runtime/SDK cohort supplied by `dsh-sdk-upgrade`. Do not reopen channel or version selection and do not independently update dependency ranges, `pnpm-lock.yaml`, or `pnpm-workspace.yaml`. If those inputs are absent or inconsistent, return to `dsh-sdk-upgrade`.
- Use only official `@deepseek-ai/*` packages from the project-configured npm registry. Never import from a DSH source checkout, copy upstream source into this repository, use local SDK links, deep-import unpublished internals, or patch `node_modules`.
- Never publish, tag, change `@linxin666` package versions, alter the release pipeline, or create a GitHub Release as part of compatibility repair.
- Load and obey `dsh-parallel-dev` before Git, worktree, install, build, rebase, merge, cleanup, or staging operations. Reuse the approved upgrade worktree when this is an active upgrade phase; for a standalone repair, let `dsh-parallel-dev` choose shared-checkout discipline or an isolated worktree based on scope and concurrency.
- Do not use destructive Git operations, broad restore/stash, `git add -A`, or force-push. Preserve all unrelated work from other sessions.
- Keep one integration owner. Read-only API audits may run in parallel; overlapping source, test, generated-artifact, manifest, or lockfile edits may not.
- Account for every repository consumer of a changed SDK surface. A green top-level typecheck is not permission to skip a package.
- Separate compatibility fixes from optional feature adoption. Do not claim that a new SDK feature is used unless repository source, tests, and GUI evidence prove it.

## 1. Accept the Upgrade Handoff

Start from an explicit compatibility handoff. It must contain:

~~~text
SDK compatibility handoff
- baseline DSH runtime and SDK cohort
- approved target DSH runtime and SDK cohort
- official release channel, registry evidence, engines, and peer conclusion
- changed or suspected package/export/service surfaces
- manifest, lockfile, and install state
- approved base commit, task branch, and worktree/isolation decision
- intended DSH Web profile and existing GUI URL
- known baseline failures, warnings, and UI limitations
~~~

If the dependency upgrade already landed without a handoff, reconstruct these facts from the exact upgrade commit, official npm metadata, the installed runtime, and the profile tree. Reconstruction may describe the selected cohort; it may not choose a different one.

Before source work:

1. Read root `AGENTS.md`, `packages/AGENTS.md`, applicable package `AGENTS.md` files, and `docs/development.md`.
2. Load `dsh-web-agent-coding`, `dsh-web-pre-push-checks`, and `dsh-web-web-qa`; load the documentation workflow when user-facing docs may change.
3. Record the shared and task worktree status, target commit, current host version, profile dependency tree, and baseline GUI state.
4. Confirm the target host supplies the same approved cohort as the repository. A newer plugin SDK on an older host is a blocker, not a repair opportunity.

## 2. Build the Consumer Matrix

Inventory every possible first-party consumer, not only packages that currently fail:

- all workspace `package.json` dependency kinds and `dsh.client.inject` declarations;
- host `inject` constants, Cordis context augmentations, lifecycle hooks, and service calls;
- browser SDK imports, module augmentations, slot keys, platform modules, and client service calls;
- routes, API remotes, settings namespaces, schemas, events, serialization, cancellation, persistence, session, workspace, and tool contracts;
- `shared/` sources and generated consumer copies;
- plugin and skin templates, aggregates, profile patches, generators, committed bundles, and compatibility tests;
- external npm plugins pulled in through an aggregate (`packages/dsh-web-all` and friends) and every `@deepseek-ai/*` peer they carry.

This last row is easy to miss but is where cohorts bite hardest. A cohort `overrides:` block (or any peer-force-resolution that pins the whole family) silently force-resolves the `@deepseek-ai/*` peers of external aggregate plugins too. The moment that block is dropped (e.g. the cohort becomes resolvable from npm), those externals' hard-imports of a now-removed SDK face are unmasked: they fail the host loader's strict import resolution and abort `dsh web` boot, or trip the e2e mount smoke. Inventory them before dropping the block, and treat a detected hard-bind to a removed face as an exclusion decision (remove the aggregate row + dep + the generator/mount assertions together) rather than a repair.

For imports, record the specifier, imported symbol, type-only versus value use, consumer file, and execution half (host, client, or shared). For services, record the provider package, service name, consumer, optionality, startup order, and failure behavior.

Produce one matrix with these columns:

~~~text
SDK package/surface | target delta | repository consumers | host/client/shared | risk | required action | evidence | status
~~~

Allowed status values are `proven unaffected`, `static-only risk`, `runtime-only risk`, `affected and adapted`, `feature adopted`, and `blocked`. Do not use `unaffected` without evidence.

## 3. Compare the Official SDK Delta

Use the baseline and target official npm tarballs and structured package metadata. Compare:

- `exports`, type entry points, public declarations, runtime entry points, `dsh` metadata, engines, dependencies, and peers;
- exported symbols and signatures, overloads, optionality, defaults, result/error shapes, event payloads, and schema changes;
- host composition rows, service names, injection order, plugin lifecycle behavior, profile defaults, and feature flags;
- browser module-table entries, platform seeds, `dsh.client.inject` providers, slot APIs, and client initialization order.

Use JSON/YAML parsers, TypeScript-aware inspection, and semver checks where available. Release notes are useful corroboration but are not a substitute for comparing the published artifacts consumed by this repository.

Classify each observed delta as `added`, `removed`, `renamed`, `signature changed`, `default changed`, `lifecycle changed`, `protocol changed`, `packaging-only`, or `unknown`. Every consumed non-additive or unknown delta is a decision gate.

Never repair an upstream packaging defect by editing installed files. Prove whether it affects runtime behavior, preserve exact evidence, and either add a repository-side contract against the supported public surface or report the upstream blocker.

## 4. Establish a Reproducible Baseline

Use a test-ready frozen install in the isolated worktree. `pnpm install --frozen-lockfile --ignore-scripts` proves resolution only; do not assume that install state has executable wrappers or generated prerequisites for typecheck and tests. Before validation, run the repository-approved normal frozen install in the approved task workspace or explicitly verify required `.bin` tools such as `tsc`.

Run the narrowest relevant baseline commands before editing source:

- affected package typecheck, build, and tests;
- the repository typecheck when the delta crosses package boundaries;
- existing runtime dependency, shared-copy, aggregate, or generated-artifact checks implicated by the surface;
- a real profile composition dump and focused managed-GUI reproduction for runtime-only failures.

Capture failures verbatim and classify them as import/export, typing, service injection, lifecycle, protocol/schema, serialization, packaging, behavior, or UI integration. Preserve pre-existing failures and warnings separately so they are not misreported as target-SDK regressions.

A conclusion of `no source adaptation required` is valid only when supported by the complete consumer matrix, target declaration comparison, injection/module-table parity, full required gates, and managed-GUI smoke evidence.

Project rule: a version-only SDK diff is not evidence of behavior compatibility. Even when manifests and the lockfile are the only changed files and TypeScript stays green, runtime lifecycle, service availability, module loading, protocols, and serialization still require explicit classification and managed-GUI evidence.

## 5. Adapt Affected Surfaces

Make the smallest change in the owning package:

- **Types and exports:** update public imports, type augmentations, signatures, and tests. Do not deep-import target package internals or weaken types to silence errors.
- **Host services:** update injection names, Cordis context declarations, lifecycle handling, settings registration, routes, tools, and failure semantics while preserving package security rules.
- **Client services:** reconcile `dsh.client.inject`, platform seeds, slots, remotes, and initialization ordering. Keep `@deepseek-ai/*` browser imports type-only except the repository-approved platform modules.
- **Protocols and schemas:** update both host and client halves, validation, serialization, error handling, and compatibility tests as one contract.
- **Shared behavior:** edit the authoritative `shared/` source and regenerate consumer copies through `pnpm sync-shared`; never hand-edit generated copies.
- **Generated and aggregate artifacts:** run the owning generator and inspect the generated diff instead of normalizing or discarding it.

For security-sensitive packages such as SSH and remote access, preserve fail-closed behavior and update bilingual security documentation when externally visible semantics change.

### Deliberate New-Feature Adoption

Treat an SDK capability that is merely available as unused. Adopt it here only when it replaces a removed or deprecated API, the compatibility fix materially depends on it, or the user expressly included it in the SDK migration. Route unrelated feature development to `dsh-web-agent-coding` after compatibility closes.

Before migration-scoped adoption, state the user value, affected plugins, host/runtime prerequisite, fallback behavior, security and data implications, and whether older supported cohorts remain compatible. Then add focused source changes, tests, and documentation. The final report must answer `New SDK features adopted: yes/no`; a `yes` must name the feature and cite implementation evidence.

## 6. Add Durable Compatibility Contracts

A repair is incomplete if it is protected only by one manual run. Add or extend the narrowest durable contracts justified by the delta:

- compile-time import and signature assertions for relied-on SDK exports;
- host composition tests for required services, route registration, lifecycle, and failure behavior;
- a client injection contract that compares every workspace `dsh.client.inject` requirement with the approved target Web runtime/module table;
- browser platform and bundle-purity checks for target platform modules and type-only SDK boundaries;
- profile and aggregate checks for resolvable patches, unique IDs, aggregate/direct coexistence, and mount-once behavior;
- protocol, schema, event, persistence, cancellation, and error-shape tests for changed cross-half contracts;
- the e2e/aggregate mount smoke, keyed to a cohort-stable official marker (the DSH host frame `[data-dsh-frame]`) rather than to any excluded external plugin's host div. When an aggregate external is excluded in the same migration, the smoke must assert it is ABSENT, or the (still-correct) npm content ships while the smoke times out waiting for a div that will never mount;
- the same mount smoke must also carry the printed URL verbatim, token included: alpha.2 `dsh web` prints a tokenized root URL (`.../?token=launch-token`) and fences `/` behind browser auth, so a URL parse that stops at the port (`grep -oE ':port'`) hands Playwright the 401 auth page and the frame wait times out — the smoke's URL parse and boot marker are both contract, and a red dev CI after a "fix" means the diagnosis was incomplete;
- representative workflow tests only for plugin paths exposed to the changed SDK surface.

Prefer existing checks and package test patterns. Add a cross-package abstraction or script only when it enforces a stable repository invariant that cannot be expressed clearly in an owning package. Contract failures must name the missing or changed SDK capability; do not pin accidental private implementation details.

## 7. Validate at CI Strength

Run focused package checks while repairing each classified surface. Then load `dsh-web-pre-push-checks` and complete its full repository baseline plus every diff-dictated shared, generated, aggregate, bundle, documentation, and package-specific gate. When this skill is an active upgrade phase, return one validation ledger to `dsh-sdk-upgrade`; do not rerun identical commands on the same commit merely to satisfy both skills.

Finish with `git diff --check`, an exact changed-file review, and a scan proving no source-checkout path, local SDK link, unapproved dependency change, or patched installed file entered the diff. Resolve repository-caused warnings and classify upstream or pre-existing warnings with evidence and runtime impact. Failed, skipped, flaky, or environment-blocked required gates remain unverified.

## 8. Verify the Managed DSH Web GUI

Follow `dsh-web-web-qa` against the existing managed host and profile; never start a standalone Vite shell or second `dsh web` instance. In addition to its normal evidence, SDK compatibility acceptance must prove profile artifact resolution, unique plugin IDs, injection/module-table parity, a clean-browser startup, affected bundle HTTP status, browser console/network outcome, host route mounting, and one representative host-to-client workflow for every affected surface or adopted capability.

Rebuild and refresh links through the repository commands, coordinate the existing host restart when needed, and reproduce baseline and target under the same profile, state, and viewport when distinguishing a regression. Stop rollout on a target-SDK regression and close temporary browser task spaces after evidence capture.

## 9. Review, Hand Back, and Roll Back

Obtain an independent findings-first review of the exact repair diff and compatibility matrix. During an active upgrade, do not integrate independently: return the reviewed source/test/contract diff, validation ledger, GUI evidence, and blockers to the `dsh-sdk-upgrade` owner in the same approved worktree. For a standalone post-upgrade repair, follow `dsh-parallel-dev`, `dsh-web-agent-coding`, and `dsh-web-pre-push-checks` for exact staging and integration.

Use `git revert` for repository rollback. If the runtime cohort also needs rollback, return to `dsh-sdk-upgrade` or the host upgrade workflow and restore the matching profile tree; never reset or force-push shared main.

## 10. Final Report

Distinguish facts from assumptions and include:

1. the compatibility handoff and baseline/target runtime-SDK matrix;
2. the SDK delta and complete repository consumer/impact matrix;
3. every source, test, documentation, generated-artifact, and contract change;
4. the exact validation ledger with pass, fail, blocked, and warning classifications;
5. managed-GUI profile, startup, network, console, workflow, and responsive evidence;
6. `New SDK features adopted: yes/no`, with named implementation evidence for every `yes`;
7. confirmed upstream defects, pre-existing limitations, residual unknowns, and precise revert procedure;
8. confirmation that no package was published and no DSH source checkout or installed SDK file was modified.

The work is complete only when every changed SDK surface is classified, every affected plugin is repaired or explicitly blocked, durable contracts protect the relied-on behavior, the real managed GUI passes, and the accepted commit is present on the target main branch.
