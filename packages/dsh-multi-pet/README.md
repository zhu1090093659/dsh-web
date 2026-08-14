# dsh-multi-pet

English | [中文](README.zh.md)

Multi-pet compat for DSH Web: lets the built-in pet and third-party pets
(such as whale-girl) run in the same profile at the same time.

## Problem

Two pet plugins register the same Cordis service `pet` on the root context:

- `@linxin666/dsh-pet` (shipped inside `@linxin666/dsh-web-ui-all`)
- `whale-girl` (third-party, installed standalone)

With both enabled, DSH fails to boot with `service "pet" has been registered`.
The usual workaround is to disable one of them.

## Solution

This package is a patch-only DSH Web bundle. Its `cordis.patch.yml` applies an
id-targeted patch to the built-in pet entry:

```yaml
- id: pet
  name: '@linxin666/dsh-pet'
  isolate:
    pet: true
```

The loader (cordis-plugin-loader) gives the `pet` entry an entry-local isolate
realm: its `pet` service registers under a symbol owned by that entry only
(`pet#pet`), while third-party providers keep the root `pet`. Both coexist,
each resolving its own implementation. Neither plugin is modified.

Why `true` and not a label: `isolate: { pet: some-label }` joins all entries
that use the same label into one realm, which would re-trigger the
duplicate-service conflict. Entry-local (`true`) is the correct setting.

## Install

```sh
dsh plugin --profile <name> add @linxin666/dsh-multi-pet
```

Or link a local checkout:

```sh
dsh plugin --profile <name> add link:/path/to/dsh-multi-pet
```

The bundle patch applies after every bundle layer, so as long as the package is
listed after the bundle that inserts the `pet` row (the `dsh plugin add` flow
appends to `dsh.profile.bundles`, which satisfies this), the patch wins. If
`dsh-pet` is not installed the patch matches nothing, warns, and is skipped.

Verify the composition:

```sh
dsh --profile <name> --dump-config
```

## Enabling, disabling, switching

Pets are ordinary plugins: toggle an entry in your own profile patch
(`cordis.patch.yml`) or add/remove the bundle from `dsh.profile.bundles`.
Switching never uninstalls dependencies and never hand-edits generated files.
Whether a toggle applies live or requires a restart is disclosed in the
release notes of the verified version.

General recipe — two third-party pets that both register the root `pet`: add
an id-targeted patch in your own profile patch that isolates one of them, e.g.

```yaml
- id: <other-pet-entry-id>
  isolate:
    pet: true
```

## Provider conventions for future pets

- Unique loader entry id per pet.
- `isolate: { pet: true }` (entry-local), or a unique label per provider —
  never a shared label with another pet.
- Namespaced HTTP routes per pet (`/api/pet/*`, `/whale-girl/*`, ...).
- Namespaced storage keys (data dirs and browser localStorage).
- Separate DOM roots and explicit z-index allocation (both pets default to
  the bottom-right corner with the same z-index; the later-mounted one renders
  on top).
- Clear `visible` / `enabled` semantics in settings.

## Known limitations

- Two third-party pets that both register the root `pet` remain mutually
  exclusive unless one of them is isolated (see recipe above); this package
  fixes the built-in pet + third-party case out of the box.
- In simultaneous mode both pets sit at the bottom-right with the same
  z-index; the later-mounted one renders on top.

## Development

```sh
pnpm install
pnpm test
```

Tests (node --test):

- `patch.test.mjs` — the shipped patch is a single id-targeted entry-local
  isolate.
- `compose.test.mjs` — the patch composes through the real DSH patch algorithm
  (`applyEntryPatches`), only touching the built-in pet row, warning (not
  failing) when the row is absent or the name guard mismatches.
- `isolate-mechanism.test.mjs` — with the real cordis + cordis-plugin-loader,
  two `pet` providers collide without isolation and coexist with it.

## License

MIT
