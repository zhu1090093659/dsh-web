# miku-pet — Miku desktop pet for the DeepSeek Harness Web UI

> A floating companion plugin that is exclusively Miku, with hand-drawn frame animations and
> desktop-pet gameplay, coexisting with the built-in dsh-pet.

## Features

- **Miku-only frame animations**: idle (stop), scratch, blink ×2, eat, drag, fall-and-stand-up (standup), work / success / fail
- **Desktop-parity random idle**: while idle, a dice is rolled every 5 seconds with a 60% chance to
  play a random action (scratch / blink / eat); after 2 consecutive misses the next roll is guaranteed
  (pity timer). Driven by config.jsonc weights (idle 40 / small-actions 36 / eat 24)
- **Drag**: the drag pose loops while held; on release it plays the "fall then stand up" sequence once
  and returns to the idle loop
- **Click interaction**: a click plays a random blink / scratch reaction with a matching speech bubble;
  random actions also pop action-specific bubbles
- **Continuous work + wallet**: the hover menu's "work" action rolls a judgement every 10 s
  (50% success: +3 coins / 50% fail: -1 coin, balance floor 0) and keeps looping until interrupted;
  the "shop" sells food to restore hunger (insufficient coins rejected; stats clamped to 0-100)
- **Left stat bars (hover)**: hunger / mood / energy (0-100, orange/pink/green); hunger decays every
  60 s (-1 idle, -5 while working)
- **Two-level hover menu**: level 1 lists buttons (rename / wallet / shop / work); clicking enters a
  level-2 view or acts directly; the pet name persists in localStorage
- **Namespaced**: host routes `/miku-pet/*` and entry id `miku-pet`, coexisting with the built-in
  dsh-pet of dsh-web-ui (`/pet/*` + `/api/pet/*`)
- Theme-proof: menus, shop and stat bars are always white-backed with dark text (high-specificity
  overrides, immune to GUI skins)
- Zero LLM/API calls at runtime

## Install

```sh
# Build (esbuild dual entry -> lib/)
npm install
npm run bundle

# Install into the host (dsh CLI example)
dsh plugin --profile web add <this-package-path-or miku-pet>
# Then write into ~/.dsh/profiles/web/cordis.patch.yml (config-level HMR, applies live):
#   - insert:
#       - id: miku-pet
#         name: 'miku-pet'
```

- After changes: `npm run bundle` then hard-refresh the browser (Ctrl+Shift+R)
- Host code (`lib/index.js`) changes require a dsh web restart; client bundle changes are served
  from disk immediately

## Configuration (`assets/config.jsonc`)

```jsonc
"animationWeights": { "idle": 40, "turn": 0, "move": 0 },   // categories sum 60 = 60% action
"categories": [
  { "id": "small-actions", "weight": 36, "actions": ["scratch", "blink1", "blink2"] },
  { "id": "eat",           "weight": 24, "actions": ["eat"] }
],
"phrases": { "scratch": ["..."], "blink1": ["..."], "blink2": ["..."], "eat": ["..."],
             "success": ["..."], "fail": ["..."] }
```

Weights and bubbles are config-only. New frame art goes into `assets/thumb/<action>/`
(`name_frame_ms.png` for parseable durations; loose names sort by trailing number, default 200ms)
and is wired into the matching config.jsonc pool (categories / clicks / standup, etc.).

## Coexistence notes

- Coexists with `@linxin666/dsh-web-ui-all` (built-in pet): never change the entry id / route prefix
  back to `pet` or `web-ui-*`
- Config and frame requests carry cache-busting parameters, so asset updates appear after a refresh

## License

MIT (Miku art and code only; art copyright belongs to the author)