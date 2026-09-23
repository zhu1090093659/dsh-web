# Agent Note: Dark-Theme Badge Correction Scoped Under the Skin Selectors

Status: implemented

## Problem

The recommended-badge contrast correction shipped for #1117 never applied. `shellRenderingCss()`
builds every rule by prefixing a selector with the active-visual scope list (`html[data-dsh-skin]`,
`html[data-dsh-custom-theme]:not([data-dsh-skin])`, `html[data-dsh-wallpaper-active]`), but the badge
rule prefixed that already-scoped list with `body[data-ds-dark-theme]`:

```css
body[data-ds-dark-theme] html[data-dsh-skin] [data-question-key] [class*="_badge"] { ... }
```

The dark-theme attribute is set on `<body>` (DSH `packages/client/ui-theme/src/boot-theme.ts:20`),
and `html` is `body`'s ancestor, so the emitted descendant chain cannot match any element. The rule
was inert, and dark-mode users with a skin active kept the near-1:1 badge contrast the correction was
written for (#1490).

## Decision

The `body[data-ds-dark-theme]` compound moved inside the scope argument, so each scope emits
`html[...] body[data-ds-dark-theme] [data-question-key] [class*="_badge"]` — the attribute is now a
descendant of the scope element instead of its ancestor. Two guards cover it in
`tests/shell-rendering.spec.ts`: one asserts the emitted badge selectors carry that order, the other
scans every comma-separated selector of the sheet and rejects the general
"a `body[` compound appears before an `html[` compound" shape, so the same mistake cannot return
through another rule.

## Verification

- `pnpm --filter @linxin666/dsh-client-ui-skin-center test`: 38 files, 631 tests passed (two new).
- `pnpm --filter @linxin666/dsh-client-ui-skin-center typecheck`: passed.
- `pnpm skin-center:check`: passed.
- The committed `lib/client.js` bundle is refreshed by the follow-up build commit, not by hand.

## Alternatives considered

Dropping the `body[data-ds-dark-theme]` qualifier entirely was rejected: it would rewrite badge colors
in light mode too, where the upstream tokens already contrast.

Expressing the condition as `html:has(body[data-ds-dark-theme])` was rejected: the attribute is on
`body`, so an ordinary descendant selector is sufficient, and `:has` would add matching cost and a
wider compatibility surface for no gain.

Fixing only the two badge selectors without a general guard was rejected: the mistake came from
composing a scope helper with a body-level condition, which any later rule can repeat.

## Consequences

The dark-theme badge contrast the project believed it shipped is now actually applied, and the sheet
has a mechanical guard against scope-order mistakes. The upstream `_badge` selector coupling is
unchanged, so an upstream class rename still requires updating this rule.
