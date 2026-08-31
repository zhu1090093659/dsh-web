# Agent Note: Restore the automatic npm publish lane for the alpha.2 cohort

Status: implemented

## Problem

The [release lane pause](2026-08-28-pause-release-npm-publish-unstable-dsh-alpha.md) exists because the family's `@deepseek-ai/*` alpha cohort was not published to npm, so a tag push would ship packages whose dependency ranges cannot resolve from the registry. That precondition is gone: the `@deepseek-ai/*` 0.1.2-alpha.2 cohort is now published under the npm `alpha` dist-tag (verified `npm view @deepseek-ai/dsh-client-connection dist-tags` → `alpha: 0.1.2-alpha.2`), and the repository's manifests already resolve it by range `^0.1.2-alpha.2` straight from `registry.npmjs.org` (the tarball-store `overrides:` block and `scripts/build-cohort-tarballs.mjs` were deleted when the `build(sdk): resolve the 0.1.2-alpha.2 cohort from npm` commit landed).

## Decision

Flip the single `NPM_PUBLISH_ENABLED` switch back to `'true'` in `.github/workflows/release.yml` and refresh its header comment. This restores both publish steps — `pnpm -r publish --tag latest` and the legacy aggregate dual-publish, both gated on `if: env.NPM_PUBLISH_ENABLED == 'true'` — plus the post-publish strict-registry smoke assertion, exactly as the pause note's design intended (the switch was always the single remove-me toggle, no other edit needed).

The release validation DSH pin is bumped from `0.1.1-rc.2` to `0.1.2-alpha.2` in both `.github/workflows/release.yml` (verify-release mount smoke) and `.github/workflows/ci.yml` (plugin-mount lane). This is required because the family packages declare `engines.dsh >= 0.1.2-alpha.1`, and the skill's release gate blocks a CI/validation DSH version below the declared floor (`0.1.1-rc.2` < `0.1.2-alpha.1`); `0.1.2-alpha.2` satisfies the floor and matches the cohort the plugins are built against.

## Alternatives considered

- Keeping the lane paused: rejected — the precondition it guards against is resolved, and the user asked to restore npm publishing; publishing now ships resolvable packages.
- Bumping only `release.yml`: rejected — the mount smoke (release) and the per-PR plugin-mount (CI) must agree on the host cohort, and both were below the floor.

## Consequences

- A vX.Y.Z tag push now publishes the whole family to npm (`@linxin666`, latest dist-tag) and runs the npm-strict registry smoke after the mount check; the GitHub Release is no longer the only artifact.
- `@linxin666/dsh-usage@0.3.7` and the pause-era GitHub-Release-only tags (0.3.7, 0.3.8) are NOT retro-published to npm; the next full release bumps the family to the next version and publishes it through the pipeline.
- The `engines.dsh >= 0.1.2-alpha.1` floor and the root README DSH badge stay as they are; they describe the declared minimum, not the CI validation pin.
