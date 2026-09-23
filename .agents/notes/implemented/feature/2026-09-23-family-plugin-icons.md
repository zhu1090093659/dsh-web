# Agent Note: Family plugin icons through the DSH display-metadata icon field

Status: implemented

## Problem

The official Plugins list (Settings → Plugins) drew every installed bundle with the same default artwork, so a card carried no identity of its own: `@linxin666/dsh-web-all` looked exactly like an unrelated third-party bundle next to it, and a standalone family package looked like any stock row. The dsh 0.1.7-alpha.2 host now reads an optional image from a package's exported `package.json`, which is the first host-level display-metadata field this repository can use on that surface.

## Decision

Every family package — the aggregate `@linxin666/dsh-web-all` and the 18 sub-plugin and Skin Center packages — ships `icon.svg` at its package root and declares it as the top-level `package.json.icon`; the file also joins each package's npm `files` whitelist so published tarballs carry it. `readPluginMeta` in `dsh-app-boot` resolves the value as a manifest-relative path, admits SVG/PNG/JPEG/WebP up to 256 KiB, base64s the bytes into a `data:` URL, and the official plugin manager renders that URL on the bundle card and the detail page.

## Scope and resolution

The reader resolves `<specifier>/package.json` through the package's exports map, so the specifier decides whether an entry has an icon at all:

- Every family package exports `"./package.json"` and resolves, so its own card — the aggregate's, or a standalone install's — shows the whale.
- Family rows inside the aggregate mount as `@linxin666/dsh-web-all/<family>`; `./<family>/package.json` is not an export, `readPluginMeta` returns undefined for those specifiers, and those rows keep the default artwork together with the subpath-derived `web-all/<family>` titles ([Aggregate family rows display real plugin names via subpath exports](../architecture/2026-09-02-aggregate-family-row-display-names.md)).

Aliasing `./<family>/package.json` to a package root would hand every row that manifest, whose `name` then wins over the subpath label in the client's title resolution and collapses the distinct row titles — the reason the family rows stay without an icon.

## Artwork

The mark is the family's own: a symmetric whale-tail (fluke) illustration was generated locally and vector-traced offline (imagetracerjs 1.2.6, quadratic fitting, 512-unit grid) into one closed outline on a `0 0 512 512` viewBox filled with the brand blue `#4d6bfe`. A generated full-whale silhouette was the alternative candidate and lost on size: at 16 px its eye and flipper merge into the body, while the fluke keeps a legible V. Nothing in the file comes from the upstream DeepSeek wordmark or any third-party icon set: the first shipped revision used `FISH_LOGO_PATH` from `@deepseek-ai/dsh-client-ui-primitives` and was replaced because a family plugin must not present the vendor's own logo as its identity. The fill is `#4d6bfe` rather than the originally supplied `#edf4ff`, which renders nearly invisible on the light card. The SVG carries no script, external reference, or raster payload, and the reference raster is not shipped. The same 3.8 KiB asset is copied into each package because the reader requires the icon to stay inside its own manifest directory after realpath resolution, so one shared file outside the packages cannot serve them.

## Alternatives considered

Inline data URL in `package.json`: the reader rejects anything that is not a relative file path (absolute paths and any URI scheme throw), so the value must name a file.

Reusing the upstream DeepSeek whale mark: rejected — it made the family icon a verbatim clone of the vendor logo, which is the one thing a plugin card should not claim as its own identity.

Hand-authored SVG paths: three hand-drawn revisions were produced and rendered at card size before being dropped; next to the vendor mark they read as crude, so the shipped geometry comes from tracing a generated reference instead of freehand coordinates.

One icon per plugin rather than one family mark: distinct glyphs for 18 plugins are a design inventory this change cannot verify or maintain, and the family identity is what a card is supposed to convey.

Icon only on the aggregate: a standalone install of e.g. `@linxin666/dsh-ssh` would still show generic artwork, and the aggregate's own detail page renders the same default art for every family row anyway — the per-package asset costs one file and one manifest key each.

Per-family icons through a per-family manifest: each `lib/shells/<family>/package.json` would need its own icon copy and a `name` that reproduces the current label, touching the generator-owned exports map and the scanner marker walk for a decoration. Rejected as disproportional.

A shared icon file referenced from several packages by a relative path: rejected — realpath containment forbids leaving the manifest directory.

PNG or WebP artwork: both are accepted, but a raster does not scale between the card and the detail page and carries more bytes than the SVG.

Keeping the supplied `#edf4ff` fill: verified invisible on the light card; the light theme is the default.

An upstream bundle-level icon API: unnecessary — the field already exists and is read without loading plugin code.

## Consequences

Installed cards and detail pages show the whale in both themes for the aggregate and for every family package installed on its own; family rows inside the aggregate and unrelated bundles keep the default artwork. The value is read per inventory call from the installed package directory, so a browser refresh shows it without restarting `dsh web`; only a published npm tarball needs the new `files` entry to carry the asset, so icons appear for npm users at the next family release. The icon is a display asset only: no runtime code, contract, or profile patch depends on it. The 19 copies are deliberate duplication of an inert file, not a source of truth to keep in sync programmatically — nothing consumes them at build time.

## Testing

`node scripts/aggregate.mjs --check`, `node scripts/lib-artifact-check.mjs`, `node scripts/verify-docs.mjs`, `pnpm i18n:check`, `pnpm emoji:check`, `pnpm skin-center:check`, `pnpm market:check`, and `pnpm community:check` pass with the icons declared, so the generator-owned exports map, the committed `lib/` fingerprints, and the generated market and catalog artifacts are untouched.

The live host's own `readPluginMeta` (imported from the running `@deepseek-ai/dsh-app-boot`) was called from a profile-shaped fixture — one `package.json` whose `node_modules` links all 19 packages, which is how a profile install resolves them — and returned `data:image/svg+xml;base64,...` for all 19 specifiers, each decoding byte-identically (sha256) to that package's `icon.svg`. Called against the real `web` profile root, `@linxin666/dsh-web-all` resolves the same way and `@linxin666/dsh-web-all/usage` correctly returns no icon. The artwork was rendered as a real `<img src="data:image/svg+xml;base64,...">` at 16/24/32/48/96 px and on light and dark cards, and the 16 px and 96 px renders were inspected to confirm the fluke stays readable at the smallest size and clean at the largest. No host restart was performed. The repository-wide `pnpm -r test` run reports failures only in `packages/dsh-task-board` (`window.localStorage.setItem is not a function` under jsdom); the same two spec files fail identically with that package's `package.json` restored from HEAD, so those failures predate this change and are independent of it.
