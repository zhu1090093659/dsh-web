# Primary-Action Token Contract (v1) — issue #506 follow-up

The filled primary button (the "one-click install" CTA, every plugin's
primary action) renders from **one matched set** in every theme. This file is
the authoritative statement of that set, of what a skin must declare, and of
what the skin-center proves when a skin loads.

## The set

| Token | Role |
| --- | --- |
| `--dsw-alias-button-primary-fill` | Button background |
| `--dsw-alias-button-primary-hover` | Button background while hovered |
| `--dsw-alias-button-primary-dimmed` | Disabled-button tint |
| `--dsw-alias-label-primary-foreground` | Text on the fill |

The official shell declares all four (fill and dimmed derive from
`brand-primary` / statics). `--dsw-alias-brand-primary` and
`--dsw-alias-brand-primary-invert` are **accent and foreground tokens, not a
button pair**: in the current official theme both resolve to the same
theme-neutral, so using them as fill + text renders black-on-black (light) or
white-on-white (dark). Never consume them as a button fill.

## Skin author rules

1. Prefer declaring the full set per theme (light block and
   `body[data-ds-dark-theme]` block), as matched colors.
2. The legacy pair (declare both `brand-primary` and
   `brand-primary-invert`) is still honored: the loader derives fill from
   the brand, derives hover/dimmed toward the surface, and uses the invert
   as the foreground — because the pair is matched by the author.
3. Partial declarations warn (catalog warnings, `dsh-skin validate`,
   `dsh-skin list`) but never fail: the loader completes what is missing,
   and a skin with no brand and no button tokens at all deliberately keeps
   the shell's own matched CTA.
4. The loader never overrides a token the skin defines, and hygiene-wise a
   new skin's button set should be self-contained (explicit
   `button-primary-hover` etc.) rather than relying on derivation.

## Completion matrix (loader, `css-safety/fallback.ts`)

| The skin declares | The loader adds |
| --- | --- |
| `brand-primary` | `button-primary-fill: var(brand-primary)` |
| fill available (explicit or derived) | `button-primary-hover` / `button-primary-dimmed`: `color-mix` toward `--dsw-alias-bg-layer-1` |
| `brand-primary` + `brand-primary-invert` | `label-primary-foreground: var(brand-primary-invert)` |
| nothing (no brand, no button tokens) | nothing — the official shell CTA applies |

## Audit (`css-safety/token-audit.ts`)

Warning-only, never fatal — the completion rules keep every outcome legible.

- Completeness: fill satisfied by `button-primary-fill` or `brand-primary`;
  hover by `button-primary-hover` or the fill anchor; foreground by
  `label-primary-foreground` or the legacy invert pair.
- Contrast: per theme, WCAG 2.x ratio of the resolved foreground vs fill
  (skin values, one `var()` hop, official static palette for
  `--dsw-static-*` references, shell defaults as the fallback stand-ins).
  Below **3:1** warns. Unresolvable chains skip the ratio rather than guess.
- Enforcement points: catalog build (surfaces in `dsh-skin list` and the
  Skin Center diagnostics), `dsh-skin validate` / `install`, and the
  built-in-skins CI gate (zero contract warnings for shipped skins).

## Consumer rule (plugins)

A filled primary button uses the set — fill / hover / foreground — verbatim
(BG = `button-primary-fill`, label = `label-primary-foreground`, hover =
`button-primary-hover`). Do not use `brand-primary` as a button
background, do not introduce per-plugin hardcoded accents, and do not pair
the tokens across families (e.g. brand fill with shell foreground).
