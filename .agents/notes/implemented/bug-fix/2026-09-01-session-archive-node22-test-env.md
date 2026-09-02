# Agent Note: Session-archive tests red on CI Node 22 (node:sqlite bundling + projcache write race)

Status: implemented

## Problem

Every CI run on `dev` since commit `c681332b` (the merge that brought the
`dsh-session-archive` package to `origin/dev`) fails in the `Tests` step with
three `dsh-session-archive` suite errors:

```
Error: Cannot bundle Node.js built-in "node:sqlite" imported from
"tests/inventory.spec.ts". Consider disabling environments.client.noExternal
or remove the built-in dependency.
```

`tests/inventory.spec.ts`, `tests/janitor.spec.ts`, and `tests/routes.spec.ts`
all fail this way on CI (Node 22.23.2) while passing on maintainer machines
(Node 24/25), which made the failure look like a CI-only phantom. The red CI
also blocks the merge gate for every open community PR (#1329, #1321, #1306,
#1318, #1144), since the ruleset requires all checks to pass.

Root cause, verified by reproducing under a portable Node v22.23.2: vitest 4
builds vite's per-environment `resolve.external` list from the running
process's `module.builtinModules`. On Node 22.23.2 `node:sqlite` loads fine
but is **not** listed in `builtinModules` (it was only added to that list in
later Node lines), so `node:sqlite` is not externalized. The package's vitest
config runs all specs in the `jsdom` environment (a client consumer with
`noExternal: true`), and vite 8 errors when asked to bundle a Node built-in
for a client environment. Node 24/25 list `sqlite` in `builtinModules`, which
is why local runs stayed green.

While verifying under Node 22, one more defect surfaced: after the
environment fix, `physical delete > removes the directory, ...` failed
intermittently (roughly every other run on Node 22, never on Node 25). The
janitor's `scrubProjcache` fired `writeJsonAtomic` without awaiting it, so
`deleteSessions` could report success before the scrubbed projcache index hit
the disk; the spec reads the file immediately after the call. A real
write/read race, timing-dependent rather than environment-specific.

## Decision

1. The four host-side specs (`inventory`, `janitor`, `routes`, `ledger`) opt
   out of jsdom with a `// @vitest-environment node` file-level override, the
   same pattern `dsh-perf` already uses for its `node:sqlite` specs. These
   suites exercise filesystem, SQLite, and HTTP-server code paths where jsdom
   contributes nothing.
2. `scrubProjcache` becomes async and `deleteSessions` awaits it. A stale
   cache entry stays best-effort (the catch still leaves a corrupt index
   alone), but a successful delete now orders the scrub write before the
   success response.

## Consequences

- `pnpm -r test` is green again on CI's Node 22.23.2 (full
  `dsh-session-archive` suite: 77/77, three consecutive runs) and on Node 24/25.
- The delete flow no longer races its own projcache scrub; consumers reading
  `storages/session_projcache.json` after a reported success see the scrubbed
  state deterministically.
- Future packages importing Node builtins in vitest specs must either set the
  per-file node environment or confirm the builtin is in
  `module.builtinModules` on CI's Node line (22.x), not just importable.

## Alternatives considered

- **Drop `node:sqlite` from the code** in favor of a JS SQLite: rejected, the
  host code legitimately needs the Node builtin and `dsh-perf` already
  depends on it.
- **Add `node:sqlite` to an `environments.client.external` override in the
  vitest config**: masks the real issue (host-only specs running in a browser
  environment) and keeps every spec paying jsdom startup cost.
- **Pin CI to a Node version whose `builtinModules` includes `sqlite`**:
  rejected; the CI pin is deliberately broad (`node-version: 22`), and the
  test environment should be explicit rather than coupled to a Node patch
  release's builtin list.
- **Keep the fire-and-forget write and have the spec poll for the file**:
  fixes the symptom in the test while the production race remains for real
  callers that read the index right after a delete.