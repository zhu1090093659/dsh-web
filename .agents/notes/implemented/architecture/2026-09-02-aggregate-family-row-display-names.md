# Agent Note: Aggregate family rows display real plugin names via subpath exports

Status: implemented

## Problem

The official plugin list (Settings → Plugins, `dsh-client-ui-settings-plugin-inventory`) renders each loader entry's title from the entry's mounted module specifier — `moduleShortName(entry.options.name)`, with no other display field. The fault-isolation shell ([aggregate shell isolates per-plugin boot failures](2026-09-01-aggregate-plugin-fault-isolation-shell.md)) mounts every family row under the aggregate package, so all ~17 family cards showed the identical title "web-all", and expanding a card was the only way to tell usage from pet from session-archive.

## Decision

Each shell-wrapped family row's `name` now mounts a per-family subpath export of the aggregate package: `@linxin666/dsh-web-all/<family>` (family = the namespaced row id without the `web-ui-` prefix). Inventory titles become distinct `web-all/<family>` labels — the same multi-entry convention the host itself uses for its `web-app/startup` row. The mount contract is unchanged: every subpath export resolves to one shared re-export module (`src/shells/shell.ts` → `lib/shells/shell.js`, a pure re-export of the main face's shell), and the row config keeps naming the real plugin package (`config.plugin`), so fault isolation, the degraded ledger, and profile patch overrides behave exactly as before.

Two structural invariants make the display names safe; both are enforced by `scripts/aggregate.mjs` (exports maintenance + shell-file validation) and regression-gated in `packages/dsh-web-all/tests/shell-subpath.spec.ts`:

- The family exports keys are generator-owned (added/pruned from the aggregate manifest, always targeting `./lib/shells/shell.js`), so a family added to `aggregate.yml` can never boot a row whose subpath does not exist.
- A marker manifest (`src/shells/package.json`, built into `lib/shells/`) sits beside the re-export: the client module scanner resolves a row's module URL and walks up to the nearest package.json, and the marker (string `name`, `type: "module"`, no `dsh` field) stops that walk before it reaches the package root. Without it, every family row would resolve to the aggregate's own manifest and its `dsh.client` face — `reconcilePackage` then throws "resolves from multiple active Loader sources" and the aggregate's browser half (compat shim + client-children mount) breaks. `type: "module"` is required by the same nearest-manifest rule: without it Node parses the re-export as CJS.

## Alternatives considered

Pointing the rows directly at the real plugin packages (bare `usage` titles) was rejected: the row's `name` IS the module the loader imports, so a broken family package would abort the whole boot again — reintroducing the exact failure the shell exists to contain. Guard subpath exports inside each family package (`<realpkg>/isolated`, real-name-first titles) were rejected: rows would resolve family packages from the profile root, reintroducing the resolver fragility the aggregate removed (every profile install must see all family packages at its root), it touches 16 packages instead of one, and it couples the aggregate release to new versions of every family package. Moving the aggregate's `dsh.client` face to a separate package so plain subpaths would not collide on the scanner's multi-source check was rejected: a new package, a moved client entry point, and release-surface churn to avoid one 4-line marker manifest. An upstream display-name field in the inventory is the clean host-level answer but sits outside this repository; it can be proposed upstream (as with `continueOnError`) and adopted later without removing the subpath labels.

## Consequences

The plugin list shows one distinct `web-all/<family>` card per family plugin, and expanding a card is no longer the only way to identify one. Costs: the naming chain now spans three artifacts (row name → exports key → shared re-export + marker), all enforced by the generator gate and tests rather than by a single file; a nested package.json ships inside `lib/` (inert for npm/pnpm, but tooling that treats nested manifests as workspace packages must keep ignoring it); and the family subpath must stay display-only — putting mount semantics into the subpath module would fork the isolation contract the shell owns.

## Testing

`packages/dsh-web-all/tests/shell-subpath.spec.ts` gates the contract on the built artifact: per-family subpath row names with the `config.plugin` contract intact, exports keys resolving to the shared re-export, `apply` identity between the shells face and the main face (one degraded ledger instance), and the marker walk (nearest package.json from `lib/shells/shell.js` is the marker with no `dsh`; from `lib/index.js` it is the package root with `dsh.client`). `tests/shell-isolation.spec.ts` adds a real-boot scenario proving a subpath row degrades alone exactly like the main-face shell. `pnpm aggregate:check`, `pnpm typecheck`, `pnpm test`, and `pnpm test:scripts` pass; `dsh --profile web --dump-config` shows the subpath names; a Node import probe from the live profile root resolves `@linxin666/dsh-web-all/usage` through the exports map and the marker. Requires a user-side `dsh web` restart to take effect (bundle-layer change).
