# Agent Note: README accuracy pass after the retired plugins and v0.3.18 features

Status: implemented

## Problem

The shipped documentation drifted from the plugin set in two directions. Retired members still carried live copy: the root README advertised a "performance monitoring and governance" capability that the retired `dsh-perf` plugin used to provide, the aggregate README recommended the retired `@linxin666/dsh-skins` bundle, the furina skin README installed a per-skin npm package that never existed, the sources list credited the removed `dsh-miku-pet` package, and the semantic-attributes contract still enumerated `aionui-panel` and `miku-pet`. At the same time the new family member `dsh-model-capabilities` was undocumented, the task-board session reuse and the skill-center search/workspace picker were unmentioned, and `README.en.md` had lost its entire Task Board section, so the English reader could not find the feature the Chinese README opens with.

## Decision

- The root README pair documents `dsh-model-capabilities` end to end: a Feature Plugins section (Models-page capability editor plus provider disable/enable), a capability-table row, an npm-package-table row, a single-install example, and a mention in the "what it is" summary.
- The new behavior of existing plugins is documented where that plugin lives: the task-board section states opt-in session reuse (reuse only when the previous session is present and idle, otherwise a fresh session), and the skill-center bullet states the search box that stacks with the workspace picker.
- Retired-member copy is gone rather than annotated: the perf capability row, the aionui-panel removal note in both the root README and the aggregate README, the `dsh-skins` install commands, and the `dsh-miku-pet` attribution entry are removed; the furina skin README now documents the real path (skin-center is the only loader, skins install from the Workshop into `$DSH_HOME/skins/<id>/`, `link:` installs point at `packages/skins/skin-center`).
- The aggregate README stops hand-copying the family membership list: it names the highlights and points at `aggregate.yml` as the complete list, which is the same owner-of-truth rule the repository applies elsewhere.
- The semantic-attributes contract drops the two retired `data-dsh-plugin` rows and its heading count follows the table (15 to 13); `model-capabilities` was already recorded there by the plugin's own change.
- The pet attribution list now covers every pet asset the package ships: miku (stushansusu, MIT, Piapro character terms), jyn (11726, MIT), blue-throated-bee-eater (dsh-web, Apache-2.0) and starry-doll (Theater-ahyeon, CC BY-NC-SA 4.0).
- `README.en.md` regains the Task Board section, restoring heading, table and list parity with the Chinese README (32 headings, 11 capability rows, 18 npm rows, 6 pet bullets on both sides).

## Alternatives considered

- Keeping the removal notes as history ("the aionui panel was fully removed"): rejected — [docs/AGENTS.md](../../../../docs/AGENTS.md) has the current state in long-lived documents and the change story in commits, notes and the archive; a reader of the current README only needs the provider that exists.
- Rewriting the aggregate family list exhaustively: rejected — the list is generated truth in `aggregate.yml`; a hand-copied enumeration drifts again on the next plugin.
- Leaving the semantic-attributes rows in place because the contract is versioned: rejected — no element emits those ids any more, the adapter's own table never had them, and a dead enum value misleads skin authors.
- Editing the root README alone: rejected — the same retired references and the missing new plugin appear in the aggregate README and the furina skin README, which ships to users through the market build.

## Consequences

- The READMEs describe the plugin set that exists: one new plugin documented, no retired plugin described, and the English side is structurally complete again.
- Adding a family plugin now requires touching three surfaces: the root README pair, the aggregate README pair, and the semantic-attributes table; the aggregate membership list itself stays in `aggregate.yml`.
- Skin asset READMEs are outside `pnpm docs:check` (it walks package roots only), so the furina install instructions rely on review; the market build copies them into `market/dist`, which is why the regenerated assets ride in the same change.

## Testing

- `pnpm docs:check`, `pnpm i18n:check`, `pnpm aggregate:check`, `pnpm skin-center:check`, `pnpm market:check`, `pnpm test:scripts`, `pnpm typecheck` and `pnpm test` all pass on the changed tree.
- `pnpm docs:write-pair packages/dsh-web-all` re-recorded the pair sidecar after both sides changed; `pnpm market:build` regenerated the furina market assets (`README.md`, `README.zh.md`, `furina.zip`) and `pnpm market:check` confirms the committed dist matches the build.
- Manual parity checks across the root pair: 32 headings in the same order, 11 capability-table rows, 18 npm-package rows, 6 pet bullets, 6 code fences on each side; the retired-plugin scan over both files returns nothing.
