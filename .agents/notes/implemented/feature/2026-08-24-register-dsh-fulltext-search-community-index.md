# Agent Note: Register dsh-fulltext-search in the community plugin index

Status: implemented

## Problem

dsh-fulltext-search (a DSH Web GUI plugin that greps file contents in the
session working directory from the better-sidebar file manager) was developed
and needed a distribution channel. The family monorepo never vendors third-party
plugin code, so the plugin cannot ship inside `packages/` as an embedded asset;
the established community route is an index entry that points at the
contributor's own public repository.

## Decision

dsh-fulltext-search is registered as a community plugin entry in
`packages/dsh-community-plugins/community.json` with `category: "tools"` and
`repo: https://github.com/termanli/dsh-fulltext-search`. The `npm` field is
left out until the package is actually published. The market manifest
(`market/dist/manifest/plugins.json`) is regenerated with
`node scripts/market-build` because it derives from community.json, so the
Workshop store card and dsh-market.com list the plugin and users can install it
with `dsh plugin add https://github.com/termanli/dsh-fulltext-search`.

## Alternatives considered

- Family inclusion as an aggregate member (`packages/dsh-fulltext-search` with
  the restructured `dsh_web_ui_comp` branch): rejected. The restructured branch
  builds only inside the family monorepo — its tsdown preset imports the shared
  `shared/tsdown.client.ts` and `lib/` is gitignored — so a standalone clone
  cannot build or install. The community route needs none of the family package
  machinery.
- Publishing to npm and filling the `npm` field: deferred. The plugin is not
  published yet, and filling `npm` before a real publish would point users at an
  install that fails.

## Consequences

- The plugin stays installable from its own public repository; the family repo
  carries only index metadata, never the plugin code.
- The entry appears in the Workshop store and dsh-market.com only after the
  maintainer merges the index PR.
- A future family inclusion can reuse the preserved `dsh_web_ui_comp` branch
  through the documented adoption flow; the index entry would then be removed.
