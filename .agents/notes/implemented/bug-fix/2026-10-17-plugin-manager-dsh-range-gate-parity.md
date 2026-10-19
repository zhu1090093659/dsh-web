# Agent Note: the update gate evaluates a declared DSH range like the host gate does

Status: implemented

## Problem

The Plugins page's update button refused every release whose `dsh.engines.dsh` declaration was not a single `>=X.Y.Z[-pre]` comparator: it showed "requires DSH ...; upgrade DSH before updating" and disabled the button, while the running DSH satisfied the declaration.

The gate itself ran in two pieces. `packages/dsh-plugin-manager/src/core/version.ts` matched the declaration against `MINIMUM_RANGE_PATTERN = /^>=\s*(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/` and returned undefined for every other form; `compatibleVerdict` in `src/host/routes.ts` then folded undefined into `compatible: false` under #754's fail-closed rule, so "we cannot parse your declaration" reached the user as "your DSH is too old".

Two published third-party plugins hit exactly that path. `dsh-llm-verifier` 0.10.1 declares

```
^0.1.1-rc.2 || ^0.1.2-alpha.1 || ... || ^0.2.1-rc.1 || ^0.2.1-rc.2
```

29 carets and tildes over the 0.1.x / 0.2.x lines (equal to `>=0.1.1-rc.2 <0.3.0`, checked version by version), and `dsh-context` declares `>=0.1.7-rc.2 || >=0.2.0-rc.2`. On a host running `0.2.1-rc.2` both declarations are satisfied, so both plugins were blocked from updating with no way for the user to work around it.

The official boot gate decides differently. app-boot's `evaluatePluginCompatibility` (`packages/boot/app-boot/src/plugin-compatibility.ts`) delegates to `satisfies(runtimeVersion, range)`, which is `range.trim() !== '' && semver.satisfies(runtimeVersion, range, { includePrerelease: true })` — every legal node-semver range form, prereleases included. The installer admits those plugins at boot and the plugin manager then refused to update them: the two gates disagreed about the same declaration.

## Decision

**The requirement is evaluated by semver, with the official call, in a host-only module.**

1. The range verdict moves out of `core/version.ts` into a new host-only module, `packages/dsh-plugin-manager/src/host/dsh-compat.ts`, which exports `evaluateDshCompatibility(host, range): DshCompatibility` — a three-way verdict (`satisfied` / `host-too-low` / `unverifiable`) so that no caller can fold "we could not check" into "your DSH is too old" (issue #1899):

```ts
if (range.trim() === '') return { verdict: 'unverifiable' }
if (semver.validRange(range) === null) return { verdict: 'unverifiable' }
if (semver.valid(host) === null) return { verdict: 'unverifiable' }
return semver.satisfies(host, range, { includePrerelease: true })
  ? { verdict: 'satisfied' }
  : { verdict: 'host-too-low' }
```

   `||`, `^`, `~`, whitespace-separated comparator sets and x-ranges therefore decide here exactly as they decide at boot, and a prerelease host participates in comparison instead of being excluded by npm's default prerelease rule.

2. The host-only placement is the contract, not a preference. `semver` is a node package; `src/core/` is compiled into both halves, and `src/client/` renders the same declaration. The browser half keeps `displayMinimumVersion`'s regex-only display logic untouched (`pnpm libs:write` regenerates only comment text in `packages/dsh-web-all/lib/client.js`; no range parser enters any client bundle). `core/version.ts` keeps `parseDshVersion`, `compareVersions`, `displayMinimumVersion` and `dshRequirementOf` — the requirement reader still owns the field priority (`dsh.engines.dsh` > `engines.dsh` > the `@deepseek-ai/dsh` peer), and `routes.ts` only imports the verdict from the new module.

3. The return contract carries the cause instead of collapsing it: `unverifiable` for an empty declaration, a range node-semver rejects, or a host string that is not one valid version, and `host-too-low` only when a running version was actually compared and lost. `compatibleVerdict` fails closed on both, but reports `hostVersion` only for `host-too-low`: that field is what the browser reads to tell "too old" apart from "could not check", so an `unverifiable` row carrying one renders the upgrade-DSH copy for a declaration nobody evaluated (issue #1899).

4. The empty-declaration guard is explicit because it cannot be delegated: `semver.validRange('')` answers `'*'`, so checking only `validRange` would turn an absent declaration into an unconstrained, satisfied range. The official gate guards the same way (`range.trim() !== ''`).

5. `>= *` now reads as the unconstrained range it is (node-semver normalizes it to `'*'`), so the verdict is satisfied, matching the official gate. The old `version.spec.ts` asserted undefined for it; that assertion is deliberately inverted, with the reason stated at the test.

6. `semver` `^7.8.5` joins the package's `dependencies` (the host half imports it at runtime) and `@types/semver` `^7.8.0` its `devDependencies`.

## Alternatives considered

- **Keep a hand-written range evaluator in `core/version.ts`.** Rejected: it would have to reimplement comparator sets, `||` alternatives, caret and tilde desugaring, x-ranges, prerelease ordering and the `includePrerelease` interaction — a private dialect that drifts from the official gate the moment upstream changes its mind, with exactly the class of disagreement that produced this bug. The user-facing promise is "the same answer the boot gate gives", and only the same library can keep it.
- **Fix the third-party manifests instead (narrow their declarations to `>=X.Y.Z`).** Rejected: those are other repositories' declarations, already accepted by the official installer and boot gate; narrowing them would degrade their own compatibility semantics to fit one parser, would have to be repeated for every future plugin that writes a legal range, and would leave this repository's gate still unable to read the manifest it admits.
- **Evaluate the range in `core/version.ts` so both halves share one function.** Rejected: it would drag semver into the browser bundle through the `displayMinimumVersion` import chain, growing every client bundle for a verdict the browser never computes (the host sends it on the wire).
- **Let the browser evaluate the range as well.** Rejected: the verdict already arrives from the host as `compatible` / `hostVersion`; duplicating the evaluation would add a second source of truth and a second copy of semver in the client bundle.
- **Drop the requirement entirely when it does not match the narrow form (fail open).** Rejected: #754 deliberately fails closed for declarations the gate cannot verify, so a genuinely unsatisfied requirement can never be bypassed. The defect was the parser's reach, not the fail-closed policy — the policy stays for genuinely unverifiable input.

## Consequences

- A declaration in any node-semver range form is now judged by the same call the boot gate makes, so the installer and the plugin manager no longer disagree about the same manifest.
- The gate reaches `semver` through the host half only; a regression that imports `dsh-compat.ts` from `src/client/` would surface at bundle time (semver internals in `lib/client.js`), which the gate's presence in the host directory makes checkable.
- The unverifiable set is narrower and now explicit: an empty declaration, a range node-semver rejects (`nonsense`, a partially valid `||` chain), or a host string that is not one version. Everything else decides.
- The wire carries the cause through `hostVersion`'s presence rather than a new field: a blocked row that names a host version was compared against it, and only that row tells the user to upgrade DSH. Both the detail section and the list-level toolbar read one shared helper (`dshGateOf`) so the two surfaces cannot drift into different copy for the same verdict (issue #1899).
- The display string for a multi-form range stays the raw declaration (`^0.1.0-rc.8`), so copy that names a range the UI cannot shorten reads as the declaration itself.
- `packages/dsh-plugin-manager/package.json` gains a runtime dependency on `semver`, which `pnpm runtime-deps:check` validates against the emitted host `lib/`.
- The family packages' own narrow `>=X.Y.Z` floors are unchanged: `scripts/family-dsh-engines.test.mjs` and `scripts/plugin-template/package.json` still require that form, so the family keeps declaring the shape it means.

## Testing

- `packages/dsh-plugin-manager/tests/dsh-compat.spec.ts` (new): the real 29-segment `dsh-llm-verifier` declaration is satisfied by `0.2.1-rc.2` and rejected by `0.3.0` and `1.0.0`; `dsh-context`'s `>=0.1.7-rc.2 || >=0.2.0-rc.2` is satisfied by `0.2.1-rc.2` and `0.3.0` and rejected by `0.1.0-rc.8`; the single-comparator floors `>=0.1.0-rc.8` / `>=0.1.1-rc.1` keep their previous answers; `^`, `~`, x-range, comparator-set and spaced-comparator forms decide; `>= *` and `*` are satisfied; empty, whitespace-only, `nonsense` and a partially valid `||` chain are undefined; `nope` and `0.1` hosts are undefined.
- `packages/dsh-plugin-manager/tests/version.spec.ts`: the range cases moved out of `meetsMinimumDsh`; `dshRequirementOf` gained a case proving a multi-form range passes through the reader unchanged.
- `packages/dsh-plugin-manager/tests/update-route.spec.ts`: the "cannot verify" case now uses an unparsable range instead of `^0.1.0-rc.8` (which is a legal, evaluated range now), and a new case drives a `>=0.1.7-rc.2 || >=0.2.0-rc.2` release through the route — allowed on `0.2.1-rc.2`, blocked with the declaration and the running version named on `0.1.0-rc.8`. A readable host whose declaration does not parse (`nonsense`, and a partially valid `>=0.1.0-rc.8 || garbage` chain) yields `compatible: false` with no `hostVersion` at all, asserted with an exact `toEqual` so an extra field fails the test; the pre-flight 412 for the same input says "cannot verify" and names the declaration instead of sending the user to upgrade DSH.
- `packages/dsh-plugin-manager/tests/PluginUpdatePatch.spec.tsx` and `tests/plugin-list-toolbar.spec.tsx`: both surfaces render the "could not check" copy from a row without `hostVersion` and the upgrade copy from a row with one, and a release that declares no DSH requirement renders no compatibility line at all.
- Measured through the new module: `0.2.1-rc.2` gives `true` for both real declarations, `0.3.0` gives `false` for `dsh-llm-verifier` and `true` for `dsh-context`, `0.1.0-rc.8` gives `false` for both.
- Gates run for the change: the package `typecheck`, `build` and `vitest run` (366 tests on the 0.4.7 baseline, whose `gateway-jobs` / `gateway` / `rows` suites the upstream live-row-override work extended), `pnpm typecheck`, `pnpm build`, `pnpm libs:write` then `pnpm libs:check`, `pnpm runtime-deps:check`, `pnpm test:standards` (with the baseline ratcheted down for the shrunk `version.spec.ts`), `pnpm test:scripts`, `pnpm docs:check`, `pnpm i18n:check`, `pnpm aggregate:check`. `pnpm lint` adds no finding in the files this change creates and leaves the pre-existing `routes.ts` / `update-route.spec.ts` findings exactly as the baseline had them. A grep of `packages/dsh-web-all/lib/client.js` and `packages/dsh-market/lib/client.js` for `parseComparator`, `replaceCaret`, `class SemVer` and `includePrerelease` returns 0 matches in both.
