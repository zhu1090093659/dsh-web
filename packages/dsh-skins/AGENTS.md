# AGENTS.md — dsh-skins

皮肤全家桶聚合包：装它 = 皮肤中心（skin-center）+ 全部皮肤资产，一个 npm 包内置
所有皮肤，避免为每皮肤付 npm 新包名费用。

## 聚合构建链

- `build.mjs` 把每个 `packages/skins/<id>` 的 `skin.json` + `lib/client.js`
  （try-on bundle）+ `lib/index.js`（host 空入口）——连同生成的叶子
  `package.json` 与 `cordis.patch.yml`——复制进 `packages/dsh-skins/skins/<id>/`。
  无 `skin.json`（skin-center、脚手架）的目录跳过。
- 缺 `lib/client.js` / `lib/index.js` 的皮肤会被跳过并告警，源码里先产出 bundle
  再聚合。

## 皮肤启用与资产边界

- 皮肤启用互斥由 `dsh-skin use` 管理（当前 Web profile 的
  `cordis.patch.yml` managed 区段），因此**皮肤只进 `skins/` 资产，不进
  `patchFrom`**；禁止把 Web 皮肤 insert 写到 harness-home 全局补丁，否则其他
  profile 会尝试加载未安装的浏览器皮肤包。
- 改任何皮肤后必须重跑 `pnpm --filter @linxin666/dsh-skins build`，否则 npm 安装
  aggregate 后 useSkin 的 insert 行无法 resolve（MODULE_NOT_FOUND）。

## 构建产物确定性

- CI 的 `gallery:check` 比较 **COMMITTED bundle 产物**；本地构建会嵌入绝对路径，
  所以 CI 用 `--ignore-scripts` 跳过本地构建直接比产物，别把本地带路径产物提交。

## 提交前检查

```sh
pnpm --filter @linxin666/dsh-skins build
pnpm gallery:check
```
