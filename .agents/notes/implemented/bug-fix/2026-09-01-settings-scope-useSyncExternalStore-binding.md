# Agent Note: Settings-scope subscription in AutoSettingsPanel binds prototype methods before useSyncExternalStore

Status: implemented

## Problem

After the v0.3.11 restart the DSH web console logged a slot crash the moment
the session-archive settings section rendered:

```
TypeError: Cannot read properties of undefined (reading 'store')
    at getSnapshot (client.js:998)        <- official dsh-client-ui-settings bundle
    at useSyncExternalStore (frontend bundle)
    at AutoSettingsPanel (AutoSettings.tsx:76)
slot entry crashed in 'settings.section'
```

Root cause: `AutoSettings.tsx` passed `props.settings.subscribe` and
`props.settings.getSnapshot` to `useSyncExternalStore` as bare references.
The settings prop is the official `SettingsScope` instance whose
`subscribe`/`getSnapshot` are prototype methods reading `this.store`;
React invokes both callbacks as bare functions, so `this` is `undefined`
and the first `getSnapshot()` call threw. The line was added on 2026-08-31
as the "checkbox subscription" fix and shipped in v0.3.11 without a render
verification, so every install crashes the section on first render.

## Decision

`AutoSettingsPanel` now binds both methods to the scope with `useMemo`
(`settings.subscribe.bind(settings)`), keeping stable hook identities across
renders (the scope object itself is identity-stable per entry, so no
resubscribe churn).

An audit of every `useSyncExternalStore` call site in the monorepo
(doctor, market, pet, session-id, session-archive, ssh, usage) confirmed all
other stores are closure-based (`createSnapshotStore` instances or object
literals with arrow methods) and are safe unbound; the settings scope was the
only prototype-method surface passed as a callback.

A regression spec (`tests/auto-settings.spec.tsx`) renders the panel against
a deliberate prototype-method scope fake, plus a premise guard asserting that
a detached call of that fake crashes — pinning the official-scope semantics
the binding protects.

## Consequences

- The section renders and its checkboxes stay reactive (the original goal of
  the 2026-08-31 fix is preserved, now without the crash).
- The rebuilt `lib/client.js` is served per request through the link
  profile, so the fix takes effect on page refresh; no host restart.
- The same startup console session also surfaced an unrelated uncaught error
  from the third-party `@eddyskywalker/dsh-chatgpt-subscription@0.1.36`
  (its `codex-subscription-quota` entry inject calls
  `ctx.modelDirectories.directoryFor()` and the alpha.3 host's stricter
  inject-scope guard rejects the undeclared `remote.session` read). That
  plugin is not this repository's code; remediation is removing its bundle
  row from the live profile and restarting, or an upstream alpha.3-compatible
  release. Recorded here only as diagnosis context.

## Verification

- `pnpm vitest run tests/auto-settings.spec.tsx`: 2 passed.
- Package suite `pnpm test`: 9 files, 79 tests passed; `pnpm typecheck` clean.
- Repository-wide `pnpm typecheck`: all packages Done.
- `tsdown` rebuild of `lib/client.js` (served bundle) completed.
