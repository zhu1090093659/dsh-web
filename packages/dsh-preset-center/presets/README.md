# Community preset catalog

English | [中文](README.zh.md)

The publishing source for community agent presets distributed through the
Workshop. `scripts/market-build` reads this directory and emits
`market/dist/manifest/presets.json` plus `market/dist/assets/presets/<id>/`.

## Add a preset

1. Copy `_template/` to `<id>/`. The directory name is the preset id and must
   match `^[a-z0-9][a-z0-9-]*$`; ids the harness ships (`minimal`, `ptc`,
   `standard`, `cordis`) are refused.
2. Edit `preset.yml` (the display text the DSH roster shows: `name`,
   `description`, optional `order`; keep each on one line) and
   `agent.cordis.yml` (the composition).
3. Add a `catalog.json` entry:

   ```json
   {
     "id": "<id>",
     "nameEn": "English name",
     "descriptionEn": "One sentence in English.",
     "author": "github-handle",
     "version": "1.0.0",
     "category": "roleplay",
     "tags": ["review"],
     "rank": 10,
     "repo": "https://github.com/<owner>/<repo>"
   }
   ```

   `id`, `author` and `version` are required; `version` drives the Workshop's
   update notification. `category` is optional and must come from the preset
   category vocabulary in `scripts/market-build` (`roleplay` today); it becomes
   the filter pill on the Workshop card and on the market site, and an entry
   without it lands in the "other" bucket. The Chinese `name`/`description` come from `preset.yml`
   so the DSH roster and the store never disagree.
4. Run `node scripts/market-build` and commit the regenerated `market/dist`.

## What review checks

Content requirements: a published preset must be all-ages. Explicit sexual
content is refused, and so is any character who is under 18 or who is a child
in the work they come from; third-party material needs a redistribution right
and a credited source. The rationale and the roster rules of the first
published batch are recorded in
[Roleplay preset catalog and its content boundary](../../../.agents/notes/implemented/feature/2026-09-10-roleplay-preset-catalog.md).

A preset is code: its composition can name npm plugins, load files that travel
inside the preset directory, and evaluate `!!js` expressions in the DSH host
process. The Workshop therefore installs a preset into an inert library and
only declares it to the agent-preset registry when the user enables it, after
showing the composition profile. Submissions are reviewed for what the
composition loads and why, not only for what it claims to do.
