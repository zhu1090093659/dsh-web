---
name: get-tsconfig-migration
description: Step-by-step guide for migrating from get-tsconfig v4 to v5. Use when upgrading the dependency, when seeing errors after the upgrade (e.g. parseTsconfig is not a function, TsConfigResult type missing, require() failing), or when adapting code that used createFilesMatcher / createPathsMatcher / parseTsconfig.
---

# Migrating from get-tsconfig v4 to v5

v5 is ESM-only, requires Node 20+, renames most APIs, and applies TypeScript-version-aware defaults to compiler options by default. The renames are mechanical; the behaviour change is silent — code keeps running but parsed configs now include synthesized fields that v4 left `undefined`.

> [!IMPORTANT]
> **The biggest gotcha is the new default behaviour.** If your code branches on `compilerOptions.X === undefined` to mean "the user didn't set X," that check now fails — v5 fills X with the installed TypeScript's default (e.g. `moduleResolution: 'bundler'` for TS 6). Pass `typescriptVersion: false` to opt out. See [TypeScript-version-aware defaults](#typescript-version-aware-defaults).

## Environment

| Concern | v4 | v5 |
|---|---|---|
| Node | `>=12.20` | `>=20.20` |
| Module format | CJS + ESM dual build | **ESM only** — `require('get-tsconfig')` no longer works |

Stay on `get-tsconfig@4` if you can't move to ESM or upgrade Node.

## API renames

```ts
// v4
import {
    parseTsconfig,
    createFilesMatcher,
    createPathsMatcher,
    type TsConfigResult,
} from 'get-tsconfig'

const config = parseTsconfig('./tsconfig.json')
const filesMatcher = createFilesMatcher({ path, config })
const pathsMatcher = createPathsMatcher({ path, config })

if (filesMatcher(filePath)) { /* ... */ }
const candidates = pathsMatcher?.('@/foo')
```

```ts
// v5
import {
    readTsconfig,
    isFileIncluded,
    resolvePathAlias,
    type TsconfigResult,
} from 'get-tsconfig'

const result = readTsconfig('./tsconfig.json')
if (isFileIncluded(result, filePath)) { /* ... */ }
const candidates = resolvePathAlias(result, '@/foo')
```

`createFilesMatcher` / `createPathsMatcher` were factories returning a closure. `isFileIncluded` / `resolvePathAlias` are direct calls — no factory step.

## Signature changes (positional → options)

```ts
// v4
getTsconfig(searchPath, configName, cache, includes)
findTsconfig(searchPath, configName, cache)
parseTsconfig(path, cache)

// v5
getTsconfig(searchPath, { configName, cache, includes, typescriptVersion })
findTsconfig(searchPath, { configName, cache, includes })
readTsconfig(path, { cache, typescriptVersion })
```

## Return-value changes

### `getTsconfig`: `null` → `undefined`

Replace `=== null` checks. (`findTsconfig` already returned `string | undefined` in v4 — unchanged.)

### `parseTsconfig` raw config → `readTsconfig` wrapper

```ts
// v4 — returned the resolved compilerOptions directly
const compilerOptions = parseTsconfig('./tsconfig.json').compilerOptions

// v5 — returns TsconfigResult { path, config, sources }
const compilerOptions = readTsconfig('./tsconfig.json').config.compilerOptions
```

### Matcher return shapes

| API | v4 return when "no match" | v5 return |
|---|---|---|
| `createFilesMatcher(t)(p)` | `undefined` (matched: returned the config) | `isFileIncluded(t, p)` → `boolean` |
| `createPathsMatcher(t)` | `null` if no `paths`/`baseUrl` | `resolvePathAlias(t, s)` → `string[]` (empty if no aliases) |

If you read the matched config out of `createFilesMatcher`'s return value, switch to reading from the `TsconfigResult` you already have:

```ts
// v4
const matched = filesMatcher(filePath)
if (matched) use(matched.compilerOptions)

// v5
if (isFileIncluded(tsconfig, filePath)) use(tsconfig.config.compilerOptions)
```

Other behaviour changes worth flagging:

- **Non-absolute paths.** v4 `createFilesMatcher(t)(relativePath)` **threw** `'filePath must be absolute'`; v5 `isFileIncluded` returns `false` silently. Replace any `try/catch` around the call with an explicit `path.isAbsolute(...)` check.
- **`caseSensitivePaths` is gone.** `createFilesMatcher(t, false)` had no v5 equivalent — sensitivity is auto-detected via `is-fs-case-sensitive`. If you forced a value for cross-platform tests, handle that at the test layer.

## Type renames and removals

| v4 | v5 |
|---|---|
| `TsConfigResult` | `TsconfigResult` |
| `TsConfigJson` | `TsconfigJson` |
| `TsConfigJsonResolved` | `TsconfigJsonResolved` |
| `Cache` | `TsconfigCache` |

Removed (no replacement — the matcher factories they typed are gone):

- **`PathsMatcher`** — was the function type returned by `createPathsMatcher`.
- **`FileMatcher`** — was the function type returned by `createFilesMatcher`.

If you imported either to annotate a variable, just delete the import.

## TypeScript-version-aware defaults

v5 detects the installed TypeScript version (default: `'auto'`) and applies its unconditional defaults. Parsed configs now include synthesized fields like `moduleResolution: 'bundler'` (TS 6) or `target: 'es5'` (TS 5) where v4 would have left them `undefined`.

```ts
// v4
parseTsconfig('./tsconfig.json').compilerOptions
// {}

// v5 — defaults applied (if TS is installed)
readTsconfig('./tsconfig.json').config.compilerOptions
// { strict: true, target: 'es2025', moduleResolution: 'bundler', ... }

// v5 with v4 behaviour preserved
readTsconfig('./tsconfig.json', { typescriptVersion: false }).config.compilerOptions
// {}
```

**Pass `typescriptVersion: false`** if any of the following apply:

- Your code branches on `compilerOptions.X === undefined` to mean "the user didn't set X."
- You ship library code that runs both at dev time (with TypeScript installed) and in production (without it). Auto-detection returns `undefined` when TS is missing — output drifts between environments. `false` makes it deterministic.
- You want byte-for-byte parity with v4 output.

You can also pin a specific version: `{ typescriptVersion: '6.0.0' }`.

## Additive APIs in v5 (no migration needed)

- **`getExtendsChain(path, options)`** — raw extends chain before merging. Useful for watch mode (`chain.map(e => e.path)`) or modifying configs before merge.
- **`resolveExtendsChain(chain, options)`** — pure merge function over a chain. No filesystem.
- **`TsconfigResult.sources`** — paths of every file in the resolved extends chain.
- **`typescriptVersion` option** — opt out with `false` for v4-style raw output, or pin a specific version string.

## Quick search-and-replace

```sh
# Macro renames (review the diff afterwards — these may overshoot in comments/strings)
sed -i '' '
  s/parseTsconfig/readTsconfig/g
  s/createFilesMatcher/isFileIncluded/g
  s/createPathsMatcher/resolvePathAlias/g
  s/TsConfig/Tsconfig/g
  s/\([^A-Za-z0-9_]\)Cache\b/\1TsconfigCache/g
'
```

The `Cache` substitution uses a word-boundary lookbehind to avoid mangling identifiers like `cacheMap` or `MyCache`. Review the diff and revert any false positives.

Then manually:

1. **Rewrite call sites.** `createFilesMatcher(t)(filePath)` → `isFileIncluded(t, filePath)`. Same for `createPathsMatcher(t)?.(spec)` → `resolvePathAlias(t, spec)`.
2. **Convert positional args to options objects** for `getTsconfig` / `findTsconfig` / `readTsconfig`.
3. **Replace `=== null`** with `=== undefined` (or `!result`) for `getTsconfig` returns.
4. **Update `parseTsconfig` consumers** to access the `.config` property on the result of `readTsconfig`.
5. **Decide on `typescriptVersion`.** Default `'auto'` matches what `tsc` would compute. Pass `false` if you ship to TS-less runtimes or rely on `=== undefined` checks.

## Common errors after upgrading

| Error | Cause | Fix |
|---|---|---|
| `Engine "node" is incompatible` | Bumped to Node 20+ | Upgrade Node, or pin `get-tsconfig@4` |
| `require('get-tsconfig')` throws `ERR_REQUIRE_ESM` | CJS dropped | Convert consumer to ESM, or pin `get-tsconfig@4` |
| `TypeError: parseTsconfig is not a function` | Renamed | `parseTsconfig(p)` → `readTsconfig(p).config` |
| `TypeError: createFilesMatcher is not a function` | Renamed + de-curried | `createFilesMatcher(t)(p)` → `isFileIncluded(t, p)` |
| `TypeError: createPathsMatcher is not a function` | Renamed + de-curried | `createPathsMatcher(t)?.(s)` → `resolvePathAlias(t, s)` |
| `Cannot find name 'TsConfigResult'` | Type renamed | `TsConfigResult` → `TsconfigResult` |
| `Cannot find name 'Cache'` | Type renamed | `Cache` → `TsconfigCache` |
| `Cannot find name 'PathsMatcher'` or `'FileMatcher'` | Type removed | Delete the import — no replacement |
| Test snapshots fail with new fields like `moduleResolution: 'bundler'` | Version-aware defaults now applied | Update snapshots, or pass `typescriptVersion: false` to restore v4 output |
