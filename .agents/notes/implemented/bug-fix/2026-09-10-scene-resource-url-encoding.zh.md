# Agent Note: 场景资源 URL 按路径段转义 pkg 路径

Status: implemented

## Problem

Issue #1458：Wallpaper Engine 的 Scene 壁纸全部黑屏。场景 manifest 把 pkg 内部素材路径以 `/api/skin-center/we/scene-resource/<token>/<path>` 的形式拼进 URL，用的是裸字符串拼接（`resourceBase + texPath`）。Wallpaper Engine 社区包常用 `#` 作为素材分组前缀（`materials/# background.tex`），浏览器会把字面 `#` 当成 URL fragment 分隔符，实际只请求 `.../materials/`；服务端按目录名查不到，返回 `404 resource-not-found`，所有贴图加载失败，画布保持全黑。名字里出现字面 `%` 时是另一种失败：路由的 `decodeURIComponent` 抛错并返回 400。

`buildSceneManifestVia` 共 13 处这样拼接（模型 `texUrl`/`texUrl2`/`lightmapUrl`、背景层、精灵、3D 粒子、流星与星尘贴图、两层反射、视频贴图层，以及 `flowimage`/`flag` 的多贴图列表），全部来自同一个未编码的 base。video 与 web 类型壁纸不走该路由，所以只有 Scene 受影响。

## Decision

`buildSceneManifestVia` 统一通过一个 helper 生成场景资源 URL：

```ts
const resourceUrl = (pkgPath: string): string =>
  resourceBase + pkgPath.split('/').map(encodeURIComponent).join('/')
```

每个 pkg 路径作为一个 URL 路径段转义，路由仍用 `decodeURIComponent` 还原子路径，服务端查找逻辑不变。刻意不用 `encodeURI`：它不转义 `#`。

## Testing

- `tests/pkg-extract.spec.ts` 用包含 `materials/# background 100%.tex` 的目录构建场景，断言 manifest URL 为 `.../materials/%23%20background%20100%25.tex`，并断言 manifest 中所有场景资源 URL 都不含裸 `#` 或空格。
- `tests/we-routes.spec.ts` 用真实 HTTP 路由跑同一形状：manifest URL 已 percent-encode，请求它返回 200 `image/png`；同时断言修复前的裸形式返回 404，记录 fragment 截断行为。
- `pnpm --filter @linxin666/dsh-client-ui-skin-center test`（35 个文件、613 个用例）与 `pnpm typecheck` 通过；同步重建 `lib/index.js`，让受版本管理的 host 产物带上修复。

## Alternatives considered

- 用 `encodeURI` 而不是按段 `encodeURIComponent`：否决——它不转义导致本 Bug 的 `#`，也放过会破坏路由 decode 的字面 `%`。
- 改服务端路由而不是改 URL 构造：否决——fragment 根本不会到达服务端，即便到达也会被 `new URL(req.url, ...).pathname` 截掉，服务端无从还原被截断的路径。
- 给路由错误响应补 `access-control-allow-origin`：记为仅改善诊断的后续项。报告者看到的 CORS 报错发生在 404 之后，缺头只是把可读的 404 变成不透明的网络错误，不影响像素，不属于本次修复。

## Consequences

- 名称含 `#`、空格、`%`、`?`、反斜杠的素材、模型、精灵、粒子、反射与视频贴图层都能正常加载，壁纸不再黑屏。
- 改动位于 skin-center bundle 的 host 半区，需要重启 DSH 服务后生效；受版本管理的 `lib/index.js` 已在同一改动内重建。
- 渲染器仍有其他独立的兜底路径（不支持的 TEX 格式回落到预览图、内嵌脚本被忽略），因此用户可见的黑屏仍可能由本次修复之外的原因造成。
