# Agent Note: Central ru language pack (dsh-i18n) and the i18n audit gate

Status: implemented

## Problem

Issue #1300 asks for Web GUI coverage in English and Russian. English was already complete (every family package ships a zh/en locale pair with compile-enforced key parity), but Russian did not exist anywhere, a scan found leaked hardcoded Chinese copy in client bundles, and nothing gated the invariants that make third languages safe: zh/en key parity, placeholder parity, and the absence of untranslated CJK strings outside the dictionaries. Leaving ru inside each of the 15 packages would also scatter the translation workload across as many owners and make external translator contributions review 15 directories.

## Decision

Third languages are carried by one dedicated language-pack plugin, and the invariants are enforced by one repository gate:

- `packages/dsh-i18n` is a pure browser plugin. It calls `ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' })` to extend the shared language catalog and then registers one ru dictionary per family plugin namespace through the single-locale untyped `ctx.locale.register(ns, 'ru', dict)` overload. Source packages stay untouched and keep owning zh/en.
- The ru dictionaries live in `packages/dsh-i18n/src/client/ru/<source-package>.ts` with the ns-to-file mapping in `src/client/ru/index.ts`; first release covers all 15 audited namespaces (1176 keys, full zh coverage). No cross-package imports: key parity between each package's zh dictionary and its ru mirror is enforced purely by the gate.
- Registration failure semantics (verified against `@deepseek-ai/dsh-client-locale` 0.1.2-alpha.2): `addLanguage` throws when the id is occupied or the fallback chain is invalid — the catch continues with dictionary registration because dictionaries resolve their fallback chain at lookup time, not at registration; `register` throws on a duplicate `(ns, locale)` — each namespace catches independently so one foreign owner skips only its own ns; all disposers are idempotent and the combined teardown releases only what registered.
- `scripts/i18n-audit.mjs` (`pnpm i18n:check`, a before-merge gate alongside typecheck/test/docs) loads the real dictionary modules through type stripping, derives each namespace from the package's client entry, verifies zh/en key parity and `{placeholder}` parity across zh/en/ru, verifies every namespace's ru keys cover its zh keys, and scans client files for CJK outside comments (string literals, templates, regex literals, JSX text). `i18n-allow: <reason>` comments opt a line or file out; host-half files warn without failing. `--report` prints per-ns coverage, `--template` exports the translation JSON.
- The leaked copy found by the first gate run was fixed at the source: dsh-perf HUD alert strings moved into the dsh-perf dictionary with `{count}`/`{max}` placeholders (`perf-alert.ts` helper, translate seat bound once and read at call time), dsh-remote-web-ui's portrait-adaptation labels moved into the `remote` dictionary with the translate seat wired through the existing `__dshRemoteAdapt` global (labels re-render on the layer's sync tick), and the git-graph / usage list separators (`、` / `；`) became dictionary keys. The only remaining client CJK are two regex literals in mobile-adapt.ts that match the OFFICIAL picker cell text and carry `i18n-allow` comments.

## Plain-DOM surfaces and the runtime locale (GUI verification follow-up)

The first live GUI round exposed a second mixing cause beyond the shell fallback: the L1 sidebar rows of dsh-task-board, dsh-ssh and dsh-skill-explorer rendered copy through package-local t/tt helpers that pick zh/en from `documentElement.lang`, which the SDK Language switch never touches (the rows stayed Chinese even after a switch to English — proven live). The helpers now prefer a wired SDK translate seat (`ctx.locale.bind(NS)`, set in apply() once the dictionaries register) and fall back to the document-language pick only when unwired; the shared sidebar-entry core adds an optional `refresh` subscription re-applying label / aria-label / tooltip on locale changes, and the board / panel mounts re-render an open view on the same `ctx.locale.subscribe` signal.

## Alternatives considered

- Ship ru dictionaries inside each package (`register(ns, { zh, en, ru })` or a third key in every locales file): rejected — the typed two-locale overload and the packages' own `Record<zhKey, string>` contracts are built around zh/en, fifteen directories of translation copy would multiply review surface for external contributors, and a single pack can add more languages later without touching every package again.
- Register the language without dictionaries (catalog entry only, translate on demand): rejected — the issue's ask is full coverage, and an empty ru option whose every string falls back to English is worse than no option.
- Gate only key parity (no CJK scan): rejected — the audit's first run caught eight real leaked strings that key parity cannot see; the scan is what turns "no hardcoded copy" from convention into an enforced contract.

## Consequences

- New family packages must append one PACKAGES entry in `scripts/i18n-audit.mjs`, one ru file plus one mapping line in dsh-i18n, and pass `pnpm i18n:check`; adding or changing a zh key in any existing package requires mirroring ru in dsh-i18n in the same change.
- The audit depends on dictionary modules being loadable plain TS; a package whose locale files grow non-strippable syntax (enums, namespaces) breaks the gate load and must stay within plain-object dictionaries.
- Two client regex literals in `mobile-adapt.ts` are permanently exempt by marker; deleting the official zh/en picker vocabulary they match requires removing the markers in the same change.
- Verification: `pnpm i18n:check` green at 15 namespaces / 1176 zh keys / 1176 ru keys / 100% ru coverage / 2 line exemptions; dsh-i18n typecheck, test and build green; aggregate regenerated with the `web-ui-i18n` row and `pnpm aggregate:check` green. The bundle row change requires a user-side DSH restart before Русский appears under Settings -> General -> Language. The sidebar follow-up: typecheck/test/scripts/i18n green, and a live switch to Русский flipped the family sidebar rows to «Доска задач» / «Центр навыков» without a reload.
