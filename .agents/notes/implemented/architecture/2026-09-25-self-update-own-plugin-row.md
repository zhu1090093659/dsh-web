# Agent Note: the family self-update is its own plugin row

Status: implemented

> Part of this decision is superseded: the aggregate no longer mounts the row and no longer depends on the package — see [The family aggregate retires the self-update row](2026-11-01-retire-dsh-update-from-aggregate.md). The package, its row id `update`, the host/browser split and the desktop/web seat split stand as decided here.

## Problem

The dsh-web family self-update surface — the sidebar download trigger, its panel, and the `/api/update` routes — shipped inside `dsh-remote-web-ui`. The sidebar foot renders one trigger per plugin row, so the update entry's lifecycle was the remote-access plugin's lifecycle: turning remote access off (`enabled: false`) or disabling the `web-ui-remote-web-ui` row removed the update trigger too. That outcome is reachable without any intent to give up self-update — a profile that disables remote access for security reasons loses its only in-GUI way to update the family.

## Decision

- **The capability owns its own package and row.** `packages/dsh-update` (`@linxin666/dsh-update`) declares row id `update`; a profile mounts it by installing that package, and the aggregate no longer carries the `web-ui-update` row ([the aggregate retires the self-update row](2026-11-01-retire-dsh-update-from-aggregate.md)).
- **The host half moved with it.** `update.ts` (registry probe, profile anchoring, verified `pnpm update --latest`) and `update-routes.ts` (`/api/update/status`, `/api/update/run`) live in that package; its entry mounts the two exact routes behind the shared `isLoopbackRequest` fence. The fallback anchor package is this package (`SELF_PACKAGE = '@linxin666/dsh-update'`); `@linxin666/dsh-web-all` stays the primary anchor.
- **The browser half registers its own seat.** The trigger and panel register into the official `sidebar.footer.action` slot under entry id `update`, with the new `update` dictionary namespace and `data-dsh-plugin="update"` (`entry` / `panel` parts) on the DOM.
- **`dsh-remote-web-ui` keeps only the channel facts about the path.** `/api/update/` stays in its gated-channel tables (the rewrite prefix and the physically-local list): a paired remote must not reach the endpoint, whichever package serves it.
- **The desktop shell mounts no seat.** `shouldMountUpdateSeat` (src/client/page-target.ts) refuses the seat on an application-delivered page — the DSH Desktop shell's `dsh-app://app/` — because that application owns its own updater; the page's sidebar seat keeps only the phone-remote trigger. The decision names the *web* side (`WEB_PAGE_SCHEMES`), mirroring the pairing fence's classification in `dsh-remote-web-ui/src/remote-channel-rules.ts`; the two lists describe one fact and move together.
- **The seat geometry stays where it was.** The wide-foot row and rail-stacking rules remain in `dsh-remote-web-ui`'s CSS module — they are the seat container's rules, shared by every occupant. With that plugin disabled the update trigger falls back to the shell's own stacked foot: it still renders and works, only the shared-row optimum is lost.

## Testing

- The moved specs follow the feature: `packages/dsh-update/tests/update.spec.ts` (63) and `tests/update-entry.spec.tsx` (11), plus `tests/footer-trigger-css.spec.ts` pinning the trigger's shape family (#1035) in its new home.
- New `packages/dsh-update/tests/update-routes.spec.ts` (6) exercises both routes over a real loopback HTTP server: the status/run JSON contracts, the 405 method gates, the non-loopback Host refusal and the cross-site refusal — each asserting the injected seams did not run.
- `pnpm i18n:check` covers the moved 42-key `update` namespace; the ru dictionary moved to `packages/dsh-i18n/src/client/ru/update.ts` and the audit package list gained its row.

## Alternatives considered

- Gating only the remote setting while keeping the update seat mounted inside one package: rejected — the row's own disable switch would still take the update trigger away, and a package named `dsh-remote-web-ui` owning the family updater keeps two capabilities under one owner.
- Two rows from one package: rejected — the client module scanner resolves one `dsh.client` face per package, so both rows would load the same client half and could not be toggled apart.
- Moving the seat geometry into the new package or the aggregate compat layer: rejected — it is the official seat's layout, shared by every occupant; one owner plus the shell's own fallback keeps one home per fact.

## Consequences

- Disabling remote access (the setting or the whole row) keeps the update trigger; disabling `dsh-update` keeps remote access. Each row is toggled on its own in the plugin manager.
- The row belongs to `@linxin666/dsh-update` alone: a profile gets the `update` row only by installing that package, and the aggregate's `web-ui-update` mount is retired ([the aggregate retires the self-update row](2026-11-01-retire-dsh-update-from-aggregate.md)).
- A standalone `dsh-update` install anchors on its own package manifest when `@linxin666/dsh-web-all` is absent.
- The ru dictionary, the sync manifest (console-output/http/loopback/mount-once/telemetry/vitest.setup copies) and the i18n audit package list each carry their new consumer row.
- The semantic-attributes contract table in the dsh-skins repository needs a row for the `update` plugin and its `entry`/`panel` parts; that repository owns the table, so it is a cross-repo follow-up.
