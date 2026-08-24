# Agent Note: Version notes card inside the Web UI plugins group

Status: implemented

## Problem

Upstream issue #1074 asked for a panel that tells users what an update
brought. The first implementation answered with a dedicated first-level
settings section (`web-ui-whats-new`, order 100) placed above the Web UI
plugins group. That gave a one-off changelog its own top-level nav cell:
it inflated the settings navigation for content most users read once, and
it broke the family nav-icon CSS gating, which assumes the four family
sections are the last four of exactly eight nav cells. The second
iteration folded the notes into a disclosure sub-card inside the group,
which kept the nav clean but buried a long document in the settings flow
and read as a form row rather than a release page.

## Decision

The Web UI plugins group section ends with a compact "Version Notes"
entry row: title, one-line description, a version pill, and a "new" pill
while the release is unacknowledged. Clicking the row opens the full
release page in the primitives `Modal` (headless, widened to 640px) - the
same token-driven overlay dsh-market and dsh-plugin-manager already use -
with a chrome-bar title bar (macOS-style traffic-light dots), a hero
section (kicker "What's new in vX.Y.Z", product title, date, lede),
horizontal highlight cards with square kind badges and dashed separators,
the per-category New / Improved / Fixed bullet lists, a primary+ghost
footer button pair, and a "Don't auto-popup update notes" checkbox.
Scrolling happens inside the rounded card.

Opening the page acknowledges the release: the seen version persists
immediately via the `whats-new.ts` last-seen key and the pill clears
without a separate click. On first mount after a version upgrade, the
modal auto-pops once (方案 D): `shouldAutoPopup()` checks both
`hasNewRelease` and that the modal was not yet auto-shown for the
current version (tracked via `WHATS_NEW_AUTO_SHOWN_KEY`). The auto-shown
flag is persisted immediately so subsequent mounts suppress the popup.
The "Don't auto-popup" checkbox toggles the suppress preference without
closing the modal; closing via Got it / Escape / mask always acknowledges
the release (clearing the pill) and persists the suppress preference
regardless of the checkbox state.

The `web-ui-whats-new` section, its locale namespace, and
`WhatsNewSection.tsx`/`whats-new-locales.ts` are gone; the card copy
joins the `web-ui-plugins` locale namespace since the entry renders
inside that section's tree, and `@deepseek-ai/dsh-client-ui-primitives`
joins the devDependencies as a platform-seed value import. A host without
localStorage never advertises a fresh release instead of crashing. Storage
that throws on access (e.g. private-browsing edge cases) is also handled
gracefully: the component renders without a "new" pill and disables
auto-popup. Release data still comes from `release-notes.ts`.

## Testing

`pnpm --filter @linxin666/dsh-client-ui-web-ui-settings typecheck`,
`build`, and `test` pass (109 tests across 12 files);
`client-apply.spec.tsx` asserts no standalone changelog section is
registered anymore, `release-notes-card.spec.tsx` covers the entry row,
the open-counts-as-read flow, release-page rendering, the three close
paths (acknowledge button, Escape, mask click), auto-popup on first
mount (and suppression via auto-shown flag), the "don't auto-popup"
checkbox (toggles preference without closing; close always persists),
broken-storage resilience, `webui-section.spec.tsx` covers the entry's
presence inside the group, and `whats-new.spec.ts` covers the
`shouldAutoPopup`, `readAutoShown`, `setAutoShown`, `readSuppress`, and
`setSuppress` helpers.

## Alternatives considered

- Keep the standalone first-level section but restyle it. Rejected: it
  still spends a nav cell on read-once content and still breaks the
  eight-cell icon gating; the user explicitly wanted one settings entry
  fewer.
- Keep the inline disclosure sub-card (second iteration). Rejected by the
  user as not presentation-worthy: the long body stretched the settings
  page and the fold read as a settings form, not a release page.
- Register the notes entry into the `web-ui.plugin.item` child slot.
  Rejected: the slot is the extension point for external family plugins;
  a built-in static child avoids inventing an owner contract and keeps
  the entry shipped by the same package that owns the release data.
- Reuse the shared PluginSettingsCard component directly. Rejected: it is
  a generated sync-shared copy bound to staged form state (`CardShell`),
  which the read-only notes entry does not have; mirroring its chrome in
  local CSS keeps the entry dependency-free.
