# Agent Note: Task-board settings open as collapsed topic cards

Status: implemented

Extended by [family settings cards carry an identity mark and one-line copy](./2026-10-01-family-settings-cards-identity-marks-and-copy.md): the two topic descriptions and the card's copy line are shortened, and the power-status lines become quiet small print; the disclosure layout itself is unchanged.

Extended by [new-card defaults](./2026-10-14-task-board-new-card-defaults.md) and narrowed by [Remove task-board /goal runs and goal acceptance](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.md): after the Runtime behavior and Task acceptance topic cards were removed, the board's own options are two nested topic cards (Basics and New-card defaults) ahead of the provider seat; the disclosure layout itself is unchanged.

## Problem

The board's own settings card rendered every option in one flat body: the master
switch, the agent announcement, the idle-sleep protection, the subtask depth
limit, and the whole goal-acceptance block (switch, judge model, reasoning level
and the resolved preview), followed by the provider seat the GitHub Issues
extension contributes into.

Only the contributed card was a disclosure. The card's own options were always
visible, so opening the board card to reach one switch flooded the settings page
with copy nobody asked for, and the acceptance block's long hint dominated the
column.

## Decision

The settings card is a list of collapsed topic cards, the layout the task form
already uses ([task form regions](./2026-09-27-task-board-create-dialog-regions.md))
applied to the settings surface.

- The card's own options are two nested `PluginSettingsCard` disclosures —
  Basics (master switch, agent announcement, idle-sleep
  protection, forwarded-proxy trust, poll cadence, subtask depth, launch width, spend cap) and new-card defaults ([new-card defaults](./2026-10-14-task-board-new-card-defaults.md); the historical task-acceptance card was removed in [2026-11-11](../simplification/2026-11-11-remove-task-board-goal-run-and-acceptance.md)) —
  rendered into the same list (`board-settings.module.css` `.nestedCards`) that
  already hosts the provider seat.
- Every nested card starts collapsed (`defaultOpen={false}`), on the board
  card's built-in topics and on the GitHub Issues section alike, so the settings page
  opens as a short topic list.
- The nested cards carry `hideFooter`: they stage into the board card's one form
  and are written by its single save row, which stays the only save affordance.
  Their chrome state therefore reports `dirty: false` — the outer header owns the
  unsaved pill — while `writable` follows the form so a read-only deployment still
  says so inside an expanded topic.
- The board card keeps its own disclosure header and its power-status lines;
  only the options moved.

### Copy

`settings.enabledCardHint` and `settings.cardDefaultsCardBrief` are the built-in
topic descriptions (zh and en in the package, ru mirrored in `packages/dsh-i18n`; the historical `settings.goalVerificationCardHint` key was removed with task acceptance).
The long field hints stay on the fields they explain, so a collapsed header is
one line of description.

## Alternatives considered

**Leave the flat layout and only collapse the acceptance block.** Rejected: the
master switch is what the user opens the board card for, and a page whose first
row is a wall of hint text is what the report was about.

**Give each nested card its own save footer.** Rejected: the card's topics write
one settings namespace through one atomic mutation; a save button per topic for one
document invites a partial save and a second confirmation step with no effect.

**Move the remaining board fields (announcement, idle sleep, subtask depth) out
of the first topic.** Rejected: they are the board's own runtime behavior and are
meaningless with the board switched off; splitting them from the master switch
would have left orphan fields between two cards.

**A new accordion component instead of the shared card chrome.** Rejected: the
provider seat already renders the shared `PluginSettingsCard` in exactly this list,
and the request was for the same chrome; a second disclosure recipe would drift
from it.

## Consequences

- The board card opens as its built-in topic rows plus provider seats and the power-status lines; each topic
  is one click away and keeps its own fields and hints.
- The GitHub Issues section starts collapsed, so its repository and credential
  summary needs one click to read; it keeps its own save row for its own namespace.
  Inside that section the repository list is a second disclosure of its own
  (`setupDisclosure` in the extension stylesheet, collapsed on arrival): a
  deployment syncing several repositories showed every row at once and pushed the
  credential form and the connection test off the column. A row is two lines - the
  repository name with its take-unassigned and remove buttons beside it, and the
  inclusion-label, assignee and unassigned chips wrapping on the line below -
  because one line let the chips be ellipsised to `d...`/`@...` by the actions
  sharing it (`setupRepositoryHead` / `setupRepositoryTags`). The toggle carries
  `aria-expanded`/`aria-controls` and names the repository count in its accessible
  label, and the rows leave the DOM while it is closed.
- The disclosure changed no stored value, wire field or ledger schema and added no
  settings key of its own: only presentation and copy keys.
- Coverage: `packages/dsh-task-board/tests/settings-card-disclosure.spec.tsx` drives
  the whole disclosure in jsdom (one header while collapsed, four collapsed
  topics after expanding, each topic's controls and the provider seat inside one
  list) and `packages/dsh-task-board-github/tests/github-ui.spec.tsx` covers the
  contributed card's collapsed default.
- Evidence beyond the unit specs: a scratch-home host (`DSH_HOME=/tmp/dsh-verify`,
  the web profile's local aggregate, `--port 19400`) was driven through headless
  Chrome CDP and captured under `packages/dsh-task-board/docs/e2e/`
  (`tb-settings-topics-collapsed.png`, `tb-settings-board-topic-open.png`,
  `tb-settings-acceptance-topic-open.png`, plus the transcript). The user's own
  host was never restarted or re-bound; a page refresh picks the rebuilt bundle up.