# Agent Note: Issue batch 1668-1670 — the skin-center store escape, the desktop pnpm store residue, and the stale community copy

Status: implemented

## Problem

Three open reports, all confirmed against this checkout before any edit:

1. **#1668 — an unauthenticated request could delete the whole skin-center tree.** `safeStoreId()` in `packages/skins/skin-center/src/we-routes.ts` sanitized with `/[^a-zA-Z0-9._-]/g`, a class that keeps `.`. So `imported/..` stripped its prefix to `..`, survived sanitization, and `joinPath(storeDir, '..')` resolved one level above the store root. `/we/remove` checked only that the id started with `imported/` and that the target existed, then ran `rmSync(dest, { recursive: true, force: true })`. Because the store root is `<harnessHome>/skin-center/wallpapers` (`we-library.ts`), the recursive delete removed the entire `skin-center` tree. The route family's only gate is `requireSameOrigin`, which by design passes requests carrying no `Origin` and no `Sec-Fetch-*` header, so a bare `curl` from the same network reached it with no credential. Reproduced here against the real route factory: `POST /remove {"id":"imported/.."}` answered `200 {"ok":true}` and the tree was gone. The same sanitizer feeds `/we/reimport`, which also calls `rmSync`; there the later `source-gone` 410 stopped the chain, so it was not independently exploitable, but it depended on the same broken invariant.

2. **#1669 — the shipped desktop payload pinned the build machine's pnpm store.** `desktop/scripts/build-runtime.mjs` installs both runtime parts on the CI runner and copies `node_modules` verbatim into the staged payload. pnpm records the producing store in `node_modules/.modules.yaml`, so the shipped tree carried `/Users/runner/setup-pnpm/...`, a directory that exists on no user machine. Any in-app plugin or dependency update then aborted with `ERR_PNPM_UNEXPECTED_STORE`. Reproduced here with the repository's pinned pnpm 11.24.0: after pointing a recorded `storeDir` at an unreachable path, `pnpm add` exited 1 with that error while `pnpm install` succeeded — which is why the release smoke test, that only boots the host, never caught it.

3. **#1670 — the archived-chats community entry advertised removed functionality.** `packages/dsh-community-plugins/community.json` still named the plugin "会话档案 / Session Archive" and promised "历史版本恢复为副本 / History restore-as-copy", both removed in the plugin's 1.4.1; the generated `market/dist/manifest/plugins.json` repeated the copy.

## Decision

**The store path is proven to be inside the store, not assumed to be.** A new `storeEntryPath(storeDir, id)` rejects dot-only segments before the join (`^\.{1,2}$`, so the caller answers a deterministic `bad-id` rather than a sanitized miss on a name like `__`), joins the sanitized name, and then asserts the resolved path starts with the store root plus a separator, returning null otherwise. All three call sites — `/import`, `/reimport`, `/remove` — go through it and answer `400 bad-id` on null. `safeStoreId` itself also folds `.` and `..` into placeholder names, so no caller can obtain a path segment from it. Containment is asserted on the resolved path because the property the recursive deletes actually need is "stays below the store root", and sanitizing one segment cannot prove that.

**The staged desktop payload carries no pnpm store record.** `removePnpmModulesManifests(root)` deletes every `node_modules/.modules.yaml` at any depth of the staged tree, and `stage()` fails loudly if it removed none, so a future pnpm layout change surfaces as a build failure instead of a silently broken installer. Deleting the whole file is the fix, verified against pnpm 11.24.0: stripping only the `storeDir` line still fails (pnpm then reports the store as `undefined`), and running `pnpm install` at seed time does not rewrite the recorded path either; with the file gone, pnpm rebuilds it against the user's own store and `pnpm add` succeeds. The `.pnpm` virtual store and its links, which is what the runtime resolves through, are untouched.

**The community entry describes the shipped plugin.** `community.json` is updated to the 1.4.1 identity the author supplied — "归档管理 / Archive Management" with the History claim removed — and `market/dist` is regenerated from it, since community.json is the single source of the market plugin manifest.

## Alternatives considered

- **#1668: reject only inside `safeStoreId`.** Rejected as the sole fix: it repairs the sanitizer but leaves the deletes trusting a name-level property. A future id shape that survives sanitization would reintroduce the escape at a call site nobody re-audited. The containment assertion is what makes the invariant local to the operation that depends on it.
- **#1668: only fix `/we/remove`, the reported route.** Rejected: `/we/reimport` shares both the sanitizer and the recursive `rmSync`, and its reachability then rested on an unrelated 410. Fixing the shared helper covers both without special-casing a route.
- **#1668: require a credential on `/we/remove`.** Rejected: the route family is a same-origin loopback API whose token model assumes a local trusted GUI, and the missing check that actually mattered is the path containment. Adding an auth scheme here would be a larger contract change and would not stop a path escape from any other caller. Same reasoning the repository already applies to the same-origin fence.
- **#1669: strip the `storeDir` line (the issue's first suggestion).** Rejected on measurement, not preference: with the key removed pnpm 11.24.0 reports the dependencies as "linked from the store at undefined" and still exits 1. The suggestion does not fix the reported failure.
- **#1669: run `pnpm install` after seeding on the user machine (the issue's second suggestion).** Rejected on measurement: a plain `pnpm install` leaves the recorded `storeDir` unchanged, and the following `pnpm add` still failed in the reproduction.
- **#1669: detect a stale `storeDir` at update time on the desktop side (the issue's third suggestion).** Rejected as the primary fix: it makes every launch carry a repair path for a defect that belongs to packaging, and leaves the bad bytes in the installer. Removing the file at stage time means the payload is correct before it is ever shipped.
- **#1670: keep the old display name and change only the description.** Rejected: the author states the plugin's name itself changed to "归档管理 / Archive Management" at 1.4.1, and the market entry is the identity users browse by. Id, repo, npm, and author stay untouched, so the install identity does not move.

## Consequences

- `POST /api/skin-center/we/remove` with `imported/..`, `imported/.` or `imported/` now answers `400 bad-id` and the skin-center tree survives; the pre-fix chain is inert. Genuine `imported/<id>` removal still returns `200` and deletes only the store entry.
- The traversal guard is covered by `packages/skins/skin-center/tests/we-routes.spec.ts`: the two dot-segment ids are refused on both deleting routes with a sibling-directory canary still present, plus a unit test pinning `safeStoreId`'s output for ordinary, nested-traversal, and dot-only ids.
- Desktop payloads staged by `build-runtime.mjs` no longer contain any pnpm store record, so in-app plugin and dependency updates work on a user machine whose store differs from the build runner's. A payload with no manifest fails the build, which is the signal that pnpm's layout changed.
- The refreshed `lib/index.js` for skin-center now contains `storeEntryPath` at all three call sites; the committed-artifact fingerprints for `packages/skins/skin-center` and `packages/dsh-web-all` (which inlines child client sources) were re-recorded in the same change.
- The Workshop store and dsh-market.com now show the plugin's current name and description; the regenerated `market/dist` also advanced its `generated` date stamp in the five sibling manifests that share it.

## Testing

- `packages/skins/skin-center/tests/we-routes.spec.ts`: 50 tests green, including the two new regression tests and the sanitizer unit test. Verified end to end against the real route factory that the original two-step repro (`GET /inventory` then `POST /remove` with `imported/..`) answers 400 with the canary file intact.
- `desktop/tests/build-runtime.test.mjs`: 4 new tests covering nested removal, the zero-removal signal, a missing root, and that no CI store path survives a cleaned payload.
- Local reproduction of the recorded pnpm failure and of the fix under pnpm 11.24.0 (the version pinned by `packageManager`).
- Repository gates: `typecheck`, `test`, `test:scripts` (346), `test:desktop` (34), `test:standards`, `libs:check`, `market:check`, `aggregate:check`, `skin-center:check`, `community:check`, `i18n:check`, `docs:check`, and `emoji:check` all green.
