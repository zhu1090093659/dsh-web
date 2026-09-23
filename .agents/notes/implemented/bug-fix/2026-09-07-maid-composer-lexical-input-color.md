# Agent Note: maid-atelier light-scheme composer lexical contenteditable contrast

Status: implemented

## Problem

Issue #1405: In DSH 0.1.2-rc.1, the conversation composer was upgraded to a Lexical contenteditable element (`[data-composer-input]`, `[data-lexical-editor]`, `[contenteditable="true"]`, `.uV2eYG_input`). The previous fix for #1085 relied on the shell rendering typed text through a highlight backdrop div (`[class*="backdrop"]` and `[data-input-mirror]`). In the current shell DOM, those backdrop elements are absent. The composer text color falls back to `--dsw-alias-label-primary` (dark ink `#172347` in light scheme), which is rendered against the skin's scheme-invariant deep-navy card background (`rgba(13, 25, 59, 0.72)`), making typed text unreadable.

## Decision

Update `packages/skins/skin-center/skins/maid-atelier/patches.css` to target the Lexical contenteditable input structure within `[data-composer-card]`:
- Target `[data-composer-input]`, `[data-lexical-editor]`, `[contenteditable="true"]`, and `.uV2eYG_input` with text color `#eef3fc`.
- Set child `span` elements to `color: inherit`.
- Set `caret-color: #bcd2ff` across the contenteditable input and textarea elements.
- Ensure placeholder rules cover `[class*="placeholder"]` and `[data-placeholder]` with `#b6c2e0`.

## Testing

- Unit test added: `packages/skins/skin-center/tests/maid-composer-input-color.spec.ts` (3 pass) asserting all relevant Lexical and contenteditable selectors are pinned to `#eef3fc` and `#bcd2ff`.
- Full skin-center suite: `pnpm --filter @linxin666/dsh-client-ui-skin-center test` (34 test files, 610 passed).
- Catalog check: `pnpm skin-center:check` passed.
