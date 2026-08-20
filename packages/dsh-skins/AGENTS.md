# AGENTS.md — dsh-skins

已退役的兼容载具（保留一个发布周期，issue #506）：皮肤是纯资产目录，全部内置在
`packages/skins/skin-center/skins/<id>/`，由皮肤中心包（`@linxin666/dsh-client-ui-skin-center`）
统一加载。本包不再携带皮肤资产，只保留旧 junction 可解析所需的空兼容叶包。

## 当前形态

- `build.mjs` 只生成 11 个旧皮肤名对应的空兼容叶包；不得把 CSS、图片或旧版
  client 运行时复制回来。生成目录随 npm 包发布，让旧 junction 在 bridge 清理前可解析。
- 唯一的 dependency 是 `@linxin666/dsh-client-ui-skin-center`（`workspace:*`）：
  升级用户自动获得皮肤中心与全部内置皮肤。
- `aggregate.yml` 的 `patchFrom` / `deps` 指向 `../skins/skin-center`，保持不变；
  聚合重生成走 `node scripts/aggregate.mjs`。
- 下个发布周期本包整体移除；不要再往这里加资产复制逻辑。

## 提交前检查

```sh
pnpm aggregate:check
```
