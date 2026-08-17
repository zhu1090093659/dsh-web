# @linxin666/dsh-client-ui-skin-summer-liquid-glass

English | [中文](README.zh.md)

夏沫琉璃 (Summer Liquid Glass) skin for the dsh web GUI — an iOS-26 Liquid Glass
theme: layered translucent glass surfaces (inner edge highlight, edge
refraction, diffuse shadow, top sheen) over a night-festival illustration with
a deep-navy readability mask; ice-cyan interaction, rose selection, amber
running states, and yellow-green success.

Hot-pluggable as a client plugin in the official standalone bundle shape:
`apply()` sets the `data-dsh-summer-liquid-glass` body attribute (the whole
stylesheet's scope), paints the WebP backdrop with a deep-navy mask anchored
toward the upper-center face, injects a liquid-glass favicon, and tracks the
pointer for a subtle panel sheen; its effect disposer retracts every write.
The stylesheet rides the bundle's CSS-modules auto-inject. The theme is
dark-only: the same palette applies under both light and dark base modes.

The skin is presentation-only: no services are injected, no cordis events are
emitted, and nothing reaches a model request.

## Usage

1. Open the dsh web GUI → Settings → Skin Center (皮肤中心).
2. Find "Summer Liquid Glass" (夏沫琉璃) and click its card to try it on.
3. Apply it, or switch from the command line: `dsh-skin use summer-liquid-glass`.
4. Revert to the stock look: `dsh-skin use official` (or the Skin Center "官方" entry).

Only one skin is active at a time; switching is hot-reloaded, so refresh the
page to see the change.

## Palette

Deep night `#071321` base, glass base `#111927`, primary text `#F8F3F5`,
secondary `#C0CAD5`, dim `#8997A7`; ice cyan `#67DCE7` interaction, rose
`#DD8FAC` selection/brand, amber `#F3B75F` running, yellow-green `#CBE77D`
success, coral `#F1717F` error.

## Installing (official bundle)

1. Local path: `dsh plugin --profile <name> add /path/to/dsh-web-ui/packages/skins/summer-liquid-glass`
2. Git: `dsh plugin --profile <name> add github:<org>/dsh-web-ui#<sha>`
3. Switch with `scripts/dsh-skin` (`dsh-skin use summer-liquid-glass`); only one skin is active at a time.

## Building and testing

```sh
pnpm build   # tsdown: lib/index.js + lib/client.js (self-contained preset)
pnpm test    # vitest: apply/dispose contract spec
```

## Publishing to the skin center

```sh
node scripts/skin-center-bundles
pnpm --filter @linxin666/dsh-client-ui-skin-center build
node scripts/gallery-build
node scripts/capture-previews
```

Then commit everything and open a PR.

## License

BSD-3-Clause. The backdrop art is provided by the user for local use; re-check
redistribution rights before publishing.
