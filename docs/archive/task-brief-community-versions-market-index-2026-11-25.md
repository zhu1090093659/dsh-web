# Handoff: community entry versions feed the official plugin market index

Date: 2026-11-25. Scope: `satellites/dsh-community-plugins` data contract, `scripts/market-build` plugin mapping, and the regenerated `market/dist`.

## Symptom

`market/dist/manifest/plugin-market-index.json` (the Format 1 index a DSH 0.2.3-alpha.2+ Plugins -> Discover page subscribes to) listed only the 21 dsh-web family packages. dsh-market.com and the Workshop store were unaffected and kept showing all 151 community entries.

## Cause

The Format 1 index installs an entry with `pnpm add <npm>@<version>`, so `buildPluginMarketIndex` drops any entry without an exact SemVer version (`scripts/lib/plugin-market-index.cjs`, community loop). `community.json` had no `version` field at all, so all 123 npm-published community entries were filtered out.

## Fix

- `satellites/dsh-community-plugins`: `version` becomes an optional field that requires `npm` and must be an exact SemVer. Every npm-published entry records the version its registry `latest` dist-tag returned on 2026-11-25. CONTRIBUTING, both README sides and the i18n hash record follow; the validator and its tests cover the new field.
- `scripts/market-build`: `scanPlugins()` carries `version` into `manifest/plugins.json`; without that line the generator still received nothing to emit.
- `market/dist`: regenerated. The index now holds 142 entries - 21 family plus 121 community. Two community entries (`dsh-session-id`, `dsh-skill-explorer`) point at family packages that the family scan already names, so `seenNames` keeps them from being listed twice.

## Verification

- `node scripts/community-index --check` -> `community-index: OK (151 entries)`; `node --test scripts/community-index.test.mjs` -> 13/13.
- `node scripts/market-build` -> 6014 files; `node scripts/market-build --check` -> `dist up to date`.
- Registry probe of all 123 `npm` names: 123 reachable, 0 missing, every one declaring `dsh.engines.dsh`.

## Follow-up

`version` is a snapshot of a registry state that keeps moving. A later release by an upstream author does not update this file, so a maintainer refresh (registry lookup for the changed names, then `pnpm market:fetch` and a rebuild) is what keeps Discover on the newest installable version.
