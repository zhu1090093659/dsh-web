# @linxin666/dsh-skins

[English](README.md) | 中文

皮肤全家桶聚合插件：装它 = 皮肤中心（`skin-center`）+ 全部皮肤资产（xp / blue-fantasy / dragon-heir / minecraft / miku / trading / whale-song / harbor / whale-mom / matrix / maid-atelier 等，内置在包的 `skins/` 目录），无需每皮肤独立 npm 包。

## 是什么

- **皮肤中心 + 全套皮肤**：一个包取代单独安装各皮肤。
- **皮肤启用互斥由 `dsh-skin use` 管理**：皮肤互斥激活，由 `dsh-skin use` 管理（当前 Web profile 的 `managed` 区段），因此皮肤只进 `skins/` 资产，不进 `patchFrom`，非 Web profile 不会继承浏览器皮肤条目。
- **安全写入 YAML**：追加 managed 区段前会自动规范化 DSH 默认的 `[]` overlay 模板；遇到不兼容的非空 flow 根时会在替换文件前拒绝操作。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add @linxin666/dsh-skins
```

### 从仓库安装（开发调试）

```sh
git clone https://github.com/zhu1090093659/dsh-web-ui.git
cd dsh-web-ui
pnpm install && pnpm -r build
dsh plugin --profile web add link:$(pwd)/packages/dsh-skins
```

皮肤切换用 `dsh-skin use <id>`；同一时刻只激活一个皮肤。

## 已知限制

- 浏览器 bundle 仅面向 Web，作用域限定在 dsh web GUI。
- 皮肤只做呈现：只改浏览器 DOM，不触及模型请求。
- Maid Atelier 单独采用 CC BY-NC-SA 4.0，仅限非商业使用；完整许可与署名随内置皮肤分发，并汇总于 `THIRD_PARTY_NOTICES.md`。
