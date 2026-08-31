# Agent Note: Pet Affinity Rank i18n and Voice Pack Remarks & Ranks Overrides

Status: implemented

## Problem

In `dsh-pet` (#1226):
1. In non-Chinese environments (e.g. `lang="en"`), pet affinity rank names (`幼鲸` through `鲸生共渡`) were hardcoded in Chinese, leaving the hover panel partially untranslated.
2. Voice packs (`.voice.json`) lacked top-level schema slots for `remarks` (pat/feed dialogue pools) and `ranks` (affinity tier names), preventing custom packs from overriding dialogue and rank titles cleanly.

## Decision

1. In `affinity.ts`, exported `AFFINITY_RANKS_EN` for the 9 built-in affinity rank tiers.
2. In `locales.ts`, added translation keys `pet.rank.name.<tier>` for English and Chinese dictionaries.
3. In `PetSprite.tsx`, localized the raw affinity rank name before passing it to `panelStat("rank", ...)`.
4. In `voice-pack.ts` and `voice-pack-v1.schema.json`, added `remarks` and `ranks` to `VOICE_PACK_KEYS` and schema definitions, and updated `normalizeVoicePack` and `mergeVoicePacks` to merge these fields across layers.
5. In `remarks.ts` and `ledger.ts`, updated `RemarkPicker` and `PetLedger` to accept voice pack fallback remarks.

## Consequences

- English installations now display localized rank names (e.g. "Affinity Baby Whale") out of the box.
- Voice packs can now customize pat/feed remark pools and tier titles via `.voice.json`.

## Testing

Added unit tests in `voice-pack.test.ts`, `remarks.test.ts`, and `PetSprite.test.tsx`. All 452 tests in `dsh-pet` passed.
