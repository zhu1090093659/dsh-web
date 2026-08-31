# Agent Note: Pause the release pipeline's automatic npm publish

Status: implemented

> Superseded by [restore-npm-publish-alpha.2](2026-08-30-restore-npm-publish-alpha.2.md) once the `@deepseek-ai/*` 0.1.2-alpha.2 cohort was published to the npm `alpha` dist-tag; this record documents the pause decision and its design.

## Problem

The tag-driven release pipeline published every family package to npm the moment a vX.Y.Z tag is pushed. The family builds against an unstable @deepseek-ai/* DSH alpha cohort that is not published to npm, so a pushed tag ships packages whose @deepseek-ai/* dependency ranges cannot resolve from the registry — a broken publish for real npm consumers, and an irreversible one for that version (a failed or bad publish cannot be re-run for an already-published version). The same gap makes the post-publish npm-strict mount smoke meaningless while it lasts: it would assert registry resolution the registry cannot provide.

## Decision

`.github/workflows/release.yml` carries a workflow-level env switch, `NPM_PUBLISH_ENABLED`, set to `'false'`. Both publish steps — `pnpm -r publish` and the legacy aggregate dual-publish — are gated on `if: env.NPM_PUBLISH_ENABLED == 'true'` and are skipped while the lane is paused. A tag push still verifies every package version against the tag, runs the full gate (typecheck, build, tests, script tests, aggregate, skin-center, and runtime-dependency checks), generates the release notes, runs the aggregate mount smoke — whose auto rewrite packs every unpublished family dependency from the workspace into file: tarballs, so the smoke validates the tag's own builds — and creates the GitHub Release. Flipping the switch to `'true'` restores the publish steps and the npm-strict registry assertion without any other edit.

## Alternatives considered

Deleting the publish steps outright loses the lane: re-enabling would mean rebuilding the steps (dist-tag handling, NPM_TOKEN wiring, legacy dual-publish rules) from git history. A repository variable or a workflow_dispatch input instead of a committed env switch loses reviewability and determinism: the paused/enabled state would live in repository settings or a manual invocation instead of the reviewed file, and a tag-triggered run cannot receive dispatch inputs. Skipping the mount smoke while paused loses the only real-consumer validation the tag still gets; auto mode keeps the smoke meaningful without npm.

## Consequences

Tags no longer publish anything to npm: the GitHub Release is the only release artifact until the switch is flipped, and npm consumers keep resolving the last published family versions without post-pause changes — behavior questions about published packages must consult the published versions, not the repository head. The pause takes effect through release commits: GitHub Actions reads the workflow file at the commit a tag points to, so a tag cut before this change still auto-publishes. Re-enabling requires the @deepseek-ai/* cohort the family depends on to be resolvable in real install paths; publishing earlier produces packages that cannot resolve their DSH dependencies even with the lane on.
