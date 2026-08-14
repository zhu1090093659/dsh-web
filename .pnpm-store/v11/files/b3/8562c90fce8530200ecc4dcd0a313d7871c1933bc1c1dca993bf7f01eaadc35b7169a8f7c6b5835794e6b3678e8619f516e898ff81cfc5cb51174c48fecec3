---
name: get-tsconfig
description: Find, parse, and query tsconfig.json files — extends resolution, file matching, path alias resolution. Use when reading tsconfig.json, checking if a file belongs to a tsconfig, resolving TypeScript path aliases, or working with tsconfig extends chains.
---

# get-tsconfig

Lightweight tsconfig.json parser. No TypeScript dependency. Tested against `tsc` for correctness.

> [!NOTE]
> Upgrading from v4? See [MIGRATION.md](./MIGRATION.md) for the API renames, the ESM-only / Node 20+ requirements, and the new version-aware-defaults behaviour.

## API

| Function | Purpose | Returns |
|----------|---------|---------|
| `getTsconfig(searchPath?, options?)` | Find + parse nearest tsconfig | `TsconfigResult \| undefined` |
| `findTsconfig(searchPath?, options?)` | Find nearest tsconfig path only | `string \| undefined` |
| `readTsconfig(path, options?)` | Parse tsconfig at known path | `TsconfigResult` |
| `isFileIncluded(tsconfig, filePath)` | Check if file is a root file (matches include/exclude/files globs) | `boolean` |
| `resolvePathAlias(tsconfig, specifier)` | Resolve `compilerOptions.paths` alias | `string[]` |
| `getExtendsChain(path, options?)` | Get raw extends chain before merging | `TsconfigResult<TsconfigJson>[]` |
| `resolveExtendsChain(chain)` | Merge a collected chain (pure, no fs) | `TsconfigResult` |

## Types

```ts
type TsconfigResult<Config = TsconfigJsonResolved> = {
    path: string
    config: Config
}

// TsconfigJson = raw tsconfig shape (includes extends field)
// TsconfigJsonResolved = TsconfigJson without extends (fully merged)

type GetTsconfigOptions = {
    configName?: string   // default: 'tsconfig.json' (use 'jsconfig.json' for JS projects)
    cache?: Map<string, unknown>
    includes?: boolean    // default: false — when true, validates file is a root file before accepting
    typescriptVersion?: 'auto' | string | false // default: 'auto' — see Use cases
}

type ReadTsconfigOptions = {
    cache?: Map<string, unknown>
    typescriptVersion?: 'auto' | string | false // default: 'auto'
}
```

## Use cases

### Build tool / loader integration

```ts
import { getTsconfig, isFileIncluded, resolvePathAlias } from 'get-tsconfig'

const tsconfig = getTsconfig()

// Check if a file should be transformed with this tsconfig's options
if (tsconfig && isFileIncluded(tsconfig, absoluteFilePath)) {
    const { compilerOptions } = tsconfig.config
    // Pass to esbuild, SWC, etc. as tsconfigRaw
}

// Resolve path aliases (returns candidate paths — check which exist)
const resolved = tsconfig && resolvePathAlias(tsconfig, '@/utils/helper')
// → ['/project/src/utils/helper'] or []
```

### Monorepo — per-file tsconfig lookup

The nearest tsconfig typically applies. Use `getTsconfig` with the file path — it walks up and finds the right one:

```ts
const cache = new Map()

const getConfigForFile = (filePath: string) =>
    getTsconfig(filePath, { cache })
```

Cache deduplicates filesystem reads across calls. Create a new `Map()` to invalidate after filesystem changes.

### Implied compiler options

Implied options are already normalized — no need to check parent flags:

```ts
const { compilerOptions } = getTsconfig().config

compilerOptions.noImplicitAny    // true (implied by strict: true)
compilerOptions.strictNullChecks // true (implied by strict: true)
compilerOptions.esModuleInterop  // true (implied by module: 'nodenext')
compilerOptions.allowJs          // true (implied by checkJs: true)
```

Options not set and not implied remain `undefined` (not `false`). Use `?? false` for boolean checks.

### Watch mode — extends chain files

```ts
import { getExtendsChain } from 'get-tsconfig'

const chain = getExtendsChain('./tsconfig.json')
const filesToWatch = chain.map(entry => entry.path)
```

### Modify config before merging

```ts
import { getExtendsChain, resolveExtendsChain } from 'get-tsconfig'

const chain = getExtendsChain('./tsconfig.json')
chain[0].config.compilerOptions = {
    ...chain[0].config.compilerOptions,
    sourceMap: true,
}
const result = resolveExtendsChain(chain)
```

### Language Server behavior

```ts
// Default: nearest tsconfig (tsc CLI behavior)
getTsconfig('./src/index.ts')

// Validates file is a root file before accepting (VS Code behavior)
getTsconfig('./src/index.ts', { includes: true })
```

### TypeScript version-aware defaults

The parser auto-detects the installed TypeScript version and applies its unconditional defaults (e.g. TS 6.0 sets `moduleResolution: 'bundler'`, `strict: true`). This is the default behavior — the parsed config matches what `tsc` would compute.

```ts
// Default — auto-detects via node_modules walk-up (or Yarn pnp)
readTsconfig('./tsconfig.json')

// Pin a specific version (deterministic across environments)
readTsconfig('./tsconfig.json', { typescriptVersion: '6.0.0' })

// Disable — return only the literal config + within-config derivations
readTsconfig('./tsconfig.json', { typescriptVersion: false })
```

**When to pass `false`:** library code that runs in environments where TypeScript may not be installed (production runtimes, trimmed Docker images). Auto-detection there would return `undefined` and behave inconsistently with dev. Passing `false` makes output deterministic.

Per-major changes are tracked in `src/version-defaults/{v4,v5,v6}.ts` with links to the corresponding TypeScript source.

## Understanding `isFileIncluded`

Checks whether a file matches `include`/`exclude`/`files` globs — whether it's a **root file**. This is NOT the same as "is this file part of the TypeScript program."

| Source | What it adds | Checked by `isFileIncluded`? |
|--------|-------------|-------------------------------|
| `include`/`files` globs | Root files | **Yes** |
| Transitive imports | Files imported by root files (recursive) | No |
| `@types` packages | Auto-discovered from `node_modules/@types/` | No |
| Triple-slash directives | `/// <reference path="..." />` | No |

- **`exclude` only filters glob matching** — if a root file imports an excluded file, that file is still in the program.
- **`isFileIncluded` returning `false` doesn't mean the file won't be compiled** — it may be pulled in via imports.
- For finding the nearest tsconfig regardless of glob matching, use `getTsconfig(filePath)` without `includes`.

## Gotchas

| Issue | Detail |
|-------|--------|
| Immutable tsconfig objects | `isFileIncluded` and `resolvePathAlias` cache per object identity. Do not mutate after first call. |
| `extends` must be resolved | `isFileIncluded` throws if `config.extends` is present. Use `getTsconfig`/`readTsconfig` output. |
| `resolvePathAlias` returns candidates | Returns paths from `compilerOptions.paths`, not verified files. Check existence yourself. |
| `getExtendsChain` resolves extends | The `extends` field in each entry is an absolute path, not the original string. |
