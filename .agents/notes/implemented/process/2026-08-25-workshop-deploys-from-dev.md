# Agent Note: Workshop deploys from dev pushes, decoupled from the release cadence

Status: implemented

## Problem

Workshop (dsh-market.com) visibility was coupled to the npm release cadence. deploy-market.yml triggered only on push to main, and main receives dev content only through maintainer integration at release time. A new skin, built-in-pet market mirror, or community-plugin index entry merged into dev (with the regenerated market/dist committed, as market:check enforces) stayed invisible in the store until a release integration, forcing manual deploys or multi-day waits. Surfaced when the OUO Neko pet (PR #1118) merged into dev with its market entry in market/dist/manifest/pets.json (generated 2026-08-25) while the live site still served the 2026-08-24 manifest.

## Decision

- deploy-market.yml push trigger moves from main to dev (branches: dev). The paths filter keeps its role and now watches the satellite pins: market/**, satellites/**, market-inputs.lock.json, scripts/market-build, scripts/market-fetch-inputs.mjs, scripts/market-verify-assets.mjs, scripts/deploy-market, scripts/market-layout.test.mjs, package.json, and the workflow file itself. The in-repo content paths it watched before the family split (packages/skins/**, packages/dsh-pet/**, packages/dsh-community-plugins/**) moved out with the content; the pin mechanics are owned by [the satellite-repositories note](../architecture/2026-09-23-family-satellite-repositories.md).
- The main trigger is removed, not kept alongside dev. main only ever receives dev content through maintainer integration, so a main push would redeploy an older-or-equal dist and open a rollback window against a newer dev deploy. workflow_dispatch remains the manual fallback.
- In-workflow gates are unchanged: market:check, community:check, and test:scripts run before `cf deploy`; only committed market/dist artifacts are deployed (no CI rebuild), matching the gallery discipline.

## Alternatives considered

- Dual dev + main triggers: rejected because the main integration push can momentarily deploy an older dist over a newer dev deploy.
- Manual-only deployment (workflow_dispatch or local scripts/deploy-market): rejected because it keeps a human step on the critical path of every skin/pet/plugin onboarding, which is the coupling being removed.
- Rebuilding market/dist inside the deploy workflow: rejected (standing rule) because build-machine paths and nondeterminism must not enter the deployed artifacts; market:check already fail-closed verifies the committed dist.

## Consequences

Merging a new skin, pet market entry, or community-plugin index row into dev now deploys the Workshop automatically once the path filter matches; no npm release is needed for store visibility because the store installs items into the runtime user directories ($DSH_HOME/skins/<id>, $DSH_HOME/pets/<id>). Built-in content shipped inside npm packages (for example the dsh-pet bundled registry) still follows the release process. The OUO Neko market entry ships to the live site on the next dev push that touches market paths, or immediately via workflow_dispatch. Related redesign (same user decision round): dsh-pet gains a frames2d renderer and dsh-miku-pet is converted into a Workshop pet; that work records its own feature note. Verification: on 2026-09-26 a maintenance round merged four skins and one plugin entry into the satellites, moved the two gitlinks (`dsh-skins` `0b0ea18` -> `05f5d512`, `dsh-community-plugins` `86303de` -> `9cefdcc1`), regenerated `market/dist` from tarball-materialized pins, and pushed to dev; the workflow deployed it and the live `manifest/plugins.json` (125 entries) and `manifest/skins.json` (47 skins) are byte-identical to the committed files.
