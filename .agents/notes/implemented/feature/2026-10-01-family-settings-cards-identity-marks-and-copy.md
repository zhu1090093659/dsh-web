# Agent Note: Family settings cards carry an identity mark and one-line copy

Status: implemented

## Problem

The Web Plugins settings section (`settings.section` id `web-ui-plugins`) opened with its title, a lede sentence that restated that title, and then full-width disclosure rows that were indistinguishable from one another: a name, a second sentence that mostly restated the name, and a small chevron. Nothing in a row identified the plugin, so the page read as two or three identical grey rectangles.

The copy did not pay for its space either. `远程访问设置` / "Remote access settings" repeated a word the page itself already carries, and its subtitle ("配对安全与设备限额。" / "Pairing security and device limits.") restated the same idea twice over. The board card's subtitle enumerated internals ("控制 Host 任务看板、agent 播报与运行期间的系统空闲睡眠保护。"), its two topic hints repeated that enumeration, and the GitHub section's description repeated the parent card's own contents, its nesting and its default state. Inside the board card, the live power facts and the battery caveat rendered as plain body-size paragraphs: the loudest text under a list of settings was a disclaimer.

## Decision

Family plugin cards are identified rows whose second line carries information a scanner can use.

- **The section renders its heading and the cards.** The lede paragraph is gone, and `web-ui-plugins` drops its `description` key in zh, en and the `dsh-i18n` ru mirror: the nav cell and the heading already name the section, so the sentence only pushed the cards down.
- **The shared chrome gains an optional `icon`.** `PluginSettingsCard` renders a 34px quiet tile (`settings-card.module.css` `.mark`) before the header text when a card passes one. A card that passes none keeps the previous official-shaped header, so provider sections and the built-in sibling rows are untouched, and a nested topic card keeps that header shape too unless it opts into the nested density below. The tile takes the card's ink color on hover and while open, which is what makes the whole row read as one control.
- **Card titles drop the redundant noun.** `远程访问设置` is `远程访问`, "Remote access settings" is "Remote access", `Настройки удалённого доступа` is `Удалённый доступ`, and the description becomes "手机配对、公网隧道与设备限额。" / "Phone pairing, public tunnel and device limits.". The zh LAN hint and both `dsh-remote-web-ui` READMEs, which spelled the old card name, follow it.
- **Descriptions say what is inside, not what the plugin is.** The board card reads what its topics hold (originally "任务编排、agent 播报与目标验收。" / "Task orchestration, agent announcement and goal acceptance.", trimmed when [goal acceptance was removed](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.md)); its topic hints and the GitHub section's description lose the words the parent header already carries.
- **The board card's live facts become small print.** The power line and the battery caveat move into `board-settings.module.css` `.power` at 12px below the topic list instead of rendering as unstyled body paragraphs. The block draws no rule of its own: the last topic card already closes with its border.
- **Marks are glyphs the family already speaks.** The remote card reuses the sidebar's `PhoneIcon`; the board card draws a three-column kanban glyph, and its header is the only one in that card that carries a mark.
- **The chrome gains a nested density.** `PluginSettingsCard` takes `density?: 'nested'`, and the variant is an override of the card's own local scale — `--settings-card-radius`, `-header-pad`, `-header-gap`, `-title-size`, `-description-size`, `-body-inset` and `-motion` on `settings-card.module.css` `.card` — so one rule set serves both levels and a consumer that passes nothing renders the first-level card exactly as before. A nested card draws a 10px radius, a 10px 12px header with a 10px gap (its clickable height stays above the 44px touch target), a 13px/600 title against a 12px description that is held to one ellipsised line, and a 12px body inset.
- **A visible hint can be one line.** `FieldProps` gained `hintTitle`: it becomes the hint paragraph's native `title`, so a card shortens the line and keeps the whole sentence on hover. Without one the paragraph renders no title attribute at all, so a card that passes none keeps today's DOM.
- **The header's description and its tooltip are two keys.** The visible line comes from `descriptionKey` (or `descriptionNode`) while the optional `descriptionTitleKey` supplies the header's native `title`; without it the tooltip stays the description itself. A nested card can therefore compress the visible sentence to one line and leave the whole one on hover, instead of keeping a second visible copy of the same paragraph, and both header shapes — the disclosure button and the `alwaysOpen` static row — resolve that title the same way.
- **The body enters and leaves through one transition.** It sits in a `.disclosure` grid that animates `grid-template-rows` 0fr to 1fr plus opacity over `--settings-card-motion` (0.18s), mounts closed for one frame so the enter leg has a state to leave, stays mounted through the leave leg and unmounts only afterwards. Only the moving states clip, so a settled card never cuts off a field popup, and `prefers-reduced-motion: reduce` drops the height travel while keeping the fade and the same 180ms deadline.

## Alternatives considered

**Keep the lede and shorten it.** Rejected: any sentence in that slot either restates "Web Plugins" or explains a settings page to someone already inside it, and the heading plus identified rows carry the same information in less vertical space.

**Mark every level, including nested topics and provider sections.** Rejected: the nested list is a hierarchy inside one plugin, and marking every level flattens it. Only the row that names a plugin gets an identity.

**Change the chrome without an `icon` prop — a per-row accent, a wider chevron, more padding.** Rejected: it leaves the actual complaint (two rows that look the same) in place. The mark is what makes a row recognizable before it is read, and because it is optional nothing else in the shared chrome has to move with it.

**Delete the plugin descriptions and render single-line names.** Rejected: a collapsed disclosure whose name is all an operator sees gives no way to tell what is behind it; one informative line is the useful minimum, and it is now the only sentence.

**Drop the power caveat along with the rest of the long copy.** Rejected: it states an operational guarantee, not an explanation. It stays; only its typography changed.

**Give the nested variant its own set of rules.** Rejected: two rule sets drift the moment one of them gains a state, and the distance between the densities is exactly seven values. Overriding the same local scale keeps one disclosure, one hover, one focus ring and one motion pair for both levels.

## Consequences

- 设置 → Web 插件 opens as a heading plus identified cards, and every card's second line carries information a reader can act on.
- A card that opts into a mark keeps it wherever the card lands, including the official `plugins.bundle.config` seat of a standalone install ([family plugin card seat](../bug-fix/2026-09-17-family-plugin-card-seat-follows-the-loaded-group.md)); the official cards beside it are unchanged.
- Copy lives in the owning packages' zh/en dictionaries with the ru mirrors in `packages/dsh-i18n`; `pnpm i18n:check` covers the three-way parity. No settings key, wire field, ledger schema or stored value changes.
- The nested topic hints shortened here are the ones [task-board settings disclosure cards](./2026-10-01-task-board-settings-disclosure-cards.md) introduced; that note's layout decision stands.
- Coverage: `packages/dsh-task-board/tests/settings-card-disclosure.spec.tsx` asserts the glyph leads the plugin card's header while a nested topic keeps the plain shape without one, and `packages/dsh-web-settings/tests/webui-section.spec.tsx` asserts the section renders its heading and its slot with no copy paragraph left.
- A nested topic card reads as a level below the plugin card it sits in — a 13px title against 15px, a 10px 12px header against 16px, one description line against a wrapping one — without a second component or a second stylesheet; every consumer that passes no `density` keeps the first-level chrome unchanged.
- The body no longer appears or disappears on the click itself: both legs run the same grid/opacity pair, and the reduced-motion path keeps the fade, so a node is neither left mounted nor dropped mid-leg.
- Evidence beyond the unit specs: an isolated scratch-home host (`DSH_HOME=/tmp/dsh-verify-ui`, the web profile, `--port 19401`, default appearance) driven through headless Chromium, captured in [the design-pass archive](../../../docs/archive/2026-10-01-web-plugins-cards-design-pass/transcript.md) (collapsed cards, board topic list, remote form). The user's own host was never restarted, re-bound or signalled.
