# Observatory · 天文台

Midnight indigo · aged brass · dome ribs · hour scale

## Palette

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#f1efe9` | `#0a0c12` |
| Panel | `#faf8f3` | `#0f121a` |
| Raised | `#e6e2d8` | `#161a24` |
| Body text | `#1b1d26` | `#e7e9ee` |
| Muted text | `#575a68` | `#8b90a0` |
| Border | `#d5d0c4` | `#232838` |
| Brand | `#7a6530` | `#8e7a3e` |
| Accent | `#9c8038` | `#c2a55a` |

Body-text contrast against the panel: 15.82:1 light, 15.41:1 dark.

**This is a dark-only skin.** The dark values are declared on both `:root` and
`body[data-ds-dark-theme]`, so the same palette renders regardless of the system
setting, and `html { color-scheme: dark !important }` pins native controls.

## Background: an instrument plate with a reserved standee area

The canvas is not a star chart. It is a generated instrument plate
(`scripts/observatory-plate.mjs`), baked into `assets/dome-plate-light.svg` and
`assets/dome-plate-dark.svg`. An observatory is not only about looking at the sky:
it is first of all an instrument, so the motif is the observation room itself.

    dome latitude rings   four very shallow concentric arcs, centre far above the frame
    dome rib seams        seams radiating from the same centre, opening downward
    hour scale            a vernier along the bottom: three tick grades plus the twelve
                          two-hour 时辰 numerals
    rivet row             a row of brass rivets under the scale, each with a highlight

Everything is line work. There is not a single area fill. An earlier revision used a
star chart plus a nebula band as the ground; the problem was that area-shaped elements
mush together. Line work holds up and reads as an instrument.

The composition reserves a standee area: the plate is masked to nothing across the
right ~40%, and a horizon arc plus a very faint plinth glow sit under it, so a
character illustration can simply be layered on top.

### Adding a standee

1. Put the image under `skins/_assets/observatory/` (portrait crop, transparent
   background, subject off to the right works best);
2. add one line to the `observatory` entry in `skins/_palettes.mjs`:

       background: { file: "standin.png", scrim: "linear-gradient(180deg, rgba(6,8,12,0.30) 0%, rgba(6,8,12,0.62) 100%)" },

3. rebuild: `node scripts/build-skin.mjs build observatory`

The build copies it into `assets/` and declares `contributes.backgroundMedia` in
`skin.json` (both modes point at the same file). The scrim holds the illustration's
brightness down and protects body-text readability — Ice Crystal Princess does the
same thing.

## Session header: an instrument beam

The header (`[data-dsh-surface="session-header"]`) is the only horizontal beam in the
shell, so it is built as an instrument beam. All three details are line-only:

    brass rail        an inset 1px b4 line along the top edge, same family as the
                      double frame around the whole app
    dome rib seams    very short vertical lines hanging 18px apart from the top edge,
                      the same motif as the plate
    corner rivets     two rivets sitting in the 10px top padding, same family as the
                      panel seams and the new-session plate

The 8px vernier along the bottom edge is untouched. The header's 76px height is pinned
inside `ConversationRoot`, so every decoration goes through `::before` / `::after` and
`background-image` / `box-shadow`, and none of it takes part in layout. Both modes
flip through `--ob-b3/b4` and `--ob-rivet(-hi)`; there are no hard-coded colours.

> **Do not target hashed class names.** In the source the header is `css.header`
> (compiled to something like `rb_09W_header`), but the semantic adapter already
> provides the stable hook `[data-dsh-surface="session-header"]`
> (from `[data-slot="conversation.session.header"]`). Hashed class names change on
> every official rebuild; use `node scripts/hooks.mjs` to print the current hook table.

### The slot-outlet trap (hit for real on 2026-09-12)

Whenever a `data-dsh-surface` / `data-slot` value is a **slot**, the element itself
carries `display: contents` — it produces no box, so `background-image`, `box-shadow`
and `::before` / `::after` attached to it are **never painted**. CSS still computes
them (`getComputedStyle` returns a value), but the screen stays empty. This is the most
treacherous kind of silent failure.

Measured on the real shell (observatory, dark):

    [data-dsh-surface="session-header"]   rect=[0,0,0,0]  display=contents  bgImage computed but invisible

The correct form is to descend to the outlet's child, which is the layer that actually
has a box:

    [data-dsh-surface="session-header"] > *      <- the real .header
    [data-slot="details"] > *:first-child        <- scope it when drawing an ::after
                                                    label strip, or it draws more than once

For comparison, hooks that are **not** slots — `[data-shell-overlay]`,
`[role="dialog"]` — do have real boxes and can be styled directly.

Note that `.topbar` in the concept renderer (`_audit/observatory.mjs`) is an ordinary
div **with a box**, which is why the concept images always looked fine. This class of
bug cannot be caught by concept images; it only shows up on the real shell.

## Layout

- `skin.json` — v2 manifest
- `skin.css` — L1: all 95 `--dsw-alias-*` semantic tokens
- `patches.css` — L3: sidebar material, hero motif, composer, bubbles, approvals
- `preview/` — preview images

No hooks, no build step.

## Install

Copy this directory to `~/.dsh/skins/observatory/`, then select it in the skin center.

## Regenerate

From the repository root: `node scripts/build-skin.mjs build observatory`.
