# Blue-throated Bee-eater pet — validation record

Status: contribution validation snapshot (final, 2026-09-07)

## What shipped

A built-in sprite2d pet for dsh-pet (`packages/dsh-pet/assets/blue-throated-bee-eater/`):

- `pet.json` — manifest v2; 8 columns x 9 rows of 192x208 cells; frames [6, 8, 8, 4, 5, 8, 6, 6, 6]; all nine track rhythms at the shared slow baseline; all seven ActivityPhase sequences (tool cycle: running-right, running, running-left, running, running-right; done: jumping, waving, idle, waving, idle, waving); bee remarks block (pet / petCooldown / feed / feedCooldown / noTreats).
- `voice.json` — panel overrides: treats stat labelled 小蜜蜂 {n}; feed/rename/hide actions default labels (feed label left at the i18n copy 喂食/Feed).
- `spritesheet.webp` + `previews/*.gif` x9 — composed by `docs/archive/blue-throated-bee-eater-pet/gen-pet.py` (AI-route composer; pixel pipeline archived as gen-pet-pixel.py, early procedural attempts superseded).

## Art route and provenance

- 12 transparent RGBA reference illustrations contributed by the repository contributor via an AI image tool (archived as source/ref-01..ref-12), same character throughout, palette anchored on the blue-throated-bee-eater skin tokens. Declared Apache-2.0, author dsh-web.
- Per-track standalone poses: perched (ref-01), flying V (ref-02), front hover (ref-03), wing wave (ref-04), crouch (ref-05, retired from the pipeline), droop (ref-06), head tilt (ref-07), head-up review (ref-08), launch flare (ref-09), touchdown (ref-10), perched eyes-closed blink (ref-11, kept for the waiting track), front eyes-closed (ref-12, retired from the pipeline).
- The `jumping` row is the landing sequence (done phase): cruise high -> descend -> flare wings wide -> touchdown -> settle; the contract row name stays `jumping` (shared hatch-pet contract, used by every existing pet).
- Blink policy after review: idle and front hover do not blink; the waiting track keeps its blink beat (ref-11 at frame 4).
- Procedural redraw attempts (flat PIL, gradient vector, programmatic pixel art) are archived as reviewed-and-rejected alternatives; the AI-illustration route is the shipped variant.

## Validation gates

| Gate | Command | Result |
| --- | --- | --- |
| Manifest + assets + voice pack | `node scripts/dsh-pet validate packages/dsh-pet/assets/blue-throated-bee-eater` | PASS, zero diagnostics |
| Package build / tests | `pnpm --filter @linxin666/dsh-pet build` / `test` | PASS (471 tests; registry entry assertions) |
| Typecheck | `pnpm typecheck` | PASS |
| Workshop build/consistency | `node scripts/market-build` / `--check` | PASS (new pets tree + pets.json rank-1 entry; dist up to date) |
| Docs pairs / i18n | `node scripts/verify-docs.mjs --write dsh-pet` / `pnpm docs:check` / `pnpm i18n:check` | PASS |
| Full suite | `pnpm test` | PASS except the pre-existing `dsh-remote-web-ui returns a fixed 502 message` 5 s timeout, reproduced on the clean origin/dev baseline (environment-dependent, unrelated) |

## Real-GUI evidence

Scratch DSH web instance (scratch home + official dsh CLI; verified against the real registry): the pet renders docked with the correct tray (小蜜蜂 treats stat, feed label from the i18n copy), the landing sequence plays on the done phase, and the nine previews animate with the final choreography. Evidence files in this directory: gui-pet-dock-a/b/c.png, gui-pet-animation-strip.png, gui-panel.png, pets-api.json, contact-sheet.png, zoom-sheet.png, strip-jump.png (landing), strip-idle.png, strip-front.png, strip-waiting.png, user-sheet*.png (source previews), compare-idle.png. Superseded-route evidence (from the flat PIL, gradient and pixel-art attempts) is kept only in git history, not in the shipped archive.

## Rejected / no-go notes (kept for the record)

- Pixel-art and programmatic flat/gradient art: reached the contributor's visual ceiling; the pixel pipeline stays in git history as gen-pet-pixel.py (evidence files from those attempts were removed from the shipped archive).
- Renaming the `jumping` row to `landing`: rejected — it is the shared hatch-pet contract name used by every existing pet (per the contributor's rule: repository convention stays).
- Pet bubble color tokenization (skin-driven bubbles): attempted, then reverted per "if the repository owner would not want it, do not do it" — the shared pet client chrome stays untouched; bubble palette remains the pet plugin's blue family.
- Blink on idle / front hover: removed after review (kept only on waiting).
- Crouch absorb frame in the landing: removed (landing ends at touchdown; idle fallback handles the settle).
