# Agent Note: Scene-resource URLs escape pkg paths per path segment

Status: implemented

## Problem

Issue #1458: every Wallpaper Engine Scene wallpaper rendered black. A scene manifest embeds pkg-internal material paths as `/api/skin-center/we/scene-resource/<token>/<path>` URLs built by raw concatenation (`resourceBase + texPath`). Wallpaper Engine community packages routinely name materials with a `#` grouping prefix (`materials/# background.tex`). The browser reads a literal `#` as the URL fragment separator and requests only `.../materials/`, the route finds no such material and answers `404 resource-not-found`, and every texture load fails — the canvas stays black. A literal `%` in a name fails differently: the route's `decodeURIComponent` throws and answers 400.

`buildSceneManifestVia` built 13 such URLs (model `texUrl`/`texUrl2`/`lightmapUrl`, background layers, sprites, 3D particles, meteor and sparkle textures, both reflection layers, video-backed layers, and the `flowimage`/`flag` multi-texture list), all from the same unencoded base. video and web wallpaper types never use this route, which is why only Scenes were affected.

## Decision

`buildSceneManifestVia` builds every scene-resource URL through one helper:

```ts
const resourceUrl = (pkgPath: string): string =>
  resourceBase + pkgPath.split('/').map(encodeURIComponent).join('/')
```

Each pkg path becomes one escaped URL path segment, and the existing route still decodes the subpath with `decodeURIComponent`, so the server-side lookup is unchanged. `encodeURI` is deliberately not used: it leaves `#` unescaped.

## Testing

- `tests/pkg-extract.spec.ts` builds a scene from a directory containing `materials/# background 100%.tex` and asserts the manifest URL is `.../materials/%23%20background%20100%25.tex` and that no scene-resource URL in the manifest keeps a raw `#` or space.
- `tests/we-routes.spec.ts` serves the same shape over the real HTTP routes: the manifest URL is percent-encoded, fetching it returns 200 `image/png`, and the pre-fix raw form is asserted as 404 to document the fragment truncation.
- `pnpm --filter @linxin666/dsh-client-ui-skin-center test` (35 files, 613 tests) and `pnpm typecheck` pass; `lib/index.js` is rebuilt with the helper so the tracked host artifact carries the fix.

## Alternatives considered

- `encodeURI` instead of per-segment `encodeURIComponent`: rejected — it leaves the `#` that causes the reported failure, and it also leaves a literal `%` able to break the route's decode.
- Fixing the server route instead of the URL builder: rejected — the fragment never reaches the server, and `new URL(req.url, ...).pathname` strips it even if it did, so no server-side change can recover the truncated path.
- Adding `access-control-allow-origin` to the route's error responses: recorded as a diagnostics-only follow-up. The reporter observed the CORS error after the 404, but the missing header merely turns a readable 404 into an opaque network error; it changes no pixels and is not part of this fix.

## Consequences

- Scene materials, models, sprites, particles, reflections and video-backed layers whose names contain `#`, spaces, `%`, `?` or backslashes now load; the wallpaper renders instead of showing a black canvas.
- The change is in the host half of the skin-center bundle, so it takes effect after a DSH service restart; the tracked `lib/index.js` is rebuilt in the same change.
- The renderer keeps its other independent fallback paths (unsupported TEX formats fall back to the preview, embedded scripts are ignored), so a user-visible black canvas can still have causes outside this fix.
