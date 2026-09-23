# Agent Note: Roleplay preset catalog and its content boundary

Status: implemented

## Problem

The community preset catalog was empty, so the Workshop's Presets tab had nothing to list and the publishing path described in [Community agent presets distributed through the Workshop](2026-09-09-community-agent-presets.md) had never carried real content. The material available for a first batch was an external collection of 46 character-roleplay prompts (`dongshuyan/Awesome-Prompts`, `角色扮演/多角色人设`). Every file in it is written as an NSFW companion persona: the same template fixes a character profile, then adds a sexual-attitude field, a staged explicit-dialogue library, and a "user identity" block that states the reader's sexual preferences. Three files name 17-year-old characters, and several more name characters who are children in their source work.

The catalog is the publishing source for dsh-market.com: an entry added there is downloaded by every user of the store onto their own machine, and turning it into a running agent is one click in the Workshop. The material therefore could neither be copied in as-is nor fixed by deleting explicit sentences only, because for the under-18 entries the romantic-partner framing is itself the problem, not the wording around it.

## Decision

Thirty-two adult characters ship as the first community preset batch, one directory per character at `packages/dsh-preset-center/presets/roleplay-<pinyin>/`, with `catalog.json` entries that credit the upstream collection (`author: dongshuyan`, `repo: https://github.com/dongshuyan/Awesome-Prompts`) at version 1.0.0 and classify every entry as `roleplay` (the vocabulary and the filter surfaces are recorded in [Preset categories on the market surfaces](2026-09-10-preset-category-filtering.md)).

Each preset is a single composition row: the persona section carries the whole character sheet as the complete system prompt (`complete: true`, `includeRuntimeContext: false`) and nothing else. The composition names no tools, no relative modules and no inline `!!js` expressions, so a session composed from it can talk and nothing more — no filesystem, no shell, no network. The persona text itself states the all-ages boundary, so the constraint travels with the preset rather than living only in a review checklist.

## Content boundary

Two rules decided the roster, and `packages/dsh-preset-center/presets/README.md` now states them as the contributor-facing content requirements for this asset kind:

- **No character under 18.** A stated age below 18 excludes the file. That removed 江晚星 (17), 林小枝 (17), 周小雨 (17), 晓美焰 (14), 秋月爱莉 (16), 雪之下雪乃 (17), 雷姆 (17), 露易丝 (about 16) and 顾星落 (17).
- **No character who is a child in the source work, and no unspecified age.** That removed 木之本樱 (13 at the start of her source material), 灰原哀 (a child's body in her source material), 菲伦 (the file offers 15 or 19), 樱岛麻衣 (17-18) and the generic "a character from a novel you wrote" entry (age left to the user, suggested at 20 or below).

Fourteen of the 46 files are excluded this way. Every remaining preset was rebuilt from the character profile only; the sexual-attitude field, the explicit-dialogue library, the user-identity block and instance-level intimate phrasing are removed, and the intimate-partner framing is kept only as ordinary adult romance, never as sexual framing.

## Derivation

The batch was produced by a one-off converter rather than the source files being edited in place: it cut the document at the first interaction-protocol marker (which drops the dialogue library and the user-identity block in one cut), dropped the sexual-attitude field and the behavioural paragraph built on it, filtered remaining lines clause by clause against explicit and soft-intimacy patterns while treating bracketed groups as atomic units, and rewrote the framing into a role-play header plus an all-ages clause. The converter is not part of this repository; the shipped presets are the artifact, and later edits belong in the preset files themselves.

## Alternatives considered

**Copying the source files in unchanged.** Rejected: it would publish explicit sexual role-play through a public store, and three of the files sexualise 17-year-old characters.

**Stripping the explicit text but keeping every character, minors included.** Rejected: for those entries the persona is a devoted partner persona for a child character, so the relationship framing is the problem and word-level filtering does not remove it.

**Shipping one empty role-play template preset instead of concrete characters.** Rejected: the batch is meant to give the Workshop's Presets tab real installable content, and a template is not that. The template already exists at `presets/_template/`.

**Shipping each character as its own npm plugin package.** Rejected for the same reasons recorded in the Workshop-preset note: it needs a profile patch and a restart, and the roster gets no per-item enable/disable surface.

**Keeping the upstream display text and descriptions as-is.** Rejected: the upstream filenames and taglines carry the explicit framing ("NSFW 提示词" and companion taglines), which is display text in the store and in the DSH roster.

## Consequences

- The Workshop's Presets tab has content for the first time: 32 entries, ranked so the whole batch sorts after the shipped presets, each installable into the inert library, where the install itself is the confirmation-gated declaration that makes it live.
- Every preset is conversation-only. A user who wants the agent to read files or run commands picks a different preset; that is the intended trade for a role-play persona.
- The batch is a derivative work of a third-party collection that ships no `LICENSE`. Attribution and a source link are recorded in the catalog, but the right to redistribute has not been confirmed by the upstream author. Publishing the generated `market/dist` is therefore the maintainer's call, and the batch should be withdrawn if the upstream author objects.
- Content review stays a human process. The exclusion and filtering rules are recorded here so the next batch is auditable, but nothing in `scripts/market-build` enforces them mechanically.
- `scripts/market-build-clean.test.mjs` now copies `packages/dsh-preset-center/presets` into its clean-checkout fixture. It previously omitted the directory, which was invisible while the catalog was empty.

## Testing

- All 32 `agent.cordis.yml` files parse with a YAML parser and assert the shipped shape: exactly one row, `@deepseek-ai/dsh-persona`, non-empty `prefix`, `complete: true`, `includeRuntimeContext: false`, no `!!js`, two files per directory, and `preset.yml` scalars on single lines.
- A residue scan over the generated text for explicit and intimacy markers (`身体`, `白丝`, `黑丝`, `开放`, `亲密`, `欲望`, `抱`, and the explicit set) returns only benign hits ("好亲近", "亲近的人"). A separate audit confirms no source line with useful content was lost to filtering.
- Every `【年龄】` field in the generated presets states 18 or above.
- `node scripts/market-build` writes 32 presets (2485 files) and `pnpm market:check` reports the committed `market/dist` up to date; `pnpm typecheck`, `pnpm test`, `pnpm docs:check`, `pnpm i18n:check` and `pnpm test:scripts` (272 tests) pass.
