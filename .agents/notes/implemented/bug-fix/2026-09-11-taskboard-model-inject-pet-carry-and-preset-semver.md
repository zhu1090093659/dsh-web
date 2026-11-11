# Agent Note: Task Board Remote Model Inject, Model Row Display, Pet Remainder Carry, and Preset SemVer Update Check

Status: implemented

## Problem

### 1. Task board execution settings model dropdown only lists host default with un-injected remote.session exception (Issue #1486)
In `dsh-task-board`, the client `inject` declaration only declared `'remote'`, without the dotted sub-namespace `'remote.session'`. When accessing `ctx.remote.session`, the Cordis service proxy threw `cannot get property "remote.session" without inject`, aborting retrieval. Furthermore, model fetching relied solely on legacy connection RPC, missing DSH 0.1.5-rc.1's generated `remote.session.modelCatalog()` API, and inspected `g.provider` instead of `g.id` for provider groups, resulting in empty model lists.

### 2. Pet passive income and sleep restore flattened by frequent polling (Issue #1478)
In `dsh-pet`'s `settleGameplay`, ticks were computed by `Math.floor(elapsedMs / intervalMs)` followed unconditionally by `state.settledAt = now`. With the frontend HUD polling every 2 seconds, any fractional duration less than an interval (e.g. 60 seconds or 30 seconds) was discarded on every cycle, preventing passive income and sleep energy restore from accumulating during background idling.

### 3. Preset center hasUpdate compared versions using bare inequality (Issue #1477)
In `dsh-preset-center`, `hasUpdate` checked `record.version !== row.assetVersion`. When a user had a newer local dev build installed, or when version representations differed without being newer, the panel reported an available update and downgraded upon click.

### 4. Task board model pickers could not tell two providers' same-named models apart (Issue #1981)
A deployment may publish one model name through several providers, and each pair is a different route (`provider/model`). The board's model pickers rendered the bare model name, so a roster carrying `acme/shared` and `beta/shared` offered two identical rows ("Shared"), and the operator could not tell which route a card would pin. The same blind spot reached the collapsed execution summary, which echoed the bare name, and the settings card's new-card default model choices, which named the provider before the model ("acme · Shared") — a third form for the same fact. A row the flat discovery fallback produces carries no provider at all, and a route the roster cannot describe must keep saying so truthfully instead of being given an invented provider.

## Decision

### 1. Task board model discovery aligned with Cordis declarations
- Added `'remote.session'` to `packages/dsh-task-board/src/client/index.ts`'s `inject` declaration.
- Reworked `pushModelOptions` to probe `(remote as Partial<ClientRemote>).session.modelCatalog()`, reading `g.id ?? g.provider` as the group key, while preserving fallback to connection RPC interfaces.
- Added `tests/model-options.spec.ts` unit test to guarantee required inject declarations.

### 2. Pet gameplay lazy settle remainder carry
- Added `incomeCarryMs?: number` and `restoreCarryMs?: number` to `PetGameplayState`.
- Retained the remainder modulo `intervalMs` in the carry fields across settle calls, and reset `restoreCarryMs` upon leaving `sleep` mode.
- Sanitized remainder fields in `persist.ts` with round-trip compatibility for existing files.
- Added a 30-cycle 2-second polling simulation test in `src/gameplay.test.ts`.

### 3. Strict SemVer update checking in Preset Center
- Introduced lightweight `parseSemver` and `compareVersions` algorithms in `packages/dsh-preset-center/src/client/PresetPanel.tsx`.
- Changed `hasUpdate` to `compareVersions(record.version, row.assetVersion) > 0`.
- Added test coverage in `tests/preset-panel.spec.tsx`.

### 4. One shared model display form: model name, then provider
- `packages/dsh-task-board/src/client/board/model-options.ts` owns `modelDisplayLabel`: the model name first, the provider that publishes it second, joined by " · ". A row without a provider keeps its bare name, and a row carrying no name of its own shows the model part of its own qualified route, so the provider is never printed twice.
- `modelChoiceRows` renders through that one formatter, so the settings card's new-card default model choices and every execution-target picker show the same form.
- The new-task modal's model picker, its AI-parse model picker, the task detail view's model picker, the collapsed execution summary and the settings card's new-card-default model picker (formerly also the retired judge model picker) all read the label from the shared formatter.
- The provider is named by the route's own group id — the token the picker stores — so the settings picker and the execution pickers name one provider identically.
- The pickers' values stay the qualified `provider/model` route, the stored pins stay untouched, and the reasoning-effort derivation is unchanged: only the display form moved.
- A row the flat discovery fallback produces (no provider) keeps its bare model name, and a route the roster cannot describe keeps its own route text in the summary — the display never invents a provider for a route it cannot resolve.

## Alternatives considered

- **Leave each picker to format its own label.** The cheapest change, but it is exactly the drift that produced three forms for one fact; the next model picker would pick a fourth. One shared formatter is the only way the pickers cannot disagree.
- **Show the provider first ("provider · model").** The order the settings card's default-model choices already used. It distinguishes same-named models as well as "model · provider" does, but it reads the provider as the subject and the model as its qualifier, while the name is what the operator recognizes; the required form puts the name first.
- **Print the qualified route ("provider/model") as the label.** Unambiguous, but it hides the model name behind the provider, so a roster of many models reads as a wall of routes. The display keeps the name and adds the provider beside it.
- **Give a row without a provider an empty provider slot ("name · ").** It would keep one label shape, but it would suggest a provider that the deployment never published. Such a row keeps its bare name.
- **Parse an unknown route's provider out of the route string and show it.** The route text is a truthful identity for a model the deployment no longer offers, and guessing at its parts would present a derivation as a published fact. The summary keeps the route itself.

## Consequences

- One display form covers every model row the board offers: the model name, then the provider. Two providers publishing one model name are visibly distinct in every picker.
- The pickers' values, the stored pins and the reasoning-effort behavior are unchanged; a card pinned to a route the roster cannot describe still shows that route.
- The default-model choices of the settings card changed their label order ("alpha · Fast" became "Fast · alpha"); the stored value is the same route as before.
- The execution summary of the collapsed new-task region now names the provider beside the model, so a collapsed region cannot hide which provider's model it holds.
- A row without a provider (the flat discovery fallback) and an unknown pinned route keep the truthful forms they had: a bare model name, and the route text.

## Testing

Verified for decision 4 (the model display form):

- `pnpm --filter @linxin666/dsh-client-ui-task-board test`: 108 test files passed (1297 passed, 1 skipped of 1298), including the model display-label suite.
- `pnpm --filter @linxin666/dsh-client-ui-task-board typecheck`: 0 errors.
- `pnpm --filter @linxin666/dsh-client-ui-task-board build`: host and client bundles built.
- `pnpm docs:check`, `pnpm i18n:check`, `pnpm emoji:check` and `node scripts/test-standards.mjs`: passed.

Recorded when decisions 1 to 3 shipped:

- `pnpm --filter @linxin666/dsh-pet test`: 41 files passed (493 passed).
- `pnpm --filter @linxin666/dsh-client-ui-preset-center test`: 4 files passed (33 passed).
- `pnpm typecheck`: All 22 packages passed with 0 errors.
- `pnpm test`: All tests across monorepo passed.
- `pnpm docs:check && pnpm i18n:check && pnpm test:scripts`: All passed.
