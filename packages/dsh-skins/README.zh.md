# @linxin666/dsh-skins

[English](README.md) | 中文

已退役的兼容载具（保留一个发布周期）：皮肤已全部内置进 `@linxin666/dsh-client-ui-skin-center`。本包带入皮肤中心，并发布不含资产的空叶包，让遗留 v1 profile junction 在旧版 bridge 清理前仍可解析。

## 是什么

- **兼容载具**：安装或升级本包即装上皮肤中心（`skin-center`），全部内置皮肤（xp / blue-fantasy / dragon-heir / minecraft / miku / trading / whale-song / harbor / whale-mom / matrix / maid-atelier / mint）以纯资产目录形态随它分发。
- **空 v1 叶包**：`build.mjs` 为 11 个已退役的 v1 包名生成不含资产的空包。它们不会应用皮肤，只用于让现有 profile junction 在一次清理启动期间仍可 import。
- **下个周期移除**：本包计划退役；新安装请直接用 `@linxin666/dsh-client-ui-skin-center`（或全家桶聚合包 `@linxin666/dsh-web-ui-all`）。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-client-ui-skin-center
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/skins/skin-center
```

在 GUI 一级菜单「皮肤中心」里切换皮肤，或用 `dsh-skin use <id>`；同一时刻只激活一个皮肤。

## 已知限制

- 浏览器 bundle 仅面向 Web，作用域限定在 dsh web GUI。
- 皮肤只做呈现：只改浏览器 DOM，不触及模型请求。
- 已经是非法 YAML 的 profile overlay 会在此兼容包加载前由 DSH 报错，需先修复 overlay 再启动。
- Maid Atelier 单独采用 CC BY-NC-SA 4.0，仅限非商业使用；完整许可与署名随皮肤中心包内的皮肤目录分发。
